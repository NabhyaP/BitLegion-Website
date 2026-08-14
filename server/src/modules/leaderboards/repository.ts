/**
 * ALL SQL for leaderboard_versions, leaderboard_entries, leaderboard_active,
 * codeforces_rating_daily (§0.5 — no SQL outside repositories).
 */
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';

type Db = Pool | PoolConnection;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VersionStatus = 'RUNNING' | 'READY' | 'FAILED' | 'ABANDONED';

export type LeaderboardVersion = {
  id: number;
  status: VersionStatus;
  startedAt: Date;
  completedAt: Date | null;
  handlesRequested: number;
  handlesUpdated: number;
  handlesStale: number;
  cfCalls: number;
  errorSummary: string | null;
};

export type LeaderboardEntry = {
  versionId: number;
  userId: number;
  position: number;
  handle: string;
  rating: number;
  maxRating: number;
  cfRank: string | null;
  cfMaxRank: string | null;
  solvedCount: number | null;
  contribution: number | null;
  lastOnlineAt: Date | null;
  avatarUrl: string | null;
  profileUpdatedAt: Date;
  stale: boolean;
};

// ---------------------------------------------------------------------------
// leaderboard_versions
// ---------------------------------------------------------------------------

export async function createVersion(db: Db = defaultPool): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO leaderboard_versions (status) VALUES ('RUNNING')`,
  );
  return res.insertId;
}

export async function updateVersionStats(
  versionId: number,
  stats: {
    handlesRequested: number;
    handlesUpdated: number;
    handlesStale: number;
    cfCalls: number;
    errorSummary?: string | null;
  },
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `UPDATE leaderboard_versions
        SET handles_requested = ?, handles_updated = ?, handles_stale = ?,
            cf_calls = ?, error_summary = ?
      WHERE id = ?`,
    [
      stats.handlesRequested,
      stats.handlesUpdated,
      stats.handlesStale,
      stats.cfCalls,
      stats.errorSummary ?? null,
      versionId,
    ],
  );
}

export async function markVersionReady(versionId: number, db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE leaderboard_versions
        SET status = 'READY', completed_at = NOW()
      WHERE id = ?`,
    [versionId],
  );
}

export async function markVersionFailed(
  versionId: number,
  errorSummary: string,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `UPDATE leaderboard_versions
        SET status = 'FAILED', completed_at = NOW(), error_summary = ?
      WHERE id = ?`,
    [errorSummary, versionId],
  );
}

export async function abandonStaleRunningVersions(db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE leaderboard_versions
        SET status = 'ABANDONED'
      WHERE status = 'RUNNING'
        AND started_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
  );
}

/** Returns the most recent READY version id, or null if none exists. */
export async function getActiveVersionId(db: Db = defaultPool): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT version_id FROM leaderboard_active WHERE id = 1`,
  );
  return rows[0] ? Number(rows[0].version_id) : null;
}

/** Returns the completedAt of the active version (for the health endpoint). */
export async function getActiveVersionCompletedAt(db: Db = defaultPool): Promise<Date | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT v.completed_at
       FROM leaderboard_active la
       JOIN leaderboard_versions v ON v.id = la.version_id
      WHERE la.id = 1`,
  );
  return rows[0]?.completed_at ? new Date(rows[0].completed_at) : null;
}

/**
 * Atomically mark a version READY and point leaderboard_active at it.
 * This is the single transaction that publishes a snapshot (§0.4.4).
 */
export async function activateVersion(versionId: number, db: Db = defaultPool): Promise<void> {
  // Both writes in one call; callers wrapping in a transaction may pass conn.
  await db.query(
    `UPDATE leaderboard_versions SET status = 'READY', completed_at = NOW() WHERE id = ?`,
    [versionId],
  );
  await db.query(
    `INSERT INTO leaderboard_active (id, version_id, activated_at)
     VALUES (1, ?, NOW())
     ON DUPLICATE KEY UPDATE version_id = VALUES(version_id), activated_at = VALUES(activated_at)`,
    [versionId],
  );
}

