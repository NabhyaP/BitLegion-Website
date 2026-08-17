/**
 * Integration tests for Phase 4 — Leaderboard, Settings, Teams, Public Profile.
 *
 * Covers §H Phase 4 exit criteria:
 *  - Every filter/sort combo incl. NULL solved ordering
 *  - ETag / 304
 *  - Disabled vs admin-preview
 *  - Hide-user instant effect (show_in_leaderboard toggle)
 *  - Settings public GET + admin PATCH (audited)
 *  - Teams public GET + admin CRUD (audited)
 *  - Public profile 404 for hidden/suspended/unknown
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express } from 'express';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { createApp } from '../server/src/app.ts';
import { pool } from '../server/src/db/pool.ts';
import { sessionMiddleware } from '../server/src/middleware/session.ts';
import { signInWithGoogleClaims } from '../server/src/modules/auth/service.ts';
import {
  closeDb,
  countRows,
  resetDb,
  seedActiveSnapshot,
  seedLeaderboardEntry,
} from './helpers/db.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let csrfToken = '';

async function issueCsrf(targetApp: Express, sessionCookie = ''): Promise<string> {
  const csrfResponse = await request(targetApp)
    .get('/api/v1/auth/csrf-token')
    .set('Cookie', sessionCookie);
  csrfToken = csrfResponse.body.csrfToken as string;
  const setCookie = csrfResponse.headers['set-cookie'] as string | string[];
  const csrfCookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .filter(Boolean)
    .map((value) => value.split(';')[0]);
  return [sessionCookie, ...csrfCookies].filter(Boolean).join('; ');
}

/** Sign in a test user and return a cookie string for subsequent requests. */
async function signInAndGetCookie(app: Express, email: string): Promise<string> {
  // Create the user via service (populates DB), then simulate a session cookie.
  // We use the app's own session middleware by calling signInWithGoogleClaims
  // then grabbing the session via a synthetic request.
  const { user } = await signInWithGoogleClaims({
    sub: `sub-${email}`,
    email,
    email_verified: true,
    name: 'Test Admin',
  });

  // Promote to ADMIN so we can test admin routes.
  const [roleRow] = await pool.query<RowDataPacket[]>(`SELECT id FROM roles WHERE code = 'ADMIN'`);
  await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [
    user.id,
    roleRow[0].id,
  ]);

  // Hit /api/v1/auth/google/start won't work without OAuth; instead synthesise a session
  // by posting to a tiny test-only endpoint mounted on the test app.
  const testApp = express();
  testApp.use(sessionMiddleware());
  testApp.post('/test-login', (req, _res, next) => {
    req.session.userId = user.id;
    req.session.authAt = Date.now();
    req.session.save((err) => {
      if (err) return next(err);
      _res.status(200).json({ ok: true });
    });
  });

  const loginRes = await request(testApp).post('/test-login');
  const setCookie = loginRes.headers['set-cookie'] as string | string[];
  const cookie = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : setCookie.split(';')[0];
  return issueCsrf(app, cookie);
}

