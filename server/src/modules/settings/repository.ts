/**
 * ALL SQL for the settings table (§0.5 — no SQL outside repositories).
 */
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';

type Db = Pool | PoolConnection;

export type SettingKey =
  | 'leaderboard_enabled'
  | 'announcement'
  | 'leaderboard_refresh_minutes';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getSetting(key: SettingKey, db: Db = defaultPool): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT svalue FROM settings WHERE skey = ?`,
    [key],
  );
  return rows[0] ? (rows[0].svalue as string) : null;
}

export async function getAllSettings(
  db: Db = defaultPool,
): Promise<Record<string, string>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT skey, svalue FROM settings`,
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.skey as string] = r.svalue as string;
  return out;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function setSetting(
  key: SettingKey,
  value: string,
  updatedBy: number,
  db: Db = defaultPool,
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO settings (skey, svalue, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE svalue = VALUES(svalue), updated_by = VALUES(updated_by)`,
    [key, value, updatedBy],
  );
}
