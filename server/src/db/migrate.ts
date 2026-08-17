import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from './pool.ts';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectories = [
  path.join(moduleDir, 'migrations'),
  path.resolve(process.cwd(), 'server/src/db/migrations'),
  path.resolve(process.cwd(), 'src/db/migrations'),
  path.resolve(moduleDir, '../../../../src/db/migrations'),
];
const foundDirectory = migrationDirectories.find(existsSync);
if (!foundDirectory) throw new Error('Could not locate server/src/db/migrations.');
const dir: string = foundDirectory;

type Migration = { name: string; up: string[]; down: string[] };
type MigrationStatus = 'APPLYING' | 'APPLIED' | 'REVERTING';

function split(sql: string): string[] {
  const stripped = sql.replace(/--[^\n]*/g, '');
  return stripped
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function load(): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  return Promise.all(files.map(async (name) => {
    const text = await readFile(path.join(dir, name), 'utf8');
    const [upPart = '', downPart = ''] = text.split(/^--\s*down\s*$/im);
    return {
      name,
      up: split(upPart.replace(/^--\s*up\s*$/im, '')),
      down: split(downPart),
    };
  }));
}

async function migrationRows(): Promise<Map<string, MigrationStatus>> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name VARCHAR(190) PRIMARY KEY,
       status VARCHAR(16) NOT NULL DEFAULT 'APPLIED',
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  const [columns] = await pool.query<RowDataPacket[]>(
    `SHOW COLUMNS FROM schema_migrations LIKE 'status'`,
  );
  if (columns.length === 0) {
    await pool.query(
      `ALTER TABLE schema_migrations
         ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'APPLIED' AFTER name`,
    );
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT name, status FROM schema_migrations ORDER BY name`,
  );
  return new Map(rows.map((row) => [
    row.name as string,
    row.status as MigrationStatus,
  ]));
}

function assertNoDirty(rows: Map<string, MigrationStatus>): void {
  const dirty = [...rows].find(([, status]) => status !== 'APPLIED');
  if (!dirty) return;
  throw new Error(
    `Migration ${dirty[0]} is ${dirty[1]}. Repair the database, then run `
    + `npm run migrate -- repair ${dirty[0]}.`,
  );
}

async function up(): Promise<void> {
  const rows = await migrationRows();
  assertNoDirty(rows);
  for (const migration of await load()) {
    if (rows.get(migration.name) === 'APPLIED') continue;
    await pool.query(
      `INSERT INTO schema_migrations (name, status) VALUES (?, 'APPLYING')`,
      [migration.name],
    );
    try {
      for (const statement of migration.up) await pool.query(statement);
      await pool.query(
        `UPDATE schema_migrations SET status = 'APPLIED', applied_at = CURRENT_TIMESTAMP WHERE name = ?`,
        [migration.name],
      );
      console.log(`applied ${migration.name}`);
    } catch (err) {
      console.error(`migration ${migration.name} stopped in APPLYING state`);
      throw err;
    }
  }
  console.log('migrations up to date');
}

async function down(): Promise<void> {
  const rows = await migrationRows();
  assertNoDirty(rows);
  const last = (await load()).reverse().find((migration) => rows.get(migration.name) === 'APPLIED');
  if (!last) {
    console.log('nothing to roll back');
    return;
  }
  if (last.down.length === 0) throw new Error(`${last.name} has no -- down section`);
  await pool.query(`UPDATE schema_migrations SET status = 'REVERTING' WHERE name = ?`, [last.name]);
  try {
    for (const statement of last.down) await pool.query(statement);
    await pool.query(`DELETE FROM schema_migrations WHERE name = ?`, [last.name]);
    console.log(`rolled back ${last.name}`);
  } catch (err) {
    console.error(`migration ${last.name} stopped in REVERTING state`);
    throw err;
  }
}

async function repair(name: string | undefined): Promise<void> {
  if (!name) throw new Error('Usage: npm run migrate -- repair <migration-file>');
  const rows = await migrationRows();
  const status = rows.get(name);
  if (!status) throw new Error(`Migration ${name} is not recorded.`);
  if (status === 'APPLIED') throw new Error(`Migration ${name} is already APPLIED.`);
  await pool.query(`DELETE FROM schema_migrations WHERE name = ?`, [name]);
  console.log(`cleared dirty marker for ${name}; run migrations again after verifying the schema`);
}

const command = process.argv[2] ?? 'up';
try {
  if (command === 'up') await up();
  else if (command === 'down') await down();
  else if (command === 'repair') await repair(process.argv[3]);
  else throw new Error(`Unknown migration command: ${command}`);
} finally {
  await pool.end();
}