/** Seed settings rows (may already exist from migration seed). */
async function ensureSettings(): Promise<void> {
  await pool.query(
    `INSERT IGNORE INTO settings (skey, svalue) VALUES
       ('leaderboard_enabled', 'true'),
       ('announcement', ''),
       ('leaderboard_refresh_minutes', '60')`,
  );
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let app: Express;

before(async () => {
  await pool.query('SELECT 1'); // fail fast if no DB
  app = createApp();
});
beforeEach(async () => {
  await resetDb();
  await ensureSettings();
});
after(closeDb);

test('Google sign-in redirects to a clear login error when OAuth is not configured', async () => {
  const response = await request(app).get('/api/v1/auth/google/start').expect(302);
  assert.equal(response.headers.location, '/login?error=oauth-not-configured');
});

test('admin can set and clear a member avatar URL and the change is audited', async () => {
  const email = '100000000@cse.iiitp.ac.in';
  const cookie = await signInAndGetCookie(app, email);
  const [users] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE college_email = ?', [email]);
  const userId = Number(users[0]!.id);
  const avatarUrl = 'https://images.example.test/member.png';

  const updated = await request(app)
    .patch(`/api/v1/admin/members/${userId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ avatarUrl })
    .expect(200);
  assert.equal(updated.body.data.avatarUrl, avatarUrl);
  assert.equal(await countRows('audit_events', `action = 'member.edit'`), 1);

  const rejected = await request(app)
    .patch(`/api/v1/admin/members/${userId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ avatarUrl: 'javascript:alert(1)' });
  assert.equal(rejected.status, 400);

  const cleared = await request(app)
    .patch(`/api/v1/admin/members/${userId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ avatarUrl: null })
    .expect(200);
  assert.equal(cleared.body.data.avatarUrl, null);
});

// ===========================================================================
// Settings
// ===========================================================================

test('GET /api/v1/settings/public returns announcement and leaderboardEnabled', async () => {
  const res = await request(app).get('/api/v1/settings/public');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.announcement, 'string');
  assert.equal(typeof res.body.data.leaderboardEnabled, 'boolean');
});

test('GET /api/v1/settings/public reflects a disabled leaderboard', async () => {
  await pool.query(`UPDATE settings SET svalue = 'false' WHERE skey = 'leaderboard_enabled'`);
  const res = await request(app).get('/api/v1/settings/public');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.leaderboardEnabled, false);
});

test('PATCH /api/v1/admin/settings rejects an unauthenticated mutation', async () => {
  const cookie = await issueCsrf(app);
  const res = await request(app)
    .patch('/api/v1/admin/settings')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ announcement: 'hello' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'EBADCSRFTOKEN');
});

test('PATCH /api/v1/admin/settings updates announcement and writes audit row', async () => {
  const cookie = await signInAndGetCookie(app, '100000001@cse.iiitp.ac.in');
  const res = await request(app)
    .patch('/api/v1/admin/settings')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ announcement: 'Welcome to BitLegion!' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.announcement, 'Welcome to BitLegion!');
  assert.equal(await countRows('audit_events', `action = 'settings.update'`), 1);
});

test('PATCH /api/v1/admin/settings rejects leaderboardRefreshMinutes < 30', async () => {
  const cookie = await signInAndGetCookie(app, '100000002@cse.iiitp.ac.in');
  const res = await request(app)
    .patch('/api/v1/admin/settings')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ leaderboardRefreshMinutes: 15 });
  assert.equal(res.status, 400);
});

test('GET /api/v1/admin/settings returns leaderboardRefreshMinutes', async () => {
  const cookie = await signInAndGetCookie(app, '100000003@cse.iiitp.ac.in');
  const res = await request(app)
    .get('/api/v1/admin/settings')
    .set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.leaderboardRefreshMinutes, 'number');
});

// ===========================================================================
// Leaderboard
// ===========================================================================

test('GET /api/v1/leaderboards/codeforces returns disabled:true when no snapshot', async () => {
  // No snapshot seeded — service should return disabled sentinel
  const res = await request(app).get('/api/v1/leaderboards/codeforces');
  // No snapshot published yet → disabled (leaderboard_active table is empty)
  assert.equal(res.status, 200);
  assert.ok('disabled' in res.body || Array.isArray(res.body.data) === false || res.body.disabled);
});

test('leaderboard returns data after snapshot published', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'tourist', rating: 3800, maxRating: 3900, position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'petr', rating: 3600, maxRating: 3700, position: 2 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.data[0].handle, 'tourist'); // higher rating first
});

test('leaderboard sort=maxRating orders by maxRating DESC', async () => {
  const versionId = await seedActiveSnapshot();
  // tourist has lower rating but higher maxRating
  await seedLeaderboardEntry({ versionId, handle: 'aa', rating: 3600, maxRating: 4000, position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'bb', rating: 3800, maxRating: 3900, position: 2 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces?sort=maxRating');
  assert.equal(res.status, 200);
  assert.equal(res.body.data[0].handle, 'aa'); // maxRating 4000 > 3900
});

test('leaderboard sort=solvedCount: NULL solved renders last', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'withsolved', rating: 1500, solvedCount: 200, position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'nosolved', rating: 2000, solvedCount: null, position: 2 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces?sort=solvedCount');
  assert.equal(res.status, 200);
  const handles = res.body.data.map((e: { handle: string }) => e.handle);
  assert.equal(handles[0], 'withsolved');
  assert.equal(handles[handles.length - 1], 'nosolved');
});

test('leaderboard null solvedCount renders as null in response', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'nosolved2', solvedCount: null, position: 1 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces');
  assert.equal(res.status, 200);
  const entry = res.body.data.find((e: { handle: string }) => e.handle === 'nosolved2');
  assert.ok(entry);
  assert.equal(entry.solvedCount, null);
});

test('leaderboard filter by batch', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'batch24', batch: 2024, position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'batch25', batch: 2025, position: 2 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces?batch=2024');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].handle, 'batch24');
});

test('leaderboard filter by branch', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'cse1', branch: 'CSE', position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'ece1', branch: 'ECE', position: 2 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces?branch=CSE');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].handle, 'cse1');
});

test('leaderboard search by handle', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'searchme', position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'other', position: 2 });

  const res = await request(app).get('/api/v1/leaderboards/codeforces?q=searchme');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].handle, 'searchme');
});

test('leaderboard cursor pagination: limit=1 returns nextCursor, second page has second entry', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'page1', rating: 2000, maxRating: 2000, position: 1 });
  await seedLeaderboardEntry({ versionId, handle: 'page2', rating: 1800, maxRating: 1800, position: 2 });

  const res1 = await request(app).get('/api/v1/leaderboards/codeforces?limit=1');
  assert.equal(res1.status, 200);
  assert.equal(res1.body.data.length, 1);
  assert.ok(res1.body.meta.nextCursor, 'nextCursor must be present when more pages exist');

  const res2 = await request(app).get(
    `/api/v1/leaderboards/codeforces?limit=1&cursor=${res1.body.meta.nextCursor}`,
  );
  assert.equal(res2.status, 200);
  assert.equal(res2.body.data.length, 1);
  assert.equal(res2.body.data[0].handle, 'page2');
  assert.equal(res2.body.meta.nextCursor, null);
});

test('leaderboard ETag: second identical request returns 304', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'etagtest', position: 1 });

  const res1 = await request(app).get('/api/v1/leaderboards/codeforces');
  assert.equal(res1.status, 200);
  const etag = res1.headers['etag'];
  assert.ok(etag, 'ETag header must be set');

  const res2 = await request(app)
    .get('/api/v1/leaderboards/codeforces')
    .set('If-None-Match', etag);
  assert.equal(res2.status, 304);
});

test('rating trends return overall and batch average/median history', async () => {
  const versionId = await seedActiveSnapshot();
  const first = await seedLeaderboardEntry({ versionId, handle: 'trend-a', rating: 1400, batch: 2024 });
  const second = await seedLeaderboardEntry({ versionId, handle: 'trend-b', rating: 1600, batch: 2024 });
  await pool.query(
    `INSERT INTO codeforces_rating_daily (user_id, snapshot_date, rating, max_rating) VALUES
       (?, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 1300, 1400),
       (?, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 1500, 1600),
       (?, CURDATE(), 1400, 1400),
       (?, CURDATE(), 1600, 1600)`,
    [first.userId, second.userId, first.userId, second.userId],
  );

  const response = await request(app).get('/api/v1/leaderboards/codeforces/trends?days=90');
  assert.equal(response.status, 200);
  const overall = response.body.data.find((series: { batchYear: number | null }) => series.batchYear === null);
  const batch = response.body.data.find((series: { batchYear: number | null }) => series.batchYear === 2024);
  assert.deepEqual(overall.points.map((point: { average: number; median: number }) => [point.average, point.median]), [
    [1400, 1400],
    [1500, 1500],
  ]);
  assert.equal(batch.points[1].memberCount, 2);
});

test('personal comparison uses the signed-in member and active snapshot population', async () => {
  const cookie = await signInAndGetCookie(app, '200000009@cse.iiitp.ac.in');
  const [users] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM users WHERE college_email = '200000009@cse.iiitp.ac.in'`,
  );
  const userId = Number(users[0].id);
  const versionId = await seedActiveSnapshot();
  await pool.query(
    `INSERT INTO leaderboard_entries
       (version_id, user_id, position, handle, rating, max_rating, profile_updated_at)
     VALUES (?, ?, 1, 'personal-user', 1600, 1700, NOW())`,
    [versionId, userId],
  );
  await seedLeaderboardEntry({ versionId, handle: 'comparison-peer', rating: 1400, batch: 2024, position: 2 });

  const response = await request(app)
    .get('/api/v1/leaderboards/codeforces/me-comparison')
    .set('Cookie', cookie);
  assert.equal(response.status, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.overall.rank, 1);
  assert.equal(response.body.overall.average, 1500);
  assert.equal(response.body.overall.differenceFromAverage, 100);
});

test('leaderboard disabled: returns {disabled:true} for public, previewOnly for admin', async () => {
  await pool.query(`UPDATE settings SET svalue = 'false' WHERE skey = 'leaderboard_enabled'`);
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'disabledtest', position: 1 });

  // Public sees disabled sentinel
  const pubRes = await request(app).get('/api/v1/leaderboards/codeforces');
  assert.equal(pubRes.status, 200);
  assert.equal(pubRes.body.disabled, true);

  // Admin sees data with previewOnly flag
  const cookie = await signInAndGetCookie(app, '200000001@cse.iiitp.ac.in');
  const adminRes = await request(app)
    .get('/api/v1/leaderboards/codeforces')
    .set('Cookie', cookie);
  assert.equal(adminRes.status, 200);
  assert.ok(Array.isArray(adminRes.body.data));
  assert.equal(adminRes.body.meta.previewOnly, true);
});

