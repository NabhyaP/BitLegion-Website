/**
 * §E4 Retention job — runs daily at 22:30 UTC via Hostinger Cron:
 *   `node dist/jobs/retain-leaderboard-history.js`
 *
 * - Keep latest 3 READY leaderboard_versions (older cascade-deleted).
 * - ABANDON stale RUNNING versions (older than 30 min) — already done in Job 1,
 *   but this catches orphans if Job 1 was never re-run.
 * - Prune codeforces_rating_daily older than 24 months.
 * - Delete expired codeforces_link_attempts.
 * - Prune audit_events older than 24 months.
 */

import { pool } from '../db/pool.ts';
import * as lbRepo from '../modules/leaderboards/repository.ts';
import type { ResultSetHeader } from 'mysql2/promise';

async function run(): Promise<void> {
  const startedAt = new Date();
  console.log('[retain] starting');

  try {
    // 1. Abandon stale RUNNING versions.
    await lbRepo.abandonStaleRunningVersions();

    // 2. Keep only the 3 most recent READY versions.
    await lbRepo.pruneOldReadyVersions();

    // 3. Prune rating daily older than 24 months.
    await lbRepo.pruneRatingDaily();

    // 4. Delete expired link attempts.
    const [expiredLinks] = await pool.query<ResultSetHeader>(
      `DELETE FROM codeforces_link_attempts WHERE expires_at < NOW()`,
    );
    const deletedLinks = expiredLinks.affectedRows;

    // 5. Prune audit_events older than 24 months.
    const [expiredAudit] = await pool.query<ResultSetHeader>(
      `DELETE FROM audit_events
        WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 MONTH)`,
    );
    const deletedAudit = expiredAudit.affectedRows;

    const durationMs = Date.now() - startedAt.getTime();
    await pool.query(
      `INSERT INTO job_runs (job_code, status, started_at, finished_at, duration_ms, detail)
       VALUES ('retain', 'OK', ?, NOW(), ?, ?)`,
      [
        startedAt,
        durationMs,
        JSON.stringify({ deletedExpiredLinks: deletedLinks, deletedAuditRows: deletedAudit }),
      ],
    );

    console.log(
      `[retain] done — ${deletedLinks} expired link attempts, ${deletedAudit} old audit rows pruned`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[retain] error: ${msg}`);
    await pool
      .query(
        `INSERT INTO job_runs (job_code, status, started_at, finished_at, detail)
         VALUES ('retain', 'FAILED', ?, NOW(), ?)`,
        [startedAt, JSON.stringify({ error: msg })],
      )
      .catch(() => {/* best-effort */});
    throw err;
  }
}

await run();
await pool.end();
