import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.ts';

// ponytail: filename-ordered .sql files + one applied-log table. No migration framework.
// Each file: "-- up" section, optional "-- down" section, statements separated by ";".
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

type Migration = { name: string; up: string[]; down: string[] };

function split(sql: string): string[] {
  // Strip single-line comments BEFORE splitting on semicolons.
  // Comments containing semicolons (e.g. "-- foo; bar") would otherwise be
  // split mid-comment, leaving orphaned text that MySQL rejects.
  const stripped = sql.replace(/--[^\n]*/g, '');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function load(): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => {
      const text = await readFile(path.join(dir, name), 'utf8');
      const [upPart = '', downPart = ''] = text.split(/^--\s*down\s*$/im);
      return {
        name,
        up: split(upPart.replace(/^--\s*up\s*$/im, '')),
        down: split(downPart),
      };
    }),
  );
}

async function applied(): Promise<Set<string>> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name VARCHAR(190) PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  const [rows] = await pool.query<any[]>('SELECT name FROM schema_migrations');
  return new Set(rows.map((r) => r.name));
}

async function up() {
  const done = await applied();
  for (const m of await load()) {
    if (done.has(m.name)) continue;
    for (const stmt of m.up) await pool.query(stmt);
    await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [m.name]);
    console.log(`applied ${m.name}`);
  }
  console.log('migrations up to date');
}

async function down() {
  const done = await applied();
  const last = (await load()).reverse().find((m) => done.has(m.name));
  if (!last) return console.log('nothing to roll back');
  if (last.down.length === 0) throw new Error(`${last.name} has no -- down section`);
  for (const stmt of last.down) await pool.query(stmt);
  await pool.query('DELETE FROM schema_migrations WHERE name = ?', [last.name]);
  console.log(`rolled back ${last.name}`);
}

const cmd = process.argv[2] ?? 'up';
await (cmd === 'down' ? down() : up());
await pool.end();