test('hide-user has instant effect: toggled user vanishes from leaderboard without republish', async () => {
  const versionId = await seedActiveSnapshot();
  const { userId } = await seedLeaderboardEntry({ versionId, handle: 'hideme', position: 1 });

  const before = await request(app).get('/api/v1/leaderboards/codeforces');
  assert.equal(before.body.data.length, 1);

  // Flip show_in_leaderboard off — no new snapshot needed
  await pool.query(`UPDATE users SET show_in_leaderboard = 0 WHERE id = ?`, [userId]);

  const after = await request(app).get('/api/v1/leaderboards/codeforces');
  assert.equal(after.body.data.length, 0, 'hidden user must be excluded immediately');
});

test('leaderboard rejects invalid sort param', async () => {
  const res = await request(app).get('/api/v1/leaderboards/codeforces?sort=invalid');
  assert.equal(res.status, 400);
});

test('leaderboard rejects limit > 100', async () => {
  const res = await request(app).get('/api/v1/leaderboards/codeforces?limit=200');
  assert.equal(res.status, 400);
});

// ===========================================================================
// Public profile
// ===========================================================================

test('GET /api/v1/profiles/:handle returns profile for active user in snapshot', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({
    versionId,
    handle: 'profiletest',
    rating: 1800,
    maxRating: 2000,
    batch: 2024,
    branch: 'CSE',
    position: 1,
  });

  const res = await request(app).get('/api/v1/profiles/profiletest');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.handle, 'profiletest');
  assert.equal(res.body.data.rating, 1800);
  assert.equal(res.body.data.batch, 2024);
});