// ---------------------------------------------------------------------------
// leaderboard_entries
// ---------------------------------------------------------------------------

/**
 * Bulk-insert entries in chunks of 200 to avoid oversized packets.
 */
export async function bulkInsertEntries(
  entries: Omit<LeaderboardEntry, never>[],
  db: Db = defaultPool,
): Promise<void> {
  if (entries.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const values = chunk.flatMap((e) => [
      e.versionId,
      e.userId,
      e.position,
      e.handle,
      e.rating,
      e.maxRating,
      e.cfRank ?? null,
      e.cfMaxRank ?? null,
      e.solvedCount ?? null,
      e.contribution ?? null,
      e.lastOnlineAt ?? null,
      e.avatarUrl ?? null,
      e.profileUpdatedAt,
      e.stale ? 1 : 0,
    ]);
    await db.query(
      `INSERT INTO leaderboard_entries
         (version_id, user_id, position, handle, rating, max_rating,
          cf_rank, cf_max_rank, solved_count, contribution,
          last_online_at, avatar_url, profile_updated_at, stale)
       VALUES ${placeholders}`,
      values,
    );
  }
}

/** Fetch all entries for a specific version (used for carry-forward). */
export async function getEntriesForVersion(
  versionId: number,
  db: Db = defaultPool,
): Promise<LeaderboardEntry[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT version_id, user_id, position, handle, rating, max_rating,
            cf_rank, cf_max_rank, solved_count, contribution,
            last_online_at, avatar_url, profile_updated_at, stale
       FROM leaderboard_entries WHERE version_id = ?`,
    [versionId],
  );
  return rows.map(toEntry);
}

function toEntry(r: RowDataPacket): LeaderboardEntry {
  return {
    versionId: Number(r.version_id),
    userId: Number(r.user_id),
    position: Number(r.position),
    handle: r.handle as string,
    rating: Number(r.rating),
    maxRating: Number(r.max_rating),
    cfRank: (r.cf_rank as string | null) ?? null,
    cfMaxRank: (r.cf_max_rank as string | null) ?? null,
    solvedCount: r.solved_count != null ? Number(r.solved_count) : null,
    contribution: r.contribution != null ? Number(r.contribution) : null,
    lastOnlineAt: r.last_online_at ? new Date(r.last_online_at) : null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    profileUpdatedAt: new Date(r.profile_updated_at),
    stale: Boolean(r.stale),
  };
}

// ---------------------------------------------------------------------------
// codeforces_rating_daily
// ---------------------------------------------------------------------------

export async function upsertRatingDaily(
  userId: number,
  rating: number,
  maxRating: number,
  solvedCount: number | null,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `INSERT INTO codeforces_rating_daily (user_id, snapshot_date, rating, max_rating, solved_count)
     VALUES (?, CURDATE(), ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), max_rating = VALUES(max_rating),
       solved_count = VALUES(solved_count)`,
    [userId, rating, maxRating, solvedCount ?? null],
  );
}

// ---------------------------------------------------------------------------
// Retention helpers (§E4)
// ---------------------------------------------------------------------------

/**
 * Delete all READY versions except the 3 most recent.
 * Also skips the version currently referenced by leaderboard_active (FK safety).
 * Uses `completed_at DESC, id DESC` to break ties when versions complete in the same second.
 * Cascade delete removes their entries automatically.
 */
export async function pruneOldReadyVersions(db: Db = defaultPool): Promise<void> {
  await db.query(
    `DELETE FROM leaderboard_versions
      WHERE status = 'READY'
        AND id NOT IN (
          SELECT id FROM (
            SELECT id FROM leaderboard_versions
             WHERE status = 'READY'
             ORDER BY completed_at DESC, id DESC
             LIMIT 3
          ) keep_ids
        )
        AND id NOT IN (
          SELECT version_id FROM leaderboard_active
        )`,
  );
}

/** Delete daily rating rows older than 24 months (§E4). */
export async function pruneRatingDaily(db: Db = defaultPool): Promise<void> {
  await db.query(
    `DELETE FROM codeforces_rating_daily
      WHERE snapshot_date < DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`,
  );
}
