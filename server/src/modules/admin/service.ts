/**
 * Admin service — business rules for admin operations.
 * Every mutation is audited in the same transaction (§B3).
 * Role grant/revoke rules from §B1:
 *   - Nobody edits their own roles
 *   - Only SUPERADMIN can grant/revoke ADMIN or SUPERADMIN
 *   - Cannot grant a role the target already has; cannot revoke a role they don't have
 */
import { pool } from '../../db/pool.ts';
import * as repo from './repository.ts';
import * as usersRepo from '../users/repository.ts';
import * as audit from '../audit/repository.ts';
import { forbidden, badRequest, conflict, notFound } from '../../shared/errors.ts';
import type { RoleCode, UserStatus } from '../users/types.ts';
import type { ListMembersOptions } from './repository.ts';

// ---------------------------------------------------------------------------
// Member list / edit
// ---------------------------------------------------------------------------

export async function listMembers(opts: ListMembersOptions) {
  return repo.listMembers(opts);
}

export async function adminUpdateMember(
  targetUserId: number,
  patch: {
    displayName?: string;
    rollNo?: string | null;
    batchYear?: number | null;
    branch?: string | null;
    status?: UserStatus;
    showInLeaderboard?: boolean;
  },
  actorId: number,
  requestId?: string,
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const before = await usersRepo.findById(targetUserId, conn);
    if (!before) throw notFound('User not found.');

    await repo.adminUpdateUser(targetUserId, patch, conn);

    const after = await usersRepo.findById(targetUserId, conn);
    await audit.record({
      actorUserId: actorId,
      action: 'member.edit',
      targetType: 'user',
      targetId: targetUserId,
      before,
      after,
      requestId,
    }, conn);

    await conn.commit();
    return after!;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function adminCreateMember(
  data: { collegeEmail: string; displayName: string; rollNo?: string | null; batchYear?: number | null; branch?: string | null },
  actorId: number,
  requestId?: string,
) {
  // Check duplicate email
  const existing = await usersRepo.findByEmail(data.collegeEmail);
  if (existing) throw conflict('EMAIL_TAKEN', 'A user with this email already exists.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await repo.adminCreateUser(
      { collegeEmail: data.collegeEmail, displayName: data.displayName, rollNo: data.rollNo ?? null, batchYear: data.batchYear ?? null, branch: data.branch ?? null },
      conn,
    );
    await audit.record({
      actorUserId: actorId,
      action: 'member.create',
      targetType: 'user',
      targetId: id,
      after: data,
      requestId,
    }, conn);
    await conn.commit();
    return usersRepo.findById(id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function adminClearCfLink(
  targetUserId: number,
  actorId: number,
  requestId?: string,
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.adminClearCfLink(targetUserId, conn);
    await audit.record({
      actorUserId: actorId,
      action: 'cf.admin-unlink',
      targetType: 'user',
      targetId: targetUserId,
      requestId,
    }, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// CSV import (§B3.2)
// ---------------------------------------------------------------------------

export type CsvImportResult = {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; email: string; reason: string }>;
};

export async function importMembersFromCsv(
  rows: Array<{ display_name: string; college_email: string; batch_year: number; branch: string }>,
  actorId: number,
  requestId?: string,
): Promise<CsvImportResult> {
  const result: CsvImportResult = { imported: 0, skipped: 0, errors: [] };

  let rowNum = 1;
  for (const r of rows) {
    rowNum++;
    try {
      const existing = await usersRepo.findByEmail(r.college_email.toLowerCase());
      if (existing) {
        result.skipped++;
        continue;
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const id = await repo.adminCreateUser({
          collegeEmail: r.college_email.toLowerCase(),
          displayName: r.display_name,
          rollNo: null,
          batchYear: r.batch_year,
          branch: r.branch.toUpperCase(),
        }, conn);
        await audit.record({
          actorUserId: actorId,
          action: 'member.csv-import',
          targetType: 'user',
          targetId: id,
          after: { email: r.college_email, batch: r.batch_year, branch: r.branch },
          requestId,
        }, conn);
        await conn.commit();
        result.imported++;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      result.errors.push({
        row: rowNum,
        email: r.college_email,
        reason: e instanceof Error ? e.message : 'Unknown error.',
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Role management (§B1 rules)
// ---------------------------------------------------------------------------

export async function patchRoles(
  targetUserId: number,
  actorId: number,
  actorRoles: RoleCode[],
  grant: RoleCode[],
  revoke: RoleCode[],
  requestId?: string,
) {
  if (targetUserId === actorId) throw forbidden('Cannot edit your own roles.');

  const isSuperadmin = actorRoles.includes('SUPERADMIN');
  const isAdmin = actorRoles.includes('ADMIN');

  // Check: only SUPERADMIN can touch ADMIN/SUPERADMIN roles
  const privileged: RoleCode[] = ['ADMIN', 'SUPERADMIN'];
  for (const r of [...grant, ...revoke]) {
    if (privileged.includes(r) && !isSuperadmin) {
      throw forbidden('Only SUPERADMIN can grant or revoke ADMIN/SUPERADMIN roles.');
    }
  }

  // ADMIN can manage up to MODERATOR level
  if (!isSuperadmin && !isAdmin) {
    throw forbidden('ADMIN role required.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const beforeRoles = await usersRepo.getRoles(targetUserId, conn);

    for (const code of grant) {
      if (!beforeRoles.includes(code)) {
        await usersRepo.grantRole(targetUserId, code, actorId, conn);
      }
    }
    for (const code of revoke) {
      if (beforeRoles.includes(code)) {
        await usersRepo.revokeRole(targetUserId, code, conn);
      }
    }

    const afterRoles = await usersRepo.getRoles(targetUserId, conn);
    await audit.record({
      actorUserId: actorId,
      action: 'member.roles',
      targetType: 'user',
      targetId: targetUserId,
      before: { roles: beforeRoles },
      after: { roles: afterRoles },
      requestId,
    }, conn);

    await conn.commit();
    return afterRoles;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function getLeaderboardJobStatus() {
  const runs = await repo.getRecentJobRuns('lb-refresh');
  return { runs };
}

export async function getSolvedSyncJobStatus() {
  const runs = await repo.getRecentJobRuns('solved-sync');
  return { runs };
}

// ---------------------------------------------------------------------------
// Handle reconciliation
// ---------------------------------------------------------------------------

export async function listHandleIssues() {
  return repo.listHandleIssues();
}

export async function recheckHandle(
  targetUserId: number,
  actorId: number,
  requestId?: string,
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.recheckHandle(targetUserId, conn);
    await audit.record({
      actorUserId: actorId,
      action: 'cf.recheck',
      targetType: 'user',
      targetId: targetUserId,
      requestId,
    }, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function forceResyncUser(
  targetUserId: number,
  actorId: number,
  requestId?: string,
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.resetSolvedState(targetUserId, conn);
    await audit.record({
      actorUserId: actorId,
      action: 'cf.force-resync',
      targetType: 'user',
      targetId: targetUserId,
      requestId,
    }, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Audit viewer
// ---------------------------------------------------------------------------

export async function listAuditEvents(opts: {
  actor?: number | null;
  action?: string | null;
  page: number;
  pageSize: number;
}) {
  return repo.listAuditEvents(opts);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats() {
  return repo.getAdminStats();
}
