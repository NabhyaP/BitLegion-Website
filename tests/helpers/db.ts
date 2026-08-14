// Integration-test harness. Requires a throwaway MySQL — see tests/README.md.
// Env: DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME must point at a DISPOSABLE database.
import { pool } from '../../server/src/db/pool.ts';

/** Wipe all data between tests, keeping the schema (and the roles seed). */
export async function resetDb(): Promise<void> {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['audit_events', 'user_roles', 'users', 'sessions']) {
    await pool.query(`TRUNCATE TABLE ${t}`).catch(() => {
      /* sessions may not exist until express-mysql-session creates it */
    });
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export async function countRows(table: string, where = '1=1'): Promise<number> {
  const [rows] = await pool.query<any[]>(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`);
  return Number(rows[0].c);
}

/** Insert a pre-provisioned member the way an admin CSV import will (google_sub NULL, PENDING). */
export async function seedPreProvisioned(email: string, name = 'Seeded Member'): Promise<number> {
  const [res] = await pool.query<any>(
    `INSERT INTO users (college_email, display_name, status) VALUES (?,?,'PENDING')`,
    [email, name],
  );
  return res.insertId;
}