test('GET /api/v1/profiles/:handle is case-insensitive (normalized to lowercase)', async () => {
  const versionId = await seedActiveSnapshot();
  await seedLeaderboardEntry({ versionId, handle: 'casetest', position: 1 });

  const res = await request(app).get('/api/v1/profiles/CaseTest');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.handle, 'casetest');
});

test('GET /api/v1/profiles/:handle returns 404 for unknown handle', async () => {
  await seedActiveSnapshot();
  const res = await request(app).get('/api/v1/profiles/nobody');
  assert.equal(res.status, 404);
});

test('GET /api/v1/profiles/:handle returns 404 for hidden user (never 403)', async () => {
  const versionId = await seedActiveSnapshot();
  const { userId } = await seedLeaderboardEntry({ versionId, handle: 'hiddenuser', position: 1 });
  await pool.query(`UPDATE users SET show_in_leaderboard = 0 WHERE id = ?`, [userId]);

  const res = await request(app).get('/api/v1/profiles/hiddenuser');
  assert.equal(res.status, 404, 'must be 404, not 403 — no enumeration (§G)');
});

test('GET /api/v1/profiles/:handle returns 404 for suspended user (never 403)', async () => {
  const versionId = await seedActiveSnapshot();
  const { userId } = await seedLeaderboardEntry({ versionId, handle: 'suspended1', position: 1 });
  await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = ?`, [userId]);

  const res = await request(app).get('/api/v1/profiles/suspended1');
  assert.equal(res.status, 404, 'suspended user must 404, not 403');
});

// ===========================================================================
// Teams
// ===========================================================================

test('GET /api/v1/teams returns empty array when no teams', async () => {
  const res = await request(app).get('/api/v1/teams');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('admin can manage course codes exposed by the public endpoint', async () => {
  const cookie = await signInAndGetCookie(app, '300000099@cse.iiitp.ac.in');
  const created = await request(app)
    .post('/api/v1/admin/course-codes')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ code: '17', branch: 'IT', name: 'Information Technology' });
  assert.equal(created.status, 201);

  const publicList = await request(app).get('/api/v1/course-codes');
  assert.ok(publicList.body.data.some((course: { code: string }) => course.code === '17'));

  const updated = await request(app)
    .patch('/api/v1/admin/course-codes/17')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ branch: 'IT', name: 'Information Technology Engineering' });
  assert.equal(updated.body.data.name, 'Information Technology Engineering');

  const removed = await request(app)
    .delete('/api/v1/admin/course-codes/17')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken);
  assert.equal(removed.status, 204);
});

test('admin POST /api/v1/admin/teams creates team and writes audit row', async () => {
  const cookie = await signInAndGetCookie(app, '300000001@cse.iiitp.ac.in');
  const res = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Core Team', displayOrder: 1 });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Core Team');
  assert.equal(await countRows('club_teams'), 1);
  assert.equal(await countRows('audit_events', `action = 'team.create'`), 1);
});

test('admin PATCH /api/v1/admin/teams/:id updates team and audits', async () => {
  const cookie = await signInAndGetCookie(app, '300000002@cse.iiitp.ac.in');
  const create = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Old Name', displayOrder: 0 });
  const teamId = create.body.data.id;

  const res = await request(app)
    .patch(`/api/v1/admin/teams/${teamId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'New Name', displayOrder: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'New Name');
  assert.equal(await countRows('audit_events', `action = 'team.update'`), 1);
});

