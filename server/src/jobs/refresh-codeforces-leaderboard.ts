/**
 * Job 1 — Leaderboard snapshot refresh (§E2).
 * Runs hourly via Hostinger Cron: `node dist/jobs/refresh-codeforces-leaderboard.js`
 *
 * 14-step flow per spec:
 *  1.  GET_LOCK — exit 0 if already running.
 *  2.  INSERT leaderboard_versions RUNNING; job_runs RUNNING.
 *  3.  Read all ACTIVE/TEMPORARY_ERROR cf accounts + users.
 *  4.  Batches of LEADERBOARD_BATCH_SIZE.
 *  5.  Sequential cf.userInfo per batch; bisect on bad handle → mark NOT_FOUND/RENAMED.
 *  6.  Normalize-compare; mismatch → RENAMED_OR_MISMATCHED.
 *  7.  Fetch-failed users: carry forward from previous READY version with stale=1.
 *  8.  LEFT JOIN codeforces_solved_state → solved_count.
 *  9.  Position by rating DESC, max_rating DESC, normalized_handle ASC.
 * 10.  Bulk insert entries (chunks of 200).
 * 11.  ONE transaction: activateVersion (READY + leaderboard_active pointer).
 * 12.  Append codeforces_rating_daily.
 * 13.  job_runs OK.
 * 14.  RELEASE_LOCK (via withLock finally).
 */

import { pool } from '../db/pool.ts';
import { env } from '../config/env.ts';
import { withLock } from '../shared/lock.ts';
import * as cf from '../shared/cf-client.ts';
import * as lbRepo from '../modules/leaderboards/repository.ts';
import type { LeaderboardEntry } from '../modules/leaderboards/repository.ts';
import type { RowDataPacket } from 'mysql2/promise';
import { CfHandleError, CfRateLimitError, CfUnavailableError } from '../shared/cf-client.ts';

const LOCK_NAME = 'bitlegion:cf-leaderboard';

// ---------------------------------------------------------------------------
// DB helpers local to this job
// ---------------------------------------------------------------------------

type LinkedUser = {
  userId: number;
  handle: string;
  normalizedHandle: string;
  cfAccountId: number;
};

async function fetchLinkedUsers(): Promise<LinkedUser[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ca.id AS cf_account_id, ca.user_id, ca.handle, ca.normalized_handle
       FROM codeforces_accounts ca
       JOIN users u ON u.id = ca.user_id
      WHERE ca.status IN ('ACTIVE', 'TEMPORARY_ERROR')
        AND u.status = 'ACTIVE'`,
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    handle: r.handle as string,
    normalizedHandle: r.normalized_handle as string,
    cfAccountId: Number(r.cf_account_id),
  }));
}

async function fetchSolvedCounts(): Promise<Map<number, number | null>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id, solved_count FROM codeforces_solved_state`,
  );
  const m = new Map<number, number | null>();
  for (const r of rows) m.set(Number(r.user_id), r.solved_count != null ? Number(r.solved_count) : null);
  return m;
}

async function markAccountStatus(
  userId: number,
  status: 'NOT_FOUND' | 'RENAMED_OR_MISMATCHED' | 'TEMPORARY_ERROR',
): Promise<void> {
  await pool.query(
    `UPDATE codeforces_accounts SET status = ?, last_checked_at = NOW() WHERE user_id = ?`,
    [status, userId],
  );
}

