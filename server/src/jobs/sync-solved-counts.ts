/**
 * Job 2 — Rolling solved-count sync (§E3).
 * Runs nightly at 02:30 IST via Hostinger Cron:
 *   `node dist/jobs/sync-solved-counts.js`
 *
 * Fetches incremental user.status submissions for the oldest-synced ACTIVE-linked users
 * (up to SOLVED_SYNC_USERS_PER_RUN per night) and updates codeforces_solved_state +
 * codeforces_solved_problems using INSERT IGNORE (idempotent by construction).
 */

import { pool } from '../db/pool.ts';
import { env } from '../config/env.ts';
import { withLock } from '../shared/lock.ts';
import * as cf from '../shared/cf-client.ts';
import { CfHandleError, CfRateLimitError } from '../shared/cf-client.ts';
import type { RowDataPacket } from 'mysql2/promise';

const LOCK_NAME = 'bitlegion:cf-solved';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

type SyncUser = {
  userId: number;
  handle: string;
  lastSubmissionId: number;
  solvedCount: number;
};

async function fetchUsersToSync(limit: number): Promise<SyncUser[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT css.user_id, ca.handle, css.last_submission_id, css.solved_count
       FROM codeforces_solved_state css
       JOIN codeforces_accounts ca ON ca.user_id = css.user_id
       JOIN users u ON u.id = css.user_id
      WHERE ca.status = 'ACTIVE'
        AND u.status = 'ACTIVE'
      ORDER BY css.last_synced_at IS NOT NULL ASC, css.last_synced_at ASC
      LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    handle: r.handle as string,
    lastSubmissionId: Number(r.last_submission_id),
    solvedCount: Number(r.solved_count),
  }));
}

/** Persist solved delta for one user (idempotent via INSERT IGNORE). */
async function flushSolvedDelta(
  userId: number,
  newKeys: string[],
  newLastSubmissionId: number,
  solvedDelta: number,
): Promise<void> {
  if (newKeys.length > 0) {
    // Bulk INSERT IGNORE in chunks of 500.
    const CHUNK = 500;
    for (let i = 0; i < newKeys.length; i += CHUNK) {
      const chunk = newKeys.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?,?)').join(',');
      const values = chunk.flatMap((k) => [userId, k]);
      await pool.query(
        `INSERT IGNORE INTO codeforces_solved_problems (user_id, problem_key) VALUES ${placeholders}`,
        values,
      );
    }
  }

  await pool.query(
    `UPDATE codeforces_solved_state
        SET last_submission_id = GREATEST(last_submission_id, ?),
            solved_count = solved_count + ?,
            last_synced_at = NOW(),
            last_error = NULL
      WHERE user_id = ?`,
    [newLastSubmissionId, solvedDelta, userId],
  );
}

async function markSolvedError(userId: number, error: string): Promise<void> {
  await pool.query(
    `UPDATE codeforces_solved_state SET last_error = ? WHERE user_id = ?`,
    [error.slice(0, 499), userId],
  );
}

async function markAccountNotFound(userId: number): Promise<void> {
  await pool.query(
    `UPDATE codeforces_accounts SET status = 'NOT_FOUND', last_checked_at = NOW()
      WHERE user_id = ?`,
    [userId],
  );
}

function problemKey(sub: cf.CfSubmission): string {
  // §E3 key format: "contestId-index" or "ps:{problemsetName}:{name}"
  if (sub.contestId != null) {
    return `${sub.contestId}-${sub.problem.index}`;
  }
  const setName = sub.problem.problemsetName ?? 'unknown';
  return `ps:${setName}:${sub.problem.name}`;
}

async function insertJobRun(
  status: 'RUNNING' | 'OK' | 'FAILED',
  detail: object | null,
  startedAt: Date,
): Promise<number> {
  const [res] = await pool.query<any>(
    `INSERT INTO job_runs (job_code, status, started_at, finished_at, duration_ms, detail)
     VALUES ('solved-sync', ?, ?,
             IF(? = 'RUNNING', NULL, NOW()),
             IF(? = 'RUNNING', NULL, TIMESTAMPDIFF(MICROSECOND, ?, NOW()) / 1000), ?)`,
    [status, startedAt, status, status, startedAt, detail ? JSON.stringify(detail) : null],
  );
  return res.insertId;
}

