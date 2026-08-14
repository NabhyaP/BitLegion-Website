// Integration-test harness. Requires a throwaway MySQL — see tests/README.md.
// Env: DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME must point at a DISPOSABLE database.
import { pool } from '../../server/src/db/pool.ts';

/** Wipe all data between tests, keeping the schema (and the roles seed). */
export async function resetDb(): Promise<void> {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'audit_events',
    // Phase 3 leaderboard tables — truncated first (FK children of leaderboard_versions).
    'codeforces_rating_daily',
    'leaderboard_entries',
    'leaderboard_active',
    'leaderboard_versions',
    // Phase 3 solved-problems table.
    'codeforces_solved_problems',
    // Phase 2 CF tables — truncated before user_roles/users so FK constraints don't block.
    'codeforces_solved_state',
    'codeforces_link_attempts',
    'codeforces_accounts',
    'user_roles',
    'users',
    'sessions',
  ]) {
    await pool.query(`TRUNCATE TABLE ${t}`).catch(() => {
      /* table may not exist yet (e.g. sessions before first login, or future phases) */
    });
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

// ---------------------------------------------------------------------------
// CF-link helpers
// ---------------------------------------------------------------------------

/**
 * Directly insert a verified CF link row — bypasses OIDC so tests can exercise
 * downstream behaviour (unlink, /me response, duplicate-handle conflict, etc.).
 */
export async function seedCfLink(
  userId: number,
  handle: string,
  normalizedHandle = handle.toLowerCase(),
): Promise<void> {
  await pool.query(
    `INSERT INTO codeforces_accounts
       (user_id, handle, normalized_handle, verified_at, status)
     VALUES (?, ?, ?, NOW(), 'ACTIVE')`,
    [userId, handle, normalizedHandle],
  );
  await pool.query(
    `INSERT IGNORE INTO codeforces_solved_state (user_id) VALUES (?)`,
    [userId],
  );
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
