/**
 * Business logic for §B2 — Codeforces handle linking.
 * All SQL goes through repository.ts; all business rules live here (§0.5).
 */
import { pool } from '../../db/pool.ts';
import { conflict, forbidden } from '../../shared/errors.ts';
import * as audit from '../audit/repository.ts';
import * as repo from './repository.ts';
import type { CfAccount } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Codeforces handles are case-insensitive; normalize to lowercase. */
export function normalizeHandle(handle: string): string {
  return handle.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

export type LinkResult = {
  account: CfAccount;
  wasRelink: boolean;
};

/**
 * Verify + persist a CF handle ownership claim (§B2 callback logic).
 *
 * Rules (§B2):
 * 1. Handle already owned by ANOTHER user → throw 409 handle-taken.
 * 2. Upsert codeforces_accounts (ACTIVE).
 * 3. Seed codeforces_solved_state (INSERT IGNORE — idempotent).
 * 4. Audit cf.link in the same transaction.
 */
export async function linkCfHandle(
  userId: number,
  rawHandle: string,
  requestId: string | null,
): Promise<LinkResult> {
  const normalizedHandle = normalizeHandle(rawHandle);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Check for handle-taken (a different user already owns this handle).
    const existing = await repo.findAccountByNormalizedHandle(normalizedHandle, conn);
    if (existing && existing.userId !== userId) {
      throw conflict('HANDLE_TAKEN', 'This Codeforces handle is already linked to another account.');
    }

    // Did the current user already have a different active link? (re-link path)
    const previous = await repo.findAccountByUserId(userId, conn);
    const wasRelink = previous !== null && previous.status !== 'UNLINKED';

    // 2. Upsert the account row.
    await repo.upsertAccount(userId, rawHandle, normalizedHandle, conn);

    // 3. Seed solved-state (zero row; Job 2 picks it up in Phase 3).
    await repo.seedSolvedState(userId, conn);

    // 4. Audit.
    await audit.record(
      {
        actorUserId: userId,
        action: 'cf.link',
        targetType: 'user',
        targetId: userId,
        before: wasRelink
          ? { handle: previous!.handle, status: previous!.status }
          : null,
        after: { handle: rawHandle, normalizedHandle, status: 'ACTIVE' },
        requestId,
      },
      conn,
    );

    await conn.commit();

    const account = (await repo.findAccountByUserId(userId))!;
    return { account, wasRelink };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Unlink
// ---------------------------------------------------------------------------

/**
 * Soft-unlink a CF handle (§B2 DELETE /codeforces/link).
 * Requires recent auth — enforced in the router via requireRecentAuth middleware.
 * Clears solved-state so the user re-starts from zero if they ever re-link.
 */
export async function unlinkCfHandle(
  userId: number,
  requestId: string | null,
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const account = await repo.findAccountByUserId(userId, conn);
    if (!account || account.status === 'UNLINKED') {
      throw forbidden('No active Codeforces link to remove.');
    }

    await repo.unlinkAccount(userId, conn);
    await repo.deleteSolvedState(userId, conn);

    await audit.record(
      {
        actorUserId: userId,
        action: 'cf.unlink',
        targetType: 'user',
        targetId: userId,
        before: { handle: account.handle, status: account.status },
        after: { status: 'UNLINKED' },
        requestId,
      },
      conn,
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
