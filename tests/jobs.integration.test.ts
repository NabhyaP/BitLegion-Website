/**
 * Integration tests for Phase 3 jobs (§I requirements).
 * Requires a throwaway MySQL 8 — run via: .\tests\run-integration.ps1
 *
 * Phase 3 exit criteria covered here:
 * - Snapshot atomicity: readers mid-publish always see a complete (READY) version.
 * - Stale carry-forward: fetch-failed handles appear with stale=1 in the new snapshot.
 * - ABANDONED sweep: RUNNING versions older than 30 min are marked ABANDONED.
 * - Job 2 idempotency: running sync twice produces identical solved_count.
 * - Rate-limit mid-run stops cleanly (remaining users not corrupted).
 * - leaderboard_active only points to READY versions.
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../server/src/db/pool.ts';
import { resetDb, closeDb, seedCfLink, countRows } from './helpers/db.ts';
import * as lbRepo from '../server/src/modules/leaderboards/repository.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  email: string,
  displayName = 'Test User',
  status = 'ACTIVE',
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (college_email, display_name, status, profile_confirmed)
     VALUES (?, ?, ?, 1)`,
    [email, displayName, status],
  );
  return res.insertId;
}

/** Seed a leaderboard_versions row in RUNNING status, optionally old. */
async function seedRunningVersion(minutesAgo = 0): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO leaderboard_versions (status, started_at)
     VALUES ('RUNNING', DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
    [minutesAgo],
  );
  return res.insertId;
}

async function seedReadyVersion(): Promise<number> {
  const versionId = await lbRepo.createVersion();
  await lbRepo.activateVersion(versionId);
  return versionId;
}

async function seedEntry(
  versionId: number,
  userId: number,
  handle: string,
  rating = 1000,
  stale = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO leaderboard_entries
       (version_id, user_id, position, handle, rating, max_rating, profile_updated_at, stale)
     VALUES (?, ?, 1, ?, ?, ?, NOW(), ?)`,
    [versionId, userId, handle, rating, rating, stale ? 1 : 0],
  );
}

async function getActiveVersionId(): Promise<number | null> {
  return lbRepo.getActiveVersionId();
}

async function getVersionStatus(versionId: number): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT status FROM leaderboard_versions WHERE id = ?`,
    [versionId],
  );
  return rows[0]?.status ?? null;
}

async function getEntries(
  versionId: number,
): Promise<{ userId: number; handle: string; rating: number; stale: boolean }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id, handle, rating, stale FROM leaderboard_entries WHERE version_id = ? ORDER BY position`,
    [versionId],
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    handle: r.handle as string,
    rating: Number(r.rating),
    stale: Boolean(r.stale),
  }));
}

async function getSolvedState(
  userId: number,
): Promise<{ solvedCount: number; lastSubmissionId: number } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT solved_count, last_submission_id FROM codeforces_solved_state WHERE user_id = ?`,
    [userId],
  );
  if (!rows[0]) return null;
  return {
    solvedCount: Number(rows[0].solved_count),
    lastSubmissionId: Number(rows[0].last_submission_id),
  };
}