test('admin DELETE /api/v1/admin/teams/:id removes team and its members', async () => {
  const cookie = await signInAndGetCookie(app, '300000003@cse.iiitp.ac.in');
  const create = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'ToDelete', displayOrder: 0 });
  const teamId = create.body.data.id;

  // Add a member first
  await request(app)
    .post(`/api/v1/admin/teams/${teamId}/members`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Jane', roleTitle: 'Dev', displayOrder: 0 });

  assert.equal(await countRows('club_team_members'), 1);

  const del = await request(app)
    .delete(`/api/v1/admin/teams/${teamId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken);
  assert.equal(del.status, 204);
  assert.equal(await countRows('club_teams'), 0);
  assert.equal(await countRows('club_team_members'), 0, 'cascade delete removes members');
  assert.equal(await countRows('audit_events', `action = 'team.delete'`), 1);
});

test('admin POST /api/v1/admin/teams/:id/members creates member with audit', async () => {
  const cookie = await signInAndGetCookie(app, '300000004@cse.iiitp.ac.in');
  const team = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Dev Team', displayOrder: 0 });
  const teamId = team.body.data.id;

  const res = await request(app)
    .post(`/api/v1/admin/teams/${teamId}/members`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Alice', roleTitle: 'Lead', cfHandle: 'alice_cf', displayOrder: 1 });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Alice');
  assert.equal(res.body.data.cfHandle, 'alice_cf');
  assert.equal(await countRows('audit_events', `action = 'team.member.create'`), 1);
});

test('admin PATCH /api/v1/admin/teams/:id/members/:mid updates member', async () => {
  const cookie = await signInAndGetCookie(app, '300000005@cse.iiitp.ac.in');
  const team = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'A Team', displayOrder: 0 });
  const teamId = team.body.data.id;

  const member = await request(app)
    .post(`/api/v1/admin/teams/${teamId}/members`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Bob', roleTitle: 'Member', displayOrder: 0 });
  const memberId = member.body.data.id;

  const res = await request(app)
    .patch(`/api/v1/admin/teams/${teamId}/members/${memberId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ roleTitle: 'Senior Member' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.roleTitle, 'Senior Member');
  assert.equal(await countRows('audit_events', `action = 'team.member.update'`), 1);
});

