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

// ---------------------------------------------------------------------------
// Phase 4 — public leaderboard read query (§F leaderboard contract)
// ---------------------------------------------------------------------------

export type SortField = 'rating' | 'maxRating' | 'solvedCount';

/** Decoded cursor: the sort-key values of the last row on the previous page. */
export type LeaderboardCursor = {
  rating: number;
  maxRating: number;
  solvedCount: number | null;
  handle: string;
};

/** One row returned by queryLeaderboard (before contract mapping). */
export type LeaderboardRow = {
  userId: number;
  displayName: string;
  handle: string;
  batch: number | null;
  branch: string | null;
  rating: number;
  maxRating: number;
  codeforcesRank: string | null;
  ratingChange30d: number | null;
  solvedCount: number | null;
  avatarUrl: string | null;
  profileUpdatedAt: Date;
  stale: boolean;
};

export type QueryLeaderboardOptions = {
  versionId: number;
  sort: SortField;
  batch?: number | null;
  branch?: string | null;
  q?: string | null;
  limit: number;
  cursor?: LeaderboardCursor | null;
};

/**
 * Paginated leaderboard query with keyset cursor.
 *
 * Returns `limit + 1` rows so the caller can tell whether a next page exists.
 * Reads are filtered at query time by users.show_in_leaderboard = 1 AND users.status = 'ACTIVE'
 * (§0.4.3 — hide filter is instant without republishing the snapshot).
 *
 * ratingChange30d: rating today − rating ~30 days ago from codeforces_rating_daily.
 */
export async function queryLeaderboard(
  opts: QueryLeaderboardOptions,
  db: Db = defaultPool,
): Promise<LeaderboardRow[]> {
  const { versionId, sort, batch, branch, q, limit, cursor } = opts;

  // Build ORDER BY and cursor predicate based on sort field.
  // For solvedCount NULL rows come last (NULLS LAST semantics via ISNULL trick).
  let orderBy: string;
  let cursorWhere = '';
  const params: unknown[] = [versionId];

  if (sort === 'rating') {
    orderBy = 'le.rating DESC, le.max_rating DESC, le.handle ASC';
    if (cursor) {
      cursorWhere = `AND (le.rating < ? OR (le.rating = ? AND le.max_rating < ?) OR (le.rating = ? AND le.max_rating = ? AND le.handle > ?))`;
      params.push(cursor.rating, cursor.rating, cursor.maxRating, cursor.rating, cursor.maxRating, cursor.handle);
    }
  } else if (sort === 'maxRating') {
    orderBy = 'le.max_rating DESC, le.rating DESC, le.handle ASC';
    if (cursor) {
      cursorWhere = `AND (le.max_rating < ? OR (le.max_rating = ? AND le.rating < ?) OR (le.max_rating = ? AND le.rating = ? AND le.handle > ?))`;
      params.push(cursor.maxRating, cursor.maxRating, cursor.rating, cursor.maxRating, cursor.rating, cursor.handle);
    }
  } else {
    // solvedCount — NULL last; within solved rows desc by solved_count then rating then handle
    orderBy = 'ISNULL(le.solved_count) ASC, le.solved_count DESC, le.rating DESC, le.handle ASC';
    if (cursor) {
      if (cursor.solvedCount === null) {
        // previous page ended in NULL solved_count rows; cursor by handle only
        cursorWhere = `AND (ISNULL(le.solved_count) = 1 AND le.handle > ?)`;
        params.push(cursor.handle);
      } else {
        cursorWhere = `AND (ISNULL(le.solved_count) = 1 OR (le.solved_count < ?) OR (le.solved_count = ? AND le.rating < ?) OR (le.solved_count = ? AND le.rating = ? AND le.handle > ?))`;
        params.push(cursor.solvedCount, cursor.solvedCount, cursor.rating, cursor.solvedCount, cursor.rating, cursor.handle);
      }
    }
  }

  // Batch / branch / search filters
  if (batch != null) {
    params.push(batch);
  }
  if (branch != null) {
    params.push(branch.toUpperCase());
  }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    params.push(like, like);
  }

  // Limit (+1 to detect next page)
  params.push(limit + 1);

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       le.user_id,
       u.display_name,
       le.handle,
       u.batch_year,
       u.branch,
       le.rating,
       le.max_rating,
       le.cf_rank,
       le.solved_count,
       le.avatar_url,
       le.profile_updated_at,
       le.stale,
       (
         SELECT today.rating - past.rating
           FROM codeforces_rating_daily today
           JOIN codeforces_rating_daily past
             ON past.user_id = le.user_id
            AND past.snapshot_date = (
                  SELECT MAX(d2.snapshot_date)
                    FROM codeforces_rating_daily d2
                   WHERE d2.user_id = le.user_id
                     AND d2.snapshot_date <= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                )
          WHERE today.user_id = le.user_id
            AND today.snapshot_date = CURDATE()
          LIMIT 1
       ) AS rating_change_30d
     FROM leaderboard_entries le
     JOIN leaderboard_active la ON la.version_id = le.version_id
     JOIN users u ON u.id = le.user_id
     WHERE le.version_id = ?
       AND u.show_in_leaderboard = 1
       AND u.status = 'ACTIVE'
       ${cursorWhere}
       ${batch != null ? 'AND u.batch_year = ?' : ''}
       ${branch != null ? 'AND u.branch = ?' : ''}
       ${q ? 'AND (u.display_name LIKE ? OR le.handle LIKE ?)' : ''}
     ORDER BY ${orderBy}
     LIMIT ?`,
    params,
  );

  return rows.map((r) => ({
    userId: Number(r.user_id),
    displayName: r.display_name as string,
    handle: r.handle as string,
    batch: r.batch_year != null ? Number(r.batch_year) : null,
    branch: (r.branch as string | null) ?? null,
    rating: Number(r.rating),
    maxRating: Number(r.max_rating),
    codeforcesRank: (r.cf_rank as string | null) ?? null,
    ratingChange30d: r.rating_change_30d != null ? Number(r.rating_change_30d) : null,
    solvedCount: r.solved_count != null ? Number(r.solved_count) : null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    profileUpdatedAt: new Date(r.profile_updated_at),
    stale: Boolean(r.stale),
  }));
}

/** Fetch the active version's metadata (id + completedAt + generatedAt) for meta response. */
export async function getActiveVersionMeta(
  db: Db = defaultPool,
): Promise<{ versionId: number; completedAt: Date } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT la.version_id, v.completed_at
       FROM leaderboard_active la
       JOIN leaderboard_versions v ON v.id = la.version_id
      WHERE la.id = 1`,
  );
  if (!rows[0]) return null;
  return {
    versionId: Number(rows[0].version_id),
    completedAt: new Date(rows[0].completed_at),
  };
}

