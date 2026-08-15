/**
 * ALL SQL for admin operations (§0.5 — no SQL outside repositories).
 * Covers: member list/edit, role management, job status, handle issues, audit viewer, stats.
 */
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';
import type { UserStatus, RoleCode } from '../users/types.ts';

type Db = Pool | PoolConnection;

// ---------------------------------------------------------------------------
// Member list (paginated, filterable)
// ---------------------------------------------------------------------------

export type AdminMemberRow = {
  id: number;
  collegeEmail: string;
  displayName: string;
  rollNo: string | null;
  batchYear: number | null;
  branch: string | null;
  status: UserStatus;
  showInLeaderboard: boolean;
  avatarUrl: string | null;
  profileConfirmed: boolean;
  cfHandle: string | null;
  cfStatus: string | null;
  roles: string[];
};

export type ListMembersOptions = {
  year?: number | null;
  branch?: string | null;
  status?: UserStatus | null;
  q?: string | null;
  page: number;
  pageSize: number;
};

export async function listMembers(
  opts: ListMembersOptions,
  db: Db = defaultPool,
): Promise<{ rows: AdminMemberRow[]; total: number }> {
  const { year, branch, status, q, page, pageSize } = opts;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (year != null) { conditions.push('u.batch_year = ?'); params.push(year); }
  if (branch) { conditions.push('u.branch = ?'); params.push(branch.toUpperCase()); }
  if (status) { conditions.push('u.status = ?'); params.push(status); }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    conditions.push('(u.display_name LIKE ? OR u.college_email LIKE ? OR ca.normalized_handle LIKE ?)');
    params.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countParams = [...params];
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM users u
       LEFT JOIN codeforces_accounts ca ON ca.user_id = u.id AND ca.status = 'ACTIVE'
       ${where}`,
    countParams,
  );
  const total = Number(countRows[0]!.total);

  const rowParams = [...params, pageSize, offset];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       u.id, u.college_email, u.display_name, u.roll_no, u.batch_year, u.branch,
       u.status, u.show_in_leaderboard, u.avatar_url, u.profile_confirmed,
       ca.handle AS cf_handle, ca.status AS cf_status,
       COALESCE(
         (SELECT GROUP_CONCAT(r.code ORDER BY r.code SEPARATOR ',')
            FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id),
         ''
       ) AS roles_csv
     FROM users u
     LEFT JOIN codeforces_accounts ca ON ca.user_id = u.id AND ca.status = 'ACTIVE'
     ${where}
     ORDER BY u.batch_year ASC, u.display_name ASC
     LIMIT ? OFFSET ?`,
    rowParams,
  );

  return {
    total,
    rows: rows.map((r) => ({
      id: Number(r.id),
      collegeEmail: r.college_email as string,
      displayName: r.display_name as string,
      rollNo: (r.roll_no as string | null) ?? null,
      batchYear: r.batch_year != null ? Number(r.batch_year) : null,
      branch: (r.branch as string | null) ?? null,
      status: r.status as UserStatus,
      showInLeaderboard: Boolean(r.show_in_leaderboard),
      avatarUrl: (r.avatar_url as string | null) ?? null,
      profileConfirmed: Boolean(r.profile_confirmed),
      cfHandle: (r.cf_handle as string | null) ?? null,
      cfStatus: (r.cf_status as string | null) ?? null,
      roles: r.roles_csv ? (r.roles_csv as string).split(',') : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Member edit
// ---------------------------------------------------------------------------

export async function adminUpdateUser(
  userId: number,
  patch: {
    displayName?: string;
    rollNo?: string | null;
    batchYear?: number | null;
    branch?: string | null;
    status?: UserStatus;
    showInLeaderboard?: boolean;
  },
  db: Db = defaultPool,
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = {
    displayName: 'display_name',
    rollNo: 'roll_no',
    batchYear: 'batch_year',
    branch: 'branch',
    status: 'status',
    showInLeaderboard: 'show_in_leaderboard',
  };
  for (const [key, col] of Object.entries(map)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(typeof v === 'boolean' ? Number(v) : v);
    }
  }
  if (sets.length === 0) return true;
  vals.push(userId);
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
    vals,
  );
  return res.affectedRows > 0;
}

/** Create a pre-provisioned user (google_sub NULL, status PENDING). */
export async function adminCreateUser(
  u: {
    collegeEmail: string;
    displayName: string;
    rollNo: string | null;
    batchYear: number | null;
    branch: string | null;
  },
  db: Db = defaultPool,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO users (college_email, display_name, roll_no, batch_year, branch, status)
     VALUES (?, ?, ?, ?, ?, 'PENDING')`,
    [u.collegeEmail, u.displayName, u.rollNo, u.batchYear, u.branch ?? null],
  );
  return res.insertId;
}

/** Hard-unlink CF account (admin action — different from user unlink). */
export async function adminClearCfLink(userId: number, db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE codeforces_accounts SET status = 'UNLINKED' WHERE user_id = ?`,
    [userId],
  );
  await db.query(`DELETE FROM codeforces_solved_state WHERE user_id = ?`, [userId]);
}

// ---------------------------------------------------------------------------
// Handle issues (reconciliation queue)
// ---------------------------------------------------------------------------

export type HandleIssueRow = {
  userId: number;
  displayName: string;
  handle: string;
  cfStatus: string;
  lastCheckedAt: Date | null;
};

export async function listHandleIssues(db: Db = defaultPool): Promise<HandleIssueRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.id AS user_id, u.display_name, ca.handle, ca.status AS cf_status, ca.last_checked_at
       FROM codeforces_accounts ca
       JOIN users u ON u.id = ca.user_id
      WHERE ca.status IN ('NOT_FOUND', 'RENAMED_OR_MISMATCHED', 'TEMPORARY_ERROR')
      ORDER BY ca.last_checked_at ASC`,
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    displayName: r.display_name as string,
    handle: r.handle as string,
    cfStatus: r.cf_status as string,
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at) : null,
  }));
}

/** Force a handle back to ACTIVE so Job 1 will re-check it next run. */
export async function recheckHandle(userId: number, db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE codeforces_accounts
        SET status = 'ACTIVE', last_checked_at = NULL
      WHERE user_id = ?`,
    [userId],
  );
}

