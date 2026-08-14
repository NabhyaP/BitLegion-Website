/**
 * §E4 Cleanup job — runs daily at 22:45 UTC via Hostinger Cron:
 *   `node dist/jobs/cleanup-sessions-and-links.js`
 *
 * Cleans up expired sessions if express-mysql-session's internal reaper hasn't run,
 * and removes any leftover expired codeforces_link_attempts not caught by retain job.
 */

import { pool } from '../db/pool.ts';

async function run(): Promise<void> {
  const startedAt = new Date();
  console.log('[cleanup] starting');

  try {
    // Expired sessions (express-mysql-session stores expiry in the `expires` column).
    // If the session store's own reaper is active this is a no-op.
    const [sessResult] = await pool.query<any>(
      `DELETE FROM sessions WHERE expires < UNIX_TIMESTAMP() * 1000`,
    ).catch(() => [{ affectedRows: 0 }]); // sessions table may not exist in test env
    const deletedSessions = (sessResult as any).affectedRows ?? 0;

    // Belt-and-suspenders: any remaining expired link attempts.
    const [linkResult] = await pool.query<any>(
      `DELETE FROM codeforces_link_attempts WHERE expires_at < NOW()`,
    );
    const deletedLinks = (linkResult as any).affectedRows ?? 0;

    const durationMs = Date.now() - startedAt.getTime();
    await pool.query(
      `INSERT INTO job_runs (job_code, status, started_at, finished_at, duration_ms, detail)
       VALUES ('cleanup', 'OK', ?, NOW(), ?, ?)`,
      [
        startedAt,
        durationMs,
        JSON.stringify({ deletedSessions, deletedExpiredLinks: deletedLinks }),
      ],
    );

    console.log(`[cleanup] done — ${deletedSessions} sessions, ${deletedLinks} link attempts removed`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cleanup] error: ${msg}`);
    await pool
      .query(
        `INSERT INTO job_runs (job_code, status, started_at, finished_at, detail)
         VALUES ('cleanup', 'FAILED', ?, NOW(), ?)`,
        [startedAt, JSON.stringify({ error: msg })],
      )
      .catch(() => {/* best-effort */});
    throw err;
  }
}

await run();
await pool.end();
