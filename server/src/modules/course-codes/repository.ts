import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';

type Db = Pool | PoolConnection;

export type CourseCode = { code: string; branch: string; name: string };

export async function listCourseCodes(db: Db = defaultPool): Promise<CourseCode[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, branch, name FROM course_codes ORDER BY branch, code`,
  );
  return rows.map((row) => ({
    code: row.code as string,
    branch: row.branch as string,
    name: row.name as string,
  }));
}

export async function findCourseCode(code: string, db: Db = defaultPool): Promise<CourseCode | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT code, branch, name FROM course_codes WHERE code = ?`,
    [code],
  );
  const row = rows[0];
  return row ? { code: row.code as string, branch: row.branch as string, name: row.name as string } : null;
}

export async function createCourseCode(value: CourseCode, db: Db = defaultPool): Promise<void> {
  await db.query(
    `INSERT INTO course_codes (code, branch, name) VALUES (?, ?, ?)`,
    [value.code, value.branch, value.name],
  );
}

export async function updateCourseCode(
  code: string,
  value: Pick<CourseCode, 'branch' | 'name'>,
  db: Db = defaultPool,
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE course_codes SET branch = ?, name = ? WHERE code = ?`,
    [value.branch, value.name, code],
  );
  return result.affectedRows > 0;
}

export async function deleteCourseCode(code: string, db: Db = defaultPool): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM course_codes WHERE code = ?`,
    [code],
  );
  return result.affectedRows > 0;
}
