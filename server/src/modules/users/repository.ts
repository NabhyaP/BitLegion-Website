// ALL user/role SQL lives here (§0.5). No SQL anywhere else in this module.
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';
import type { RoleCode, User, UserStatus } from './types.ts';

type Db = Pool | PoolConnection;

const COLUMNS = `id, google_sub, college_email, display_name, roll_no, batch_year, branch,
                 status, show_in_leaderboard, avatar_url, profile_confirmed`;

function toUser(r: RowDataPacket): User {
  return {
    id: Number(r.id),
    googleSub: r.google_sub,
    collegeEmail: r.college_email,
    displayName: r.display_name,
    rollNo: r.roll_no,
    batchYear: r.batch_year === null ? null : Number(r.batch_year),
    branch: r.branch,
    status: r.status as UserStatus,
    showInLeaderboard: Boolean(r.show_in_leaderboard),
    avatarUrl: r.avatar_url,
    profileConfirmed: Boolean(r.profile_confirmed),
  };
}

export async function findByGoogleSub(sub: string, db: Db = defaultPool): Promise<User | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM users WHERE google_sub = ?`,
    [sub],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findByEmail(email: string, db: Db = defaultPool): Promise<User | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM users WHERE college_email = ?`,
    [email],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findById(id: number, db: Db = defaultPool): Promise<User | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function createUser(
  u: {
    googleSub: string;
    collegeEmail: string;
    displayName: string;
    rollNo: string | null;
    batchYear: number | null;
    branch: string | null;
    avatarUrl: string | null;
  },
  db: Db = defaultPool,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO users (google_sub, college_email, display_name, roll_no, batch_year, branch,
                        status, avatar_url)
     VALUES (?,?,?,?,?,?,'ACTIVE',?)`,
    [u.googleSub, u.collegeEmail, u.displayName, u.rollNo, u.batchYear, u.branch, u.avatarUrl],
  );
  return res.insertId;
}

/** Pre-provisioned row (google_sub NULL, PENDING) activating on first matching login (§B1.5). */
export async function attachGoogleSub(
  userId: number,
  sub: string,
  avatarUrl: string | null,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `UPDATE users
        SET google_sub = ?,
            avatar_url = COALESCE(?, avatar_url),
            status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END
      WHERE id = ?`,
    [sub, avatarUrl, userId],
  );
}

export async function updateProfile(
  userId: number,
  patch: {
    displayName?: string;
    rollNo?: string | null;
    batchYear?: number | null;
    branch?: string | null;
    profileConfirmed?: boolean;
  },
  db: Db = defaultPool,
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const map: Record<string, string> = {
    displayName: 'display_name',
    rollNo: 'roll_no',
    batchYear: 'batch_year',
    branch: 'branch',
    profileConfirmed: 'profile_confirmed',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      args.push(typeof value === 'boolean' ? Number(value) : value);
    }
  }
  if (sets.length === 0) return;
  args.push(userId);
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function getRoles(userId: number, db: Db = defaultPool): Promise<RoleCode[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [userId],
  );
  return rows.map((r) => r.code as RoleCode);
}

export async function grantRole(
  userId: number,
  code: RoleCode,
  grantedBy: number | null,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `INSERT IGNORE INTO user_roles (user_id, role_id, granted_by)
     SELECT ?, id, ? FROM roles WHERE code = ?`,
    [userId, grantedBy, code],
  );
}

export async function revokeRole(
  userId: number,
  code: RoleCode,
  db: Db = defaultPool,
): Promise<void> {
  await db.query(
    `DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.code = ?`,
    [userId, code],
  );
}

/** Course code → branch (admin-editable), e.g. '15' → 'CSE'. */
export async function branchForCourseCode(
  code: string,
  db: Db = defaultPool,
): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT branch FROM course_codes WHERE code = ?',
    [code],
  );
  return rows[0] ? (rows[0].branch as string) : null;
}