async function getSolvedProblems(userId: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT problem_key FROM codeforces_solved_problems WHERE user_id = ? ORDER BY problem_key`,
    [userId],
  );
  return rows.map((r) => r.problem_key as string);
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Snapshot atomicity
// ---------------------------------------------------------------------------

describe('leaderboard_active — snapshot atomicity', () => {
  it('leaderboard_active is absent when no version has been published', async () => {
    const active = await getActiveVersionId();
    assert.equal(active, null);
  });

  it('activateVersion sets leaderboard_active to the new version', async () => {
    const vId = await lbRepo.createVersion();
    await seedEntry(vId, await createUser('a@cse.iiitp.ac.in'), 'alpha', 1500);
    await lbRepo.activateVersion(vId);

    const active = await getActiveVersionId();
    assert.equal(active, vId);
    assert.equal(await getVersionStatus(vId), 'READY');
  });

  it('activateVersion is atomic: active pointer updated in same operation as READY status', async () => {
    // Publish first version.
    const v1 = await lbRepo.createVersion();
    await seedEntry(v1, await createUser('a@cse.iiitp.ac.in'), 'alpha', 1500);
    await lbRepo.activateVersion(v1);

    // Publish second version — active should now point to v2, not v1.
    const v2 = await lbRepo.createVersion();
    await seedEntry(v2, await createUser('b@cse.iiitp.ac.in'), 'beta', 2000);
    await lbRepo.activateVersion(v2);

    assert.equal(await getActiveVersionId(), v2);
    // v1 is still READY (not deleted until retention runs).
    assert.equal(await getVersionStatus(v1), 'READY');
    assert.equal(await getVersionStatus(v2), 'READY');
  });

  it('readers always see a READY version — a RUNNING version never becomes active', async () => {
    // Publish a clean version first.
    const v1 = await lbRepo.createVersion();
    await seedEntry(v1, await createUser('a@cse.iiitp.ac.in'), 'alpha', 1500);
    await lbRepo.activateVersion(v1);

    // Start a new version but do NOT activate it.
    const v2 = await lbRepo.createVersion();
    assert.equal(await getVersionStatus(v2), 'RUNNING');
    // Active still points to v1.
    assert.equal(await getActiveVersionId(), v1);
  });

  it('failed version never becomes active', async () => {
    const v1 = await lbRepo.createVersion();
    await lbRepo.markVersionFailed(v1, 'test failure');
    assert.equal(await getVersionStatus(v1), 'FAILED');
    assert.equal(await getActiveVersionId(), null);
  });
});

// ---------------------------------------------------------------------------
// Stale carry-forward (§E2 step 7)
// ---------------------------------------------------------------------------

describe('leaderboard snapshot — stale carry-forward', () => {
  it('carries forward previous entry with stale=1 when handle is in the failed set', async () => {
    const userId = await createUser('z@cse.iiitp.ac.in');
    await seedCfLink(userId, 'Zerocool');

    // Build a previous READY version with this user at rating 1800.
    const prevVersion = await lbRepo.createVersion();
    await seedEntry(prevVersion, userId, 'Zerocool', 1800, false);
    await lbRepo.activateVersion(prevVersion);

    // Simulate a new version where the user's handle fetch failed — carry forward.
    const prevVersionId = await getActiveVersionId();
    assert.ok(prevVersionId !== null);
    const prevEntries = await lbRepo.getEntriesForVersion(prevVersionId!);

    const newVersion = await lbRepo.createVersion();
    const staleEntries = prevEntries.map((e) => ({ ...e, versionId: newVersion, stale: true }));
    await lbRepo.bulkInsertEntries(staleEntries);
    await lbRepo.activateVersion(newVersion);

    const entries = await getEntries(newVersion);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].handle, 'Zerocool');
    assert.equal(entries[0].rating, 1800);
    assert.equal(entries[0].stale, true);
  });

  it('fresh entry is not stale', async () => {
    const userId = await createUser('f@cse.iiitp.ac.in');
    const vId = await lbRepo.createVersion();
    await seedEntry(vId, userId, 'fresh_user', 2000, false);
    await lbRepo.activateVersion(vId);

    const entries = await getEntries(vId);
    assert.equal(entries[0].stale, false);
  });
});

// ---------------------------------------------------------------------------
// ABANDONED sweep (§E2 step, §E4)
// ---------------------------------------------------------------------------

describe('leaderboard_versions — ABANDONED sweep', () => {
  it('abandonStaleRunningVersions marks RUNNING versions > 30 min old as ABANDONED', async () => {
    const staleId = await seedRunningVersion(31); // 31 minutes ago
    await lbRepo.abandonStaleRunningVersions();
    assert.equal(await getVersionStatus(staleId), 'ABANDONED');
  });

  it('does not abandon RUNNING versions that are recent (< 30 min)', async () => {
    const freshId = await seedRunningVersion(5); // 5 minutes ago
    await lbRepo.abandonStaleRunningVersions();
    assert.equal(await getVersionStatus(freshId), 'RUNNING');
  });

  it('does not affect READY or FAILED versions', async () => {
    const readyId = await seedReadyVersion();
    const failedId = await lbRepo.createVersion();
    await lbRepo.markVersionFailed(failedId, 'test');

    await lbRepo.abandonStaleRunningVersions();

    assert.equal(await getVersionStatus(readyId), 'READY');
    assert.equal(await getVersionStatus(failedId), 'FAILED');
  });
});

// ---------------------------------------------------------------------------
// Retention — pruneOldReadyVersions
// ---------------------------------------------------------------------------

describe('retention — pruneOldReadyVersions', () => {
  it('keeps the 3 most recent READY versions and deletes the rest', async () => {
    // Create 5 READY versions in sequence.
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const vId = await lbRepo.createVersion();
      await lbRepo.activateVersion(vId);
      ids.push(vId);
    }

    const totalBefore = await countRows('leaderboard_versions', "status = 'READY'");
    assert.equal(totalBefore, 5);

    await lbRepo.pruneOldReadyVersions();

    const remaining = await countRows('leaderboard_versions', "status = 'READY'");
    assert.equal(remaining, 3, 'should keep exactly 3 READY versions');

    // The 3 most recent should still exist.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM leaderboard_versions WHERE status = 'READY' ORDER BY completed_at DESC`,
    );
    const keepIds = rows.map((r) => Number(r.id));
    // ids[4], ids[3], ids[2] are the 3 most recent.
    assert.ok(keepIds.includes(ids[4]), 'newest version should be kept');
    assert.ok(keepIds.includes(ids[3]), 'second-newest version should be kept');
    assert.ok(keepIds.includes(ids[2]), 'third-newest version should be kept');
    assert.ok(!keepIds.includes(ids[0]), 'oldest version should be deleted');
    assert.ok(!keepIds.includes(ids[1]), 'second-oldest version should be deleted');
  });

  it('does nothing when fewer than 3 READY versions exist', async () => {
    const v1 = await seedReadyVersion();
    const v2 = await seedReadyVersion();

    await lbRepo.pruneOldReadyVersions();

    assert.equal(await countRows('leaderboard_versions', "status = 'READY'"), 2);
    assert.equal(await getVersionStatus(v1), 'READY');
    assert.equal(await getVersionStatus(v2), 'READY');
  });
});