/** Look up a single leaderboard entry by normalized handle in the active snapshot. */
export async function getActiveEntryByHandle(
  normalizedHandle: string,
  db: Db = defaultPool,
): Promise<(LeaderboardRow & { versionId: number }) | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       le.version_id,
       le.user_id,
       u.display_name,
       le.handle,
       u.batch_year,
       u.branch,
       le.rating,
       le.max_rating,
       le.cf_rank,
       le.solved_count,
       le.avatar_url,
       le.profile_updated_at,
       le.stale
     FROM leaderboard_entries le
     JOIN leaderboard_active la ON la.version_id = le.version_id
     JOIN users u ON u.id = le.user_id
     JOIN codeforces_accounts ca ON ca.user_id = le.user_id
     WHERE ca.normalized_handle = ?
       AND le.version_id = la.version_id
       AND u.show_in_leaderboard = 1
       AND u.status = 'ACTIVE'
     LIMIT 1`,
    [normalizedHandle],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    versionId: Number(r.version_id),
    userId: Number(r.user_id),
    displayName: r.display_name as string,
    handle: r.handle as string,
    batch: r.batch_year != null ? Number(r.batch_year) : null,
    branch: (r.branch as string | null) ?? null,
    rating: Number(r.rating),
    maxRating: Number(r.max_rating),
    codeforcesRank: (r.cf_rank as string | null) ?? null,
    ratingChange30d: null,
    solvedCount: r.solved_count != null ? Number(r.solved_count) : null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    profileUpdatedAt: new Date(r.profile_updated_at),
    stale: Boolean(r.stale),
  };
}

// ---------------------------------------------------------------------------
// Cursor encode / decode helpers
// ---------------------------------------------------------------------------

export function encodeCursor(c: LeaderboardCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(token: string): LeaderboardCursor | null {
  try {
    const raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).rating !== 'number' ||
      typeof (raw as Record<string, unknown>).maxRating !== 'number' ||
      typeof (raw as Record<string, unknown>).handle !== 'string'
    ) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    return {
      rating: obj.rating as number,
      maxRating: obj.maxRating as number,
      solvedCount: obj.solvedCount != null ? (obj.solvedCount as number) : null,
      handle: obj.handle as string,
    };
  } catch {
    return null;
  }
}
