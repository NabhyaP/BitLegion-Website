// ALL SQL for codeforces_accounts, codeforces_link_attempts, codeforces_solved_state (§0.5).
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';
import type { CfAccount, CfLinkStatus } from './types.ts';

type Db = Pool | PoolConnection;

function toAccount(r: RowDataPacket): CfAccount {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    handle: r.handle as string,
    normalizedHandle: r.normalized_handle as string,
    verifiedAt: new Date(r.verified_at),
    status: r.status as CfLinkStatus,
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at) : null,
  };
}

// ---------------------------------------------------------------------------
// codeforces_accounts
// ---------------------------------------------------------------------------

export async function findAccountByUserId(
  userId: number,
  db: Db = defaultPool,
): Promise<CfAccount | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id, handle, normalized_handle, verified_at, status, last_checked_at
       FROM codeforces_accounts WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function findAccountByNormalizedHandle(
  normalizedHandle: string,
  db: Db = defaultPool,
): Promise<CfAccount | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id, handle, normalized_handle, verified_at, status, last_checked_at
       FROM codeforces_accounts WHERE normalized_handle = ?`,
    [normalizedHandle],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

/**
 * Upsert a verified CF link (link or re-link).
 * Uses INSERT ... ON DUPLICATE KEY UPDATE on the `user_id` unique key.
 */
export async function upsertAccount(
  userId: number,
  handle: string,
  normalizedHandle: string,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `INSERT INTO codeforces_accounts
       (user_id, handle, normalized_handle, verified_at, status)
     VALUES (?, ?, ?, NOW(), 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       handle = VALUES(handle),
       normalized_handle = VALUES(normalized_handle),
       verified_at = VALUES(verified_at),
       status = 'ACTIVE',
       last_checked_at = NULL`,
    [userId, handle, normalizedHandle],
  );
}

/** Mark an account UNLINKED (soft delete — historical snapshots keep the handle). */
export async function unlinkAccount(userId: number, db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE codeforces_accounts SET status = 'UNLINKED' WHERE user_id = ?`,
    [userId],
  );
}

export async function updateAccountStatus(
  userId: number,
  status: CfLinkStatus,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `UPDATE codeforces_accounts
        SET status = ?, last_checked_at = NOW()
      WHERE user_id = ?`,
    [status, userId],
  );
}

// ---------------------------------------------------------------------------
// codeforces_link_attempts  (PKCE + state + nonce, 10-min TTL)
// ---------------------------------------------------------------------------

export async function createLinkAttempt(
  userId: number,
  state: string,
  nonce: string,
  pkceVerifier: string,
  db: Db = defaultPool,
): Promise<void> {
  // Delete any previous pending attempt for this user before creating a new one.
  await db.query(`DELETE FROM codeforces_link_attempts WHERE user_id = ?`, [userId]);
  await db.query(
    `INSERT INTO codeforces_link_attempts
       (user_id, state, nonce, pkce_verifier, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [userId, state, nonce, pkceVerifier],
  );
}

export type LinkAttempt = {
  userId: number;
  state: string;
  nonce: string;
  pkceVerifier: string;
  expiresAt: Date;
};

/**
 * Fetch a non-expired attempt by state and immediately delete it (single-use).
 * Returns null if not found or expired.
 */
export async function consumeLinkAttempt(
  state: string,
  db: Db = defaultPool,
): Promise<LinkAttempt | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, state, nonce, pkce_verifier, expires_at
       FROM codeforces_link_attempts
      WHERE state = ? AND expires_at > NOW()`,
    [state],
  );
  if (!rows[0]) return null;
  // Single-use: delete it regardless of what happens next.
  await db.query(`DELETE FROM codeforces_link_attempts WHERE state = ?`, [state]);
  return {
    userId: Number(rows[0].user_id),
    state: rows[0].state as string,
    nonce: rows[0].nonce as string,
    pkceVerifier: rows[0].pkce_verifier as string,
    expiresAt: new Date(rows[0].expires_at),
  };
}

/** Remove expired attempts (called by the cleanup job in Phase 4). */
export async function deleteExpiredAttempts(db: Db = defaultPool): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `DELETE FROM codeforces_link_attempts WHERE expires_at <= NOW()`,
  );
  return res.affectedRows;
}

// ---------------------------------------------------------------------------
// codeforces_solved_state  (seeded on link; managed by Job 2 in Phase 3)
// ---------------------------------------------------------------------------

/** Seed a zero-state row when a user first links. Job 2 picks them up. */
export async function seedSolvedState(userId: number, db: Db = defaultPool): Promise<void> {
  await db.query(
    `INSERT IGNORE INTO codeforces_solved_state (user_id) VALUES (?)`,
    [userId],
  );
}

/** Remove the solved-state row on unlink (history is preserved in leaderboard snapshots). */
export async function deleteSolvedState(userId: number, db: Db = defaultPool): Promise<void> {
  await db.query(`DELETE FROM codeforces_solved_state WHERE user_id = ?`, [userId]);
}

/** Returns a lightweight solved-state summary for the /me endpoint (§F). */
export async function getSolvedStateSummary(
  userId: number,
  db: Db = defaultPool,
): Promise<{ solvedCount: number; lastSyncedAt: Date | null } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT solved_count, last_synced_at FROM codeforces_solved_state WHERE user_id = ?`,
    [userId],
  );
  if (!rows[0]) return null;
  return {
    solvedCount: Number(rows[0].solved_count),
    lastSyncedAt: rows[0].last_synced_at ? new Date(rows[0].last_synced_at) : null,
  };
}