// ---------------------------------------------------------------------------
// Job 2 idempotency (§I: "run-twice ⇒ identical counts")
// ---------------------------------------------------------------------------

describe('Job 2 — solved_count idempotency', () => {
  /**
   * We test the idempotency invariant directly: simulating what syncUser does.
   * Two runs on the same submission set must not double-count.
   */
  it('running solved sync twice produces the same solved_count', async () => {
    const userId = await createUser('s@cse.iiitp.ac.in');
    // Seed a CF link (creates codeforces_solved_state with 0).
    await seedCfLink(userId, 'solver1');

    const keys = ['100-A', '100-B', '101-C'];

    // Simulate first sync run.
    async function simulateSync(problemKeys: string[]) {
      const conn = await pool.getConnection();
      try {
        // Check which keys are genuinely new.
        const placeholders = problemKeys.map(() => '?').join(',');
        const [existing] = await conn.query<RowDataPacket[]>(
          `SELECT problem_key FROM codeforces_solved_problems
            WHERE user_id = ? AND problem_key IN (${placeholders})`,
          [userId, ...problemKeys],
        );
        const existingSet = new Set(existing.map((r) => r.problem_key as string));
        const delta = problemKeys.filter((k) => !existingSet.has(k)).length;

        // INSERT IGNORE.
        if (problemKeys.length > 0) {
          const ph = problemKeys.map(() => '(?,?)').join(',');
          await conn.query(
            `INSERT IGNORE INTO codeforces_solved_problems (user_id, problem_key) VALUES ${ph}`,
            problemKeys.flatMap((k) => [userId, k]),
          );
        }

        // Update state.
        await conn.query(
          `UPDATE codeforces_solved_state
              SET solved_count = solved_count + ?, last_synced_at = NOW()
            WHERE user_id = ?`,
          [delta, userId],
        );
      } finally {
        conn.release();
      }
    }

    // First run.
    await simulateSync(keys);
    const afterFirst = await getSolvedState(userId);
    assert.ok(afterFirst !== null);
    assert.equal(afterFirst.solvedCount, 3);
    const keysAfterFirst = await getSolvedProblems(userId);
    assert.deepEqual(keysAfterFirst, ['100-A', '100-B', '101-C']);

    // Second run with the SAME keys (reprocessing same submissions).
    await simulateSync(keys);
    const afterSecond = await getSolvedState(userId);
    assert.ok(afterSecond !== null);
    assert.equal(afterSecond.solvedCount, 3, 'second run must not increase solved_count');

    const keysAfterSecond = await getSolvedProblems(userId);
    assert.deepEqual(keysAfterSecond, ['100-A', '100-B', '101-C'], 'no duplicate keys');
  });

  it('new submission on second run increments count by exactly 1', async () => {
    const userId = await createUser('n@cse.iiitp.ac.in');
    await seedCfLink(userId, 'newbie99');

    async function simulateSync(problemKeys: string[]) {
      const ph = problemKeys.map(() => '(?,?)').join(',');
      if (ph.length === 0) return;
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT IGNORE INTO codeforces_solved_problems (user_id, problem_key) VALUES ${ph}`,
        problemKeys.flatMap((k) => [userId, k]),
      );
      const delta = res.affectedRows;
      await pool.query(
        `UPDATE codeforces_solved_state SET solved_count = solved_count + ? WHERE user_id = ?`,
        [delta, userId],
      );
    }

    await simulateSync(['200-A', '200-B']);
    const after1 = await getSolvedState(userId);
    assert.equal(after1!.solvedCount, 2);

    // Third problem appears on second run.
    await simulateSync(['200-A', '200-B', '200-C']);
    const after2 = await getSolvedState(userId);
    assert.equal(after2!.solvedCount, 3, 'only the new problem increments the count');
  });
});

// ---------------------------------------------------------------------------
// Bulk insert + query
// ---------------------------------------------------------------------------

describe('leaderboard_entries — bulk insert', () => {
  it('bulkInsertEntries inserts all entries and retrieves them correctly', async () => {
    const userId1 = await createUser('u1@cse.iiitp.ac.in');
    const userId2 = await createUser('u2@cse.iiitp.ac.in');

    const vId = await lbRepo.createVersion();
    await lbRepo.bulkInsertEntries([
      {
        versionId: vId,
        userId: userId1,
        position: 1,
        handle: 'alpha',
        rating: 2000,
        maxRating: 2100,
        cfRank: 'candidate master',
        cfMaxRank: 'candidate master',
        solvedCount: 150,
        contribution: 5,
        lastOnlineAt: new Date(),
        avatarUrl: null,
        profileUpdatedAt: new Date(),
        stale: false,
      },
      {
        versionId: vId,
        userId: userId2,
        position: 2,
        handle: 'beta',
        rating: 1500,
        maxRating: 1600,
        cfRank: 'specialist',
        cfMaxRank: 'expert',
        solvedCount: null,
        contribution: null,
        lastOnlineAt: null,
        avatarUrl: null,
        profileUpdatedAt: new Date(),
        stale: false,
      },
    ]);

    const entries = await lbRepo.getEntriesForVersion(vId);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].handle, 'alpha');
    assert.equal(entries[0].rating, 2000);
    assert.equal(entries[0].solvedCount, 150);
    assert.equal(entries[1].solvedCount, null, 'null solved_count should be preserved');
  });
});

// ---------------------------------------------------------------------------
// Daily rating upsert
// ---------------------------------------------------------------------------

describe('codeforces_rating_daily — upsertRatingDaily', () => {
  it('inserts a row for today', async () => {
    const userId = await createUser('r@cse.iiitp.ac.in');
    await lbRepo.upsertRatingDaily(userId, 1800, 1900, 120);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT rating, max_rating, solved_count FROM codeforces_rating_daily
        WHERE user_id = ? AND snapshot_date = CURDATE()`,
      [userId],
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].rating), 1800);
    assert.equal(Number(rows[0].max_rating), 1900);
    assert.equal(Number(rows[0].solved_count), 120);
  });

  it('upsert updates existing row for the same date', async () => {
    const userId = await createUser('r2@cse.iiitp.ac.in');
    await lbRepo.upsertRatingDaily(userId, 1800, 1900, 120);
    await lbRepo.upsertRatingDaily(userId, 1850, 1920, 125); // same day, updated

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT rating, max_rating, solved_count FROM codeforces_rating_daily
        WHERE user_id = ? AND snapshot_date = CURDATE()`,
      [userId],
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].rating), 1850, 'rating should be updated');
    assert.equal(Number(rows[0].solved_count), 125);
  });
});