async function updateJobRun(
  id: number,
  status: 'OK' | 'FAILED',
  detail: object,
  startedAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE job_runs
        SET status = ?, finished_at = NOW(),
            duration_ms = TIMESTAMPDIFF(MICROSECOND, ?, NOW()) / 1000,
            detail = ?
      WHERE id = ?`,
    [status, startedAt, JSON.stringify(detail), id],
  );
}

// ---------------------------------------------------------------------------
// Per-user incremental sync
// ---------------------------------------------------------------------------

type SyncResult = 'ok' | 'rate_limited' | 'not_found' | 'error';

async function syncUser(user: SyncUser): Promise<{ result: SyncResult; cfCalls: number; newSolved: number }> {
  let cfCalls = 0;
  let newSolved = 0;
  const newKeys: string[] = [];
  let newMaxSubmissionId = user.lastSubmissionId;
  let from = 1;
  const maxPages = env.SOLVED_SYNC_MAX_PAGES_PER_USER;

  for (let page = 0; page < maxPages; page++) {
    cfCalls++;
    let subs: cf.CfSubmission[];
    try {
      subs = await cf.userStatus(user.handle, from, 500);
    } catch (err) {
      if (err instanceof CfRateLimitError) return { result: 'rate_limited', cfCalls, newSolved };
      if (err instanceof CfHandleError) {
        await markAccountNotFound(user.userId);
        return { result: 'not_found', cfCalls, newSolved };
      }
      const msg = err instanceof Error ? err.message : String(err);
      await markSolvedError(user.userId, msg);
      return { result: 'error', cfCalls, newSolved };
    }

    if (subs.length === 0) break; // no more submissions

    let hitOverlap = false;
    for (const sub of subs) {
      if (sub.id <= user.lastSubmissionId) {
        hitOverlap = true;
        break;
      }
      if (sub.id > newMaxSubmissionId) newMaxSubmissionId = sub.id;
      if (sub.verdict === 'OK') {
        newKeys.push(problemKey(sub));
      }
    }

    from += 500;

    if (hitOverlap || subs.length < 500) break; // reached previously-seen or end of history
  }

  // Flush — INSERT IGNORE ensures idempotency even if we re-process a submission.
  // solved_delta is only the count of keys actually inserted (DB reports affected rows),
  // but for simplicity we defer accurate delta to the INSERT IGNORE logic below.
  if (newKeys.length > 0 || newMaxSubmissionId > user.lastSubmissionId) {
    // De-dup keys within this run first (a user may have solved same problem multiple times).
    const uniqueKeys = [...new Set(newKeys)];

    // We can't get exact "actually new" count without checking existing rows,
    // but INSERT IGNORE gives us that via affectedRows. Fetch delta via a transaction.
    const conn = await pool.getConnection();
    try {
      // Count pre-existing keys to compute accurate delta.
      let actualDelta = 0;
      const CHUNK = 500;
      for (let i = 0; i < uniqueKeys.length; i += CHUNK) {
        const chunk = uniqueKeys.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const [existing] = await conn.query<RowDataPacket[]>(
          `SELECT problem_key FROM codeforces_solved_problems
            WHERE user_id = ? AND problem_key IN (${placeholders})`,
          [user.userId, ...chunk],
        );
        actualDelta += chunk.length - existing.length;
      }

      // INSERT IGNORE the new keys.
      if (uniqueKeys.length > 0) {
        for (let i = 0; i < uniqueKeys.length; i += CHUNK) {
          const chunk = uniqueKeys.slice(i, i + CHUNK);
          const ph = chunk.map(() => '(?,?)').join(',');
          await conn.query(
            `INSERT IGNORE INTO codeforces_solved_problems (user_id, problem_key) VALUES ${ph}`,
            chunk.flatMap((k) => [user.userId, k]),
          );
        }
      }

      // Update state.
      await conn.query(
        `UPDATE codeforces_solved_state
            SET last_submission_id = GREATEST(last_submission_id, ?),
                solved_count = solved_count + ?,
                last_synced_at = NOW(),
                last_error = NULL
          WHERE user_id = ?`,
        [newMaxSubmissionId, actualDelta, user.userId],
      );

      newSolved = actualDelta;
    } finally {
      conn.release();
    }
  } else {
    // Nothing new — just update timestamp.
    await pool.query(
      `UPDATE codeforces_solved_state SET last_synced_at = NOW(), last_error = NULL WHERE user_id = ?`,
      [user.userId],
    );
  }

  return { result: 'ok', cfCalls, newSolved };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const startedAt = new Date();
  console.log('[solved-sync] starting');

  const result = await withLock(LOCK_NAME, async () => {
    const jobRunId = await insertJobRun('RUNNING', null, startedAt);
    let usersSynced = 0;
    let totalCfCalls = 0;
    let totalNewSolved = 0;

    try {
      const users = await fetchUsersToSync(env.SOLVED_SYNC_USERS_PER_RUN);
      console.log(`[solved-sync] ${users.length} users to sync`);

      for (const user of users) {
        const { result: userResult, cfCalls, newSolved } = await syncUser(user);
        totalCfCalls += cfCalls;
        totalNewSolved += newSolved;

        if (userResult === 'rate_limited') {
          console.warn('[solved-sync] rate-limited — stopping early, rest picked up next night');
          break;
        }
        if (userResult === 'ok' || userResult === 'not_found') {
          usersSynced++;
        }
        // 'error' users count as attempted but not successfully synced; continue to next.
      }

      await updateJobRun(jobRunId, 'OK', {
        usersSynced,
        cfCalls: totalCfCalls,
        newSolved: totalNewSolved,
      }, startedAt);

      console.log(
        `[solved-sync] done — ${usersSynced} synced, ${totalCfCalls} CF calls, ${totalNewSolved} new solved`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[solved-sync] fatal error: ${msg}`);
      await updateJobRun(jobRunId, 'FAILED', { error: msg }, startedAt);
      throw err;
    }
  });

  if (result === null) {
    console.log('[solved-sync] another instance is running — exiting 0');
  }
}

await run();
await pool.end();
