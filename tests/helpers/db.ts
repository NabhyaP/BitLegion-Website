// Integration-test harness. Requires a throwaway MySQL — see tests/README.md.
// Env: DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME must point at a DISPOSABLE database.
import { pool } from '../../server/src/db/pool.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/** Wipe all data between tests, keeping the schema (and the roles seed). */
export async function resetDb(): Promise<void> {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'audit_events',
    // Phase 4 teams tables — members before teams (FK child).
    'club_team_members',
    'club_teams',
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
    'job_runs',
  ]) {
    await pool.query(`TRUNCATE TABLE ${t}`).catch(() => {
      /* table may not exist yet (e.g. sessions before first login, or future phases) */
    });
  }
  await pool.query(
    `INSERT INTO settings (skey, svalue, updated_by) VALUES
       ('leaderboard_enabled', 'true', NULL),
       ('announcement', '', NULL),
       ('leaderboard_refresh_minutes', '60', NULL)
     ON DUPLICATE KEY UPDATE svalue = VALUES(svalue), updated_by = NULL`,
  ).catch(() => {
    /* settings is unavailable before migration 009 */
  });
  await pool.query(`DELETE FROM course_codes WHERE code NOT IN ('15', '16')`).catch(() => {
    /* course_codes is unavailable before migration 003 */
  });
  await pool.query(
    `INSERT INTO course_codes (code, branch, name) VALUES
       ('15', 'CSE', 'Computer Science and Engineering'),
       ('16', 'ECE', 'Electronics and Communication Engineering')
     ON DUPLICATE KEY UPDATE branch = VALUES(branch), name = VALUES(name)`,
  ).catch(() => {
    /* course_codes is unavailable before migration 003 */
  });
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
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`);
  return Number(rows[0].c);
}

/** Insert a pre-provisioned member the way an admin CSV import will (google_sub NULL, PENDING). */
export async function seedPreProvisioned(email: string, name = 'Seeded Member'): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (college_email, display_name, status) VALUES (?,?,'PENDING')`,
    [email, name],
  );
  return res.insertId;
}

// ---------------------------------------------------------------------------
// Phase 4 leaderboard / profile helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal ACTIVE user + verified CF link + leaderboard snapshot entry.
 * Returns userId and the inserted handle (normalized lowercase).
 */
export async function seedLeaderboardEntry(opts: {
  email?: string;
  displayName?: string;
  handle?: string;
  rating?: number;
  maxRating?: number;
  solvedCount?: number | null;
  batch?: number;
  branch?: string;
  showInLeaderboard?: boolean;
  status?: string;
  versionId: number;
  position?: number;
}): Promise<{ userId: number; handle: string }> {
  const email = opts.email ?? `user${Math.random().toString(36).slice(2)}@cse.iiitp.ac.in`;
  const handle = opts.handle ?? `handle${Math.random().toString(36).slice(2)}`;
  const displayName = opts.displayName ?? 'Test User';
  const show = opts.showInLeaderboard !== false ? 1 : 0;
  const status = opts.status ?? 'ACTIVE';

  const [userRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (college_email, display_name, batch_year, branch, status, show_in_leaderboard)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [email, displayName, opts.batch ?? 2024, opts.branch ?? 'CSE', status, show],
  );
  const userId: number = userRes.insertId;

  await pool.query(
    `INSERT INTO codeforces_accounts (user_id, handle, normalized_handle, verified_at, status)
     VALUES (?, ?, ?, NOW(), 'ACTIVE')`,
    [userId, handle, handle.toLowerCase()],
  );

  await pool.query(
    `INSERT INTO leaderboard_entries
       (version_id, user_id, position, handle, rating, max_rating, solved_count, profile_updated_at, stale)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
    [
      opts.versionId,
      userId,
      opts.position ?? 1,
      handle.toLowerCase(),
      opts.rating ?? 1200,
      opts.maxRating ?? 1200,
      opts.solvedCount ?? null,
    ],
  );

  return { userId, handle: handle.toLowerCase() };
}

/** Create a leaderboard version + activate it. Returns versionId. */
export async function seedActiveSnapshot(): Promise<number> {
  const [vRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO leaderboard_versions (status, completed_at, handles_requested, handles_updated)
     VALUES ('READY', NOW(), 1, 1)`,
  );
  const versionId: number = vRes.insertId;
  await pool.query(
    `INSERT INTO leaderboard_active (id, version_id) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE version_id = VALUES(version_id)`,
    [versionId],
  );
  // Seed the settings rows that the leaderboard service reads (may already exist from migration).
  await pool.query(
    `INSERT IGNORE INTO settings (skey, svalue) VALUES
       ('leaderboard_enabled', 'true'),
       ('announcement', ''),
       ('leaderboard_refresh_minutes', '60')`,
  );
  return versionId;
}