// ---------------------------------------------------------------------------
// Job runs
// ---------------------------------------------------------------------------

export type JobRunRow = {
  id: number;
  jobCode: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  detail: Record<string, unknown> | null;
};

export async function getRecentJobRuns(
  jobCode: string,
  limit = 10,
  db: Db = defaultPool,
): Promise<JobRunRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, job_code, status, started_at, finished_at, duration_ms, detail
       FROM job_runs
      WHERE job_code = ?
      ORDER BY started_at DESC
      LIMIT ?`,
    [jobCode, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    jobCode: r.job_code as string,
    status: r.status as string,
    startedAt: new Date(r.started_at),
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    detail: r.detail ? (typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail) as Record<string, unknown> : null,
  }));
}

/** Mark any RUNNING job_run older than 30 min as FAILED (defensive cleanup). */
export async function abandonStaleJobRuns(db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE job_runs SET status = 'FAILED', finished_at = NOW()
      WHERE status = 'RUNNING'
        AND started_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
  );
}

// ---------------------------------------------------------------------------
// Solved sync force-resync (per user)
// ---------------------------------------------------------------------------

export async function resetSolvedState(userId: number, db: Db = defaultPool): Promise<void> {
  await db.query(
    `UPDATE codeforces_solved_state
        SET last_submission_id = 0, solved_count = 0, last_synced_at = NULL, last_error = NULL
      WHERE user_id = ?`,
    [userId],
  );
  await db.query(
    `DELETE FROM codeforces_solved_problems WHERE user_id = ?`,
    [userId],
  );
}

// ---------------------------------------------------------------------------
// Audit viewer
// ---------------------------------------------------------------------------

export type AuditEventRow = {
  id: number;
  actorUserId: number;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  requestId: string | null;
  createdAt: Date;
};

export async function listAuditEvents(opts: {
  actor?: number | null;
  action?: string | null;
  page: number;
  pageSize: number;
}, db: Db = defaultPool): Promise<{ rows: AuditEventRow[]; total: number }> {
  const { actor, action, page, pageSize } = opts;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (actor != null) { conditions.push('ae.actor_user_id = ?'); params.push(actor); }
  if (action) { conditions.push('ae.action LIKE ?'); params.push(`%${action}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM audit_events ae ${where}`,
    [...params],
  );
  const total = Number(countRows[0]!.total);

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ae.id, ae.actor_user_id, u.display_name AS actor_name,
            ae.action, ae.target_type, ae.target_id,
            ae.before_json, ae.after_json, ae.request_id, ae.created_at
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.actor_user_id
       ${where}
       ORDER BY ae.created_at DESC
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  return {
    total,
    rows: rows.map((r) => ({
      id: Number(r.id),
      actorUserId: Number(r.actor_user_id),
      actorName: (r.actor_name as string | null) ?? null,
      action: r.action as string,
      targetType: (r.target_type as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      beforeJson: r.before_json ? (typeof r.before_json === 'string' ? JSON.parse(r.before_json) : r.before_json) : null,
      afterJson: r.after_json ? (typeof r.after_json === 'string' ? JSON.parse(r.after_json) : r.after_json) : null,
      requestId: (r.request_id as string | null) ?? null,
      createdAt: new Date(r.created_at),
    })),
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export type AdminStats = {
  totalUsers: number;
  activeUsers: number;
  linkedUsers: number;
  pendingUsers: number;
  suspendedUsers: number;
  signupsLast7d: Array<{ date: string; count: number }>;
};

export async function getAdminStats(db: Db = defaultPool): Promise<AdminStats> {
  const [totals] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'ACTIVE') AS active,
       SUM(status = 'PENDING') AS pending,
       SUM(status = 'SUSPENDED') AS suspended
     FROM users`,
  );
  const [linked] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM codeforces_accounts WHERE status = 'ACTIVE'`,
  );
  const [daily] = await db.query<RowDataPacket[]>(
    `SELECT DATE(created_at) AS dt, COUNT(*) AS cnt
       FROM users
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY dt ASC`,
  );

  return {
    totalUsers: Number(totals[0]!.total),
    activeUsers: Number(totals[0]!.active),
    linkedUsers: Number(linked[0]!.cnt),
    pendingUsers: Number(totals[0]!.pending),
    suspendedUsers: Number(totals[0]!.suspended),
    signupsLast7d: daily.map((r) => ({
      date: (r.dt as Date).toISOString().slice(0, 10),
      count: Number(r.cnt),
    })),
  };
}
