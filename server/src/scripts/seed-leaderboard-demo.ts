#!/usr/bin/env node
/**
 * Local leaderboard fixtures.
 *
 * These rows deliberately bypass OAuth so one developer can exercise a
 * multi-user leaderboard. The environment and host checks keep this path away
 * from deployed databases.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.ts';
import { pool } from '../db/pool.ts';

const FIXTURE_PREFIX = 'leaderboard-demo-';
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const fixtures = [
  { handle: 'tourist', batchYear: 2022, branch: 'CSE' },
  { handle: 'Benq', batchYear: 2022, branch: 'ECE' },
  { handle: 'jiangly', batchYear: 2023, branch: 'CSE' },
  { handle: 'Errichto', batchYear: 2023, branch: 'ECE' },
  { handle: 'Um_nik', batchYear: 2024, branch: 'CSE' },
  { handle: 'ecnerwala', batchYear: 2024, branch: 'ECE' },
  { handle: 'SecondThread', batchYear: 2025, branch: 'CSE' },
] as const;

function assertLocalDevelopmentDatabase(): void {
  if (env.NODE_ENV !== 'development' || !LOCAL_DB_HOSTS.has(env.DB_HOST.toLowerCase())) {
    throw new Error(
      'Leaderboard demo fixtures are restricted to NODE_ENV=development with a local database host.',
    );
  }
}

function fixtureEmail(handle: string): string {
  const slug = handle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${FIXTURE_PREFIX}${slug}@${env.ALLOWED_EMAIL_SUFFIX}`;
}

async function clearFixtures(): Promise<void> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM users WHERE college_email LIKE ?',
    [`${FIXTURE_PREFIX}%@${env.ALLOWED_EMAIL_SUFFIX}`],
  );
  console.log(`[leaderboard-demo] removed ${result.affectedRows} fixture member(s)`);
}

async function seedFixtures(): Promise<void> {
  let seeded = 0;
  let skipped = 0;

  for (const fixture of fixtures) {
    const normalizedHandle = fixture.handle.toLowerCase();
    const email = fixtureEmail(fixture.handle);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [handleRows] = await conn.query<RowDataPacket[]>(
        `SELECT ca.user_id, u.college_email
           FROM codeforces_accounts ca
           JOIN users u ON u.id = ca.user_id
          WHERE ca.normalized_handle = ?`,
        [normalizedHandle],
      );

      const existingHandleOwner = handleRows[0];
      if (existingHandleOwner && existingHandleOwner.college_email !== email) {
        await conn.rollback();
        skipped++;
        console.log(
          `[leaderboard-demo] skipped ${fixture.handle}: already linked to another local member`,
        );
        continue;
      }

      await conn.query(
        `INSERT INTO users
           (college_email, display_name, batch_year, branch, status,
            show_in_leaderboard, profile_confirmed)
         VALUES (?, ?, ?, ?, 'ACTIVE', 1, 1)
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           batch_year = VALUES(batch_year),
           branch = VALUES(branch),
           status = 'ACTIVE',
           show_in_leaderboard = 1,
           profile_confirmed = 1`,
        [email, `${fixture.handle} (Demo)`, fixture.batchYear, fixture.branch],
      );

      const [userRows] = await conn.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE college_email = ?',
        [email],
      );
      const userId = Number(userRows[0]!.id);

      await conn.query(
        `INSERT INTO codeforces_accounts
           (user_id, handle, normalized_handle, verified_at, status)
         VALUES (?, ?, ?, NOW(), 'ACTIVE')
         ON DUPLICATE KEY UPDATE
           handle = VALUES(handle),
           normalized_handle = VALUES(normalized_handle),
           verified_at = VALUES(verified_at),
           status = 'ACTIVE',
           last_checked_at = NULL`,
        [userId, fixture.handle, normalizedHandle],
      );
      await conn.query(
        'INSERT IGNORE INTO codeforces_solved_state (user_id) VALUES (?)',
        [userId],
      );

      await conn.commit();
      seeded++;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  console.log(`[leaderboard-demo] seeded ${seeded} fixture member(s), skipped ${skipped}`);
}

async function main(): Promise<void> {
  assertLocalDevelopmentDatabase();
  if (process.argv.includes('--clear')) {
    await clearFixtures();
  } else {
    await seedFixtures();
  }
}

main()
  .catch((error) => {
    console.error(`[leaderboard-demo] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
