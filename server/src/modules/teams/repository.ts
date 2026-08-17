/**
 * ALL SQL for club_teams and club_team_members (§0.5 — no SQL outside repositories).
 */
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';

type Db = Pool | PoolConnection;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Team = {
  id: number;
  name: string;
  displayOrder: number;
};

export type TeamMember = {
  id: number;
  teamId: number;
  userId: number | null;
  name: string;
  roleTitle: string;
  cfHandle: string | null;
  photoUrl: string | null;
  displayOrder: number;
};

// ---------------------------------------------------------------------------
// Teams read
// ---------------------------------------------------------------------------

export async function getAllTeams(db: Db = defaultPool): Promise<Team[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, name, display_order FROM club_teams ORDER BY display_order ASC, id ASC`,
  );
  return rows.map(toTeam);
}

export async function getTeamById(id: number, db: Db = defaultPool): Promise<Team | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, name, display_order FROM club_teams WHERE id = ?`,
    [id],
  );
  return rows[0] ? toTeam(rows[0]) : null;
}

export async function getMembersForTeams(
  teamIds: number[],
  db: Db = defaultPool,
): Promise<TeamMember[]> {
  if (teamIds.length === 0) return [];
  const placeholders = teamIds.map(() => '?').join(',');
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tm.id, tm.team_id, tm.user_id,
            COALESCE(u.display_name, tm.name) AS name,
            tm.role_title,
            COALESCE(CASE WHEN ca.status = 'ACTIVE' THEN ca.handle END, tm.cf_handle) AS cf_handle,
            COALESCE(tm.photo_url, u.avatar_url) AS photo_url, tm.display_order
       FROM club_team_members tm
       LEFT JOIN users u ON u.id = tm.user_id
       LEFT JOIN codeforces_accounts ca ON ca.user_id = tm.user_id
      WHERE tm.team_id IN (${placeholders})
      ORDER BY tm.display_order ASC, tm.id ASC`,
    teamIds,
  );
  return rows.map(toMember);
}

export async function getMemberById(
  memberId: number,
  db: Db = defaultPool,
): Promise<TeamMember | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tm.id, tm.team_id, tm.user_id,
            COALESCE(u.display_name, tm.name) AS name,
            tm.role_title,
            COALESCE(CASE WHEN ca.status = 'ACTIVE' THEN ca.handle END, tm.cf_handle) AS cf_handle,
            COALESCE(tm.photo_url, u.avatar_url) AS photo_url, tm.display_order
       FROM club_team_members tm
       LEFT JOIN users u ON u.id = tm.user_id
       LEFT JOIN codeforces_accounts ca ON ca.user_id = tm.user_id
      WHERE tm.id = ?`,
    [memberId],
  );
  return rows[0] ? toMember(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Teams write
// ---------------------------------------------------------------------------

export async function createTeam(
  name: string,
  displayOrder: number,
  db: Db = defaultPool,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO club_teams (name, display_order) VALUES (?, ?)`,
    [name, displayOrder],
  );
  return res.insertId;
}

export async function updateTeam(
  id: number,
  name: string,
  displayOrder: number,
  db: Db = defaultPool,
): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE club_teams SET name = ?, display_order = ? WHERE id = ?`,
    [name, displayOrder, id],
  );
  return res.affectedRows > 0;
}

export async function deleteTeam(id: number, db: Db = defaultPool): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    `DELETE FROM club_teams WHERE id = ?`,
    [id],
  );
  return res.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Team members write
// ---------------------------------------------------------------------------

export async function createMember(
  m: Omit<TeamMember, 'id'>,
  db: Db = defaultPool,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO club_team_members
       (team_id, user_id, name, role_title, cf_handle, photo_url, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [m.teamId, m.userId ?? null, m.name, m.roleTitle, m.cfHandle ?? null, m.photoUrl ?? null, m.displayOrder],
  );
  return res.insertId;
}

export async function updateMember(
  id: number,
  m: Partial<Omit<TeamMember, 'id' | 'teamId'>>,
  db: Db = defaultPool,
): Promise<boolean> {
  // Build dynamic SET clause from provided fields only
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (m.userId !== undefined) { sets.push('user_id = ?'); vals.push(m.userId); }
  if (m.name !== undefined) { sets.push('name = ?'); vals.push(m.name); }
  if (m.roleTitle !== undefined) { sets.push('role_title = ?'); vals.push(m.roleTitle); }
  if (m.cfHandle !== undefined) { sets.push('cf_handle = ?'); vals.push(m.cfHandle); }
  if (m.photoUrl !== undefined) { sets.push('photo_url = ?'); vals.push(m.photoUrl); }
  if (m.displayOrder !== undefined) { sets.push('display_order = ?'); vals.push(m.displayOrder); }
  if (sets.length === 0) return true;
  vals.push(id);
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE club_team_members SET ${sets.join(', ')} WHERE id = ?`,
    vals,
  );
  return res.affectedRows > 0;
}

export async function deleteMember(id: number, db: Db = defaultPool): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    `DELETE FROM club_team_members WHERE id = ?`,
    [id],
  );
  return res.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toTeam(r: RowDataPacket): Team {
  return {
    id: Number(r.id),
    name: r.name as string,
    displayOrder: Number(r.display_order),
  };
}

function toMember(r: RowDataPacket): TeamMember {
  return {
    id: Number(r.id),
    teamId: Number(r.team_id),
    userId: r.user_id != null ? Number(r.user_id) : null,
    name: r.name as string,
    roleTitle: r.role_title as string,
    cfHandle: (r.cf_handle as string | null) ?? null,
    photoUrl: (r.photo_url as string | null) ?? null,
    displayOrder: Number(r.display_order),
  };
}