test('admin DELETE /api/v1/admin/teams/:id/members/:mid removes member', async () => {
  const cookie = await signInAndGetCookie(app, '300000006@cse.iiitp.ac.in');
  const team = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'X Team', displayOrder: 0 });
  const teamId = team.body.data.id;

  const member = await request(app)
    .post(`/api/v1/admin/teams/${teamId}/members`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Carol', roleTitle: 'Dev', displayOrder: 0 });
  const memberId = member.body.data.id;

  const res = await request(app)
    .delete(`/api/v1/admin/teams/${teamId}/members/${memberId}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken);
  assert.equal(res.status, 204);
  assert.equal(await countRows('club_team_members'), 0);
  assert.equal(await countRows('audit_events', `action = 'team.member.delete'`), 1);
});

test('GET /api/v1/teams returns teams with members nested by displayOrder', async () => {
  const cookie = await signInAndGetCookie(app, '300000007@cse.iiitp.ac.in');
  const team = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Dev Team', displayOrder: 0 });
  const teamId = team.body.data.id;
  await request(app)
    .post(`/api/v1/admin/teams/${teamId}/members`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Z Member', roleTitle: 'Dev', displayOrder: 2 });
  await request(app)
    .post(`/api/v1/admin/teams/${teamId}/members`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'A Member', roleTitle: 'Lead', displayOrder: 1 });

  const res = await request(app).get('/api/v1/teams');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].members.length, 2);
  assert.equal(res.body.data[0].members[0].name, 'A Member', 'displayOrder 1 comes first');
});

test('admin team routes require ADMIN role', async () => {
  // Sign in as plain MEMBER (no admin promotion)
  await signInWithGoogleClaims({
    sub: 'member-sub',
    email: '400000001@cse.iiitp.ac.in',
    email_verified: true,
    name: 'Plain Member',
  });
  const memberApp = express();
  memberApp.use(sessionMiddleware());
  memberApp.post('/test-login', async (req, _res, next) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE college_email = '400000001@cse.iiitp.ac.in'`,
    );
    req.session.userId = rows[0].id;
    req.session.authAt = Date.now();
    req.session.save((err) => {
      if (err) return next(err);
      _res.json({ ok: true });
    });
  });

  const loginRes = await request(memberApp).post('/test-login');
  const sessionCookie = (loginRes.headers['set-cookie'] as string[])[0].split(';')[0];
  const cookie = await issueCsrf(app, sessionCookie);

  const res = await request(app)
    .post('/api/v1/admin/teams')
    .set('Cookie', cookie)
    .set('x-csrf-token', csrfToken)
    .send({ name: 'Forbidden', displayOrder: 0 });
  assert.equal(res.status, 403);
});
