import mysql from 'mysql2/promise';
import { env } from '../config/env.ts';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  queueLimit: 100,
  timezone: 'Z',
  charset: 'utf8mb4_general_ci',
});

export async function dbReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
