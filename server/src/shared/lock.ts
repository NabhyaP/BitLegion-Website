/**
 * MySQL named-lock helper (§0.4.12).
 * Uses a dedicated connection per lock so the session-scoped GET_LOCK/RELEASE_LOCK
 * is not confused with pooled connections that may be reused by other queries.
 */
import { pool } from '../db/pool.ts';

/**
 * Acquire a named MySQL lock, run `fn`, then release.
 * Returns `null` immediately (does NOT wait) if the lock is already held —
 * the caller should treat null as "another job instance is running, exit 0".
 *
 * @param lockName  MySQL lock name (unique per job).
 * @param fn        Async work to do while the lock is held.
 * @returns The return value of `fn`, or `null` if the lock could not be acquired.
 */
export async function withLock<T>(lockName: string, fn: () => Promise<T>): Promise<T | null> {
  const conn = await pool.getConnection();
  try {
    const [[row]] = await conn.query<any[]>(
      'SELECT GET_LOCK(?, 0) AS acquired',
      [lockName],
    );
    if (!row || row.acquired !== 1) {
      return null; // lock held by another session
    }
    try {
      return await fn();
    } finally {
      // Best-effort: release even if fn throws. The conn.release() below also frees
      // the MySQL session, which releases all locks, but an explicit release is cleaner.
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {/* ignore */});
    }
  } finally {
    conn.release();
  }
}
