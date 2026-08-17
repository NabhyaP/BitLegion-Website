#!/usr/bin/env node
/**
 * Seed script — idempotent production bootstrap.
 *
 * Run ONCE after first deploy (migrations must already be applied):
 *   node --experimental-strip-types src/scripts/seed.ts
 *
 * What it does:
 *   1. Ensures all six role rows exist in `roles`.
 *   2. Ensures default settings rows exist (leaderboard_enabled, announcement,
 *      leaderboard_refresh_minutes).
 *   3. Prints a reminder to add course_codes rows if none exist.
 *   4. Creates a demo team "Core Team" if no teams exist yet.
 *
 * It does NOT create users — SEED_SUPERADMIN_EMAILS in env handles that on first login.
 * Safe to run multiple times — all inserts are INSERT IGNORE.
 */

// Load env so pool.ts can connect
import '../config/env.ts';
import { pool } from '../db/pool.ts';

async function main() {
  console.log('▶ BitLegion seed script starting…');
  const conn = await pool.getConnection();
  try {

    // ── 1. Roles ────────────────────────────────────────────────────────────
    const ROLES = ['MEMBER', 'MENTOR', 'EDITOR', 'MODERATOR', 'ADMIN', 'SUPERADMIN'];
    for (const code of ROLES) {
      await conn.query('INSERT IGNORE INTO roles (code) VALUES (?)', [code]);
    }
    console.log('✓ Roles: all 6 role codes seeded (INSERT IGNORE)');

    // ── 2. Settings defaults ───────────────────────────────────────────────
    const DEFAULTS: Array<[string, string]> = [
      ['leaderboard_enabled',       'true'],
      ['announcement',              ''],
      ['leaderboard_refresh_minutes', '60'],
    ];
    for (const [key, val] of DEFAULTS) {
      await conn.query(
        'INSERT IGNORE INTO settings (skey, svalue) VALUES (?, ?)',
        [key, val],
      );
    }
    console.log('✓ Settings: default rows seeded (INSERT IGNORE)');

    // ── 3. Course codes ────────────────────────────────────────────────────
    const [ccRows] = await conn.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM course_codes',
    );
    if (Number((ccRows as import('mysql2/promise').RowDataPacket[])[0]!.cnt) === 0) {
      await conn.query(
        `INSERT INTO course_codes (code, branch, name) VALUES
          ('15', 'CSE', 'Computer Science and Engineering'),
          ('16', 'ECE', 'Electronics and Communication Engineering')`,
      );
      console.log('✓ Course codes: seeded 15=CSE, 16=ECE');
    } else {
      console.log('  Course codes: rows already exist — skipped');
    }

    // ── 4. Demo team ───────────────────────────────────────────────────────
    const [teamRows] = await conn.query<import('mysql2/promise').RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM club_teams',
    );
    if (Number((teamRows as import('mysql2/promise').RowDataPacket[])[0]!.cnt) === 0) {
      await conn.query(
        "INSERT INTO club_teams (name, display_order) VALUES ('Core Team', 0)",
      );
      console.log('✓ Demo team "Core Team" created — edit it in /admin/teams');
    } else {
      console.log('  Teams: rows already exist — skipped');
    }

    console.log('');
    console.log('▶ Seed complete. Checklist:');
    console.log('  □ Add SEED_SUPERADMIN_EMAILS to env and log in to get SUPERADMIN role');
    console.log('  □ Review course_codes in DB or /admin/members and add new branches');
    console.log('  □ Set up Hostinger Cron (see README.md)');
    console.log('  □ Configure Google + Codeforces OAuth credentials');

  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