async function insertJobRun(status: 'RUNNING' | 'OK' | 'FAILED', detail: object | null, startedAt: Date): Promise<number> {
  const [res] = await pool.query<any>(
    `INSERT INTO job_runs (job_code, status, started_at, finished_at, duration_ms, detail)
     VALUES ('lb-refresh', ?, ?, IF(? = 'RUNNING', NULL, NOW()),
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
// Bisect helper (§E2 step 5)
// ---------------------------------------------------------------------------

/**
 * When CF reports a bad handle in a batch, binary-search to find which handles
 * are bad, marking them in the DB and removing from the 'good' set.
 */
async function bisectBadHandles(
  batch: LinkedUser[],
  badHandles: Set<string>,
): Promise<cf.CfUserInfo[]> {
  if (batch.length === 1) {
    const user = batch[0]!;
    badHandles.add(user.normalizedHandle);
    // Determine: NOT_FOUND vs RENAMED — CF doesn't give us enough info here so use NOT_FOUND.
    await markAccountStatus(user.userId, 'NOT_FOUND');
    console.warn(`[lb-refresh] bad handle: ${user.handle} (user ${user.userId}) → NOT_FOUND`);
    return [];
  }

  const mid = Math.floor(batch.length / 2);
  const left = batch.slice(0, mid);
  const right = batch.slice(mid);

  const results: cf.CfUserInfo[] = [];

  for (const half of [left, right]) {
    try {
      const res = await cf.userInfo(half.map((u) => u.handle));
      results.push(...res);
    } catch (err) {
      if (err instanceof CfHandleError) {
        // Recurse into this half to isolate the bad handle(s).
        const sub = await bisectBadHandles(half, badHandles);
        results.push(...sub);
      } else {
        throw err; // propagate rate-limit / unavailable
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const startedAt = new Date();
  console.log('[lb-refresh] starting');

  const result = await withLock(LOCK_NAME, async () => {
    // Abandon stale RUNNING versions from previous crashed runs.
    await lbRepo.abandonStaleRunningVersions();

    const versionId = await lbRepo.createVersion();
    const jobRunId = await insertJobRun('RUNNING', null, startedAt);

    let handlesRequested = 0;
    let handlesUpdated = 0;
    let handlesStale = 0;
    let cfCalls = 0;
    let errorSummary: string | null = null;

    try {
      // Step 3: users to snapshot.
      const users = await fetchLinkedUsers();
      handlesRequested = users.length;

      if (users.length === 0) {
        console.log('[lb-refresh] no linked users — publishing empty snapshot');
      }

      // Step 4–6: batch CF calls.
      const goodResults = new Map<string, cf.CfUserInfo>(); // normalizedHandle → info
      const badHandles = new Set<string>();                  // normalized handles that errored

      const batchSize = env.LEADERBOARD_BATCH_SIZE;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        cfCalls++;
        try {
          const infos = await cf.userInfo(batch.map((u) => u.handle));
          for (const info of infos) {
            goodResults.set(info.handle.toLowerCase(), info);
          }
          handlesUpdated += infos.length;
        } catch (err) {
          if (err instanceof CfHandleError) {
            // Step 5: bisect to isolate bad handles.
            const infos = await bisectBadHandles(batch, badHandles);
            for (const info of infos) {
              goodResults.set(info.handle.toLowerCase(), info);
            }
            handlesUpdated += infos.length;
          } else if (err instanceof CfRateLimitError) {
            // Rate-limited mid-run — stop cleanly; remaining users get stale carry-forward.
            console.warn('[lb-refresh] rate-limited, stopping batch loop early');
            errorSummary = 'Rate-limited mid-run; some entries carried forward.';
            // Mark remaining users as not fetched (handled by stale logic below).
            for (let j = i + batchSize; j < users.length; j++) {
              badHandles.add(users[j]!.normalizedHandle);
            }
            break;
          } else {
            // Temporary CF unavailability — mark all batch users as stale.
            for (const u of batch) badHandles.add(u.normalizedHandle);
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[lb-refresh] batch ${i}-${i + batchSize} unavailable: ${msg}`);
          }
        }
      }

      // Step 6: mismatch detection (CF returned a handle that doesn't match expected).
      for (const user of users) {
        const returned = goodResults.get(user.normalizedHandle);
        if (returned && returned.handle.toLowerCase() !== user.normalizedHandle) {
          // CF account renamed — mark it.
          await markAccountStatus(user.userId, 'RENAMED_OR_MISMATCHED');
          goodResults.delete(user.normalizedHandle);
          badHandles.add(user.normalizedHandle);
        }
      }

      // Step 7: stale carry-forward from previous READY version.
      const prevVersionId = await lbRepo.getActiveVersionId();
      let prevEntries: Map<number, LeaderboardEntry> = new Map();
      if (prevVersionId !== null) {
        const prev = await lbRepo.getEntriesForVersion(prevVersionId);
        for (const e of prev) prevEntries.set(e.userId, e);
      }

      // Step 8: solved counts.
      const solvedCounts = await fetchSolvedCounts();

      // Step 9: build entries, position by rating DESC, max_rating DESC, normalized_handle ASC.
      const entries: LeaderboardEntry[] = [];

      for (const user of users) {
        const info = goodResults.get(user.normalizedHandle);
        const solvedCount = solvedCounts.get(user.userId) ?? null;

        if (info) {
          entries.push({
            versionId,
            userId: user.userId,
            position: 0, // assigned after sort
            handle: info.handle,
            rating: info.rating ?? 0,
            maxRating: info.maxRating ?? 0,
            cfRank: info.rank ?? null,
            cfMaxRank: info.maxRank ?? null,
            solvedCount,
            contribution: info.contribution ?? null,
            lastOnlineAt: info.lastOnlineTimeSeconds
              ? new Date(info.lastOnlineTimeSeconds * 1000)
              : null,
            avatarUrl: info.titlePhoto ?? info.avatar ?? null,
            profileUpdatedAt: new Date(),
            stale: false,
          });
        } else if (badHandles.has(user.normalizedHandle)) {
          // Carry forward from previous version with stale=1.
          const prev = prevEntries.get(user.userId);
          if (prev) {
            handlesStale++;
            entries.push({
              ...prev,
              versionId,
              solvedCount: solvedCount ?? prev.solvedCount,
              stale: true,
            });
          }
          // If no previous entry exists (new user whose first fetch failed), skip entirely.
        }
      }

      // Sort: rating DESC, max_rating DESC, normalized_handle ASC (tie-breaking).
      entries.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.maxRating !== a.maxRating) return b.maxRating - a.maxRating;
        return a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());
      });

      // Assign positions (1-based).
      for (let i = 0; i < entries.length; i++) entries[i]!.position = i + 1;

      // Update stats before activation.
      await lbRepo.updateVersionStats(versionId, {
        handlesRequested,
        handlesUpdated,
        handlesStale,
        cfCalls,
        errorSummary,
      });

      // Step 10–11: bulk insert + atomic activation in a single connection transaction.
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await lbRepo.bulkInsertEntries(entries, conn);
        await lbRepo.activateVersion(versionId, conn);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      // Step 12: append daily ratings (best-effort, outside the main transaction).
      for (const entry of entries) {
        if (!entry.stale) {
          await lbRepo.upsertRatingDaily(entry.userId, entry.rating, entry.maxRating, entry.solvedCount);
        }
      }

      // Step 13: job_runs OK.
      await updateJobRun(jobRunId, 'OK', {
        handlesRequested,
        handlesUpdated,
        handlesStale,
        cfCalls,
        errorSummary,
      }, startedAt);

      console.log(
        `[lb-refresh] done — version ${versionId}, ` +
        `${handlesUpdated} updated, ${handlesStale} stale, ${cfCalls} CF calls`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[lb-refresh] fatal error: ${msg}`);
      await lbRepo.markVersionFailed(versionId, msg.slice(0, 999));
      await updateJobRun(jobRunId, 'FAILED', { error: msg }, startedAt);
      throw err;
    }
  });

  if (result === null) {
    console.log('[lb-refresh] another instance is running — exiting 0');
  }
}

await run();
await pool.end();
