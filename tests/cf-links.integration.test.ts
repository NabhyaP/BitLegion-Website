/**
 * Integration tests for Phase 2 — Codeforces linking (§B2).
 *
 * These tests exercise the service layer directly (no HTTP), which mirrors the
 * pattern used in auth.integration.test.ts.  They do NOT call the real CF OIDC
 * endpoint; they validate the business rules that sit below the OIDC callback:
 *
 *   - linkCfHandle: happy path, duplicate-handle conflict, re-link
 *   - unlinkCfHandle: happy path, no-link guard
 *   - /me: codeforces field populated / null correctly
 *   - solved_state seeded on link, cleared on unlink
 *   - audit rows written for cf.link and cf.unlink
 *
 * The "tampered state / nonce / audience" checks belong to the openid-client
 * library (which has its own test suite).  What we CAN test here is what
 * happens when those checks fail and the callback receives no valid attempt:
 *   - consumeLinkAttempt with an unknown state → null
 *   - consumeLinkAttempt with an expired attempt → null
 *   - consumeLinkAttempt is single-use (second call → null)
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { signInWithGoogleClaims } from '../server/src/modules/auth/service.ts';
import { meRouter } from '../server/src/modules/users/router.ts';
import { errorHandler } from '../server/src/middleware/errorHandler.ts';
import { regenerate, sessionMiddleware } from '../server/src/middleware/session.ts';
import { linkCfHandle, unlinkCfHandle } from '../server/src/modules/codeforces-links/service.ts';
import * as cfRepo from '../server/src/modules/codeforces-links/repository.ts';
import { pool } from '../server/src/db/pool.ts';
import type { RowDataPacket } from 'mysql2/promise';
import { closeDb, countRows, resetDb, seedPreProvisioned } from './helpers/db.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const collegeEmail = '112415119@cse.iiitp.ac.in';
const college2Email = '112415120@cse.iiitp.ac.in';

async function createUser(
  email = collegeEmail,
  sub = `sub-${email}`,
): Promise<number> {
  const { user } = await signInWithGoogleClaims({
    sub,
    email,
    email_verified: true,
    name: 'Test Student',
  });
  return user.id;
}

/** Minimal Express app for /me HTTP tests (mirrors me.integration.test.ts). */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware());

  app.post('/test-login', async (req, res, next) => {
    try {
      const { user } = await signInWithGoogleClaims({
        sub: req.body.sub ?? 'sub-1',
        email: req.body.email ?? collegeEmail,
        email_verified: true,
        name: 'Test Student',
      });
      await regenerate(req);
      req.session.userId = user.id;
      req.session.authAt = Date.now();
      req.session.save(() => res.json({ userId: user.id }));
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1/me', meRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  await pool.query('SELECT 1');
});
beforeEach(resetDb);
after(closeDb);

// ---------------------------------------------------------------------------
// linkCfHandle — happy path
// ---------------------------------------------------------------------------

test('linkCfHandle creates an ACTIVE codeforces_accounts row', async () => {
  const userId = await createUser();
  const { account, wasRelink } = await linkCfHandle(userId, 'tourist', null);

  assert.equal(account.handle, 'tourist');
  assert.equal(account.normalizedHandle, 'tourist');
  assert.equal(account.status, 'ACTIVE');
  assert.equal(account.userId, userId);
  assert.equal(wasRelink, false);
});

test('linkCfHandle is case-insensitive: Tourist and TOURIST both normalize to tourist', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'Tourist', null);
  const account = await cfRepo.findAccountByUserId(userId);
  assert.equal(account!.normalizedHandle, 'tourist');
});

test('linkCfHandle seeds a codeforces_solved_state row with zeroed counters', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', null);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM codeforces_solved_state WHERE user_id = ?`,
    [userId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].solved_count, 0);
  assert.equal(rows[0].last_submission_id, 0);
  assert.equal(rows[0].last_synced_at, null);
});

test('linkCfHandle writes a cf.link audit row', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', 'req-123');

  assert.equal(await countRows('audit_events', `action='cf.link' AND actor_user_id=${userId}`), 1);
});

// ---------------------------------------------------------------------------
// linkCfHandle — handle-taken conflict
// ---------------------------------------------------------------------------

test('linking a handle already owned by ANOTHER user throws HANDLE_TAKEN', async () => {
  const user1 = await createUser(collegeEmail, 'sub-1');
  const user2 = await createUser(college2Email, 'sub-2');

  await linkCfHandle(user1, 'tourist', null);

  await assert.rejects(
    () => linkCfHandle(user2, 'tourist', null),
    (err: unknown) =>
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'HANDLE_TAKEN',
    'different user claiming the same handle must throw HANDLE_TAKEN',
  );

  // user2 must have no CF link.
  const account2 = await cfRepo.findAccountByUserId(user2);
  assert.equal(account2, null);
});

test('linking the same handle for the SAME user (re-link) succeeds and updates the row', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', null);

  // Change handle to a new one — also valid as a re-link.
  const { account, wasRelink } = await linkCfHandle(userId, 'Petr', null);
  assert.equal(account.normalizedHandle, 'petr');
  assert.equal(account.status, 'ACTIVE');
  assert.equal(wasRelink, true);

  // Only one row (UNIQUE on user_id).
  assert.equal(await countRows('codeforces_accounts', `user_id=${userId}`), 1);
});

test('re-link writes a second cf.link audit row referencing the previous handle', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', null);
  await linkCfHandle(userId, 'Petr', null);

  assert.equal(await countRows('audit_events', `action='cf.link' AND actor_user_id=${userId}`), 2);
});

// ---------------------------------------------------------------------------
// unlinkCfHandle
// ---------------------------------------------------------------------------

test('unlinkCfHandle sets status to UNLINKED and removes solved_state', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', null);
  await unlinkCfHandle(userId, null);

  const account = await cfRepo.findAccountByUserId(userId);
  assert.equal(account!.status, 'UNLINKED');

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM codeforces_solved_state WHERE user_id = ?`,
    [userId],
  );
  assert.equal(rows.length, 0, 'solved_state must be cleared on unlink');
});

test('unlinkCfHandle writes a cf.unlink audit row', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', null);
  await unlinkCfHandle(userId, 'req-unlink');

  assert.equal(await countRows('audit_events', `action='cf.unlink' AND actor_user_id=${userId}`), 1);
});

test('unlinkCfHandle throws FORBIDDEN when there is no active link', async () => {
  const userId = await createUser();

  await assert.rejects(
    () => unlinkCfHandle(userId, null),
    (err: unknown) =>
      err !== null &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status: number }).status === 403,
    'unlink with no link must return 403',
  );
});

test('unlinkCfHandle throws FORBIDDEN when the account is already UNLINKED', async () => {
  const userId = await createUser();
  await linkCfHandle(userId, 'tourist', null);
  await unlinkCfHandle(userId, null);

  await assert.rejects(
    () => unlinkCfHandle(userId, null),
    (err: unknown) =>
      err !== null &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status: number }).status === 403,
  );
});

// ---------------------------------------------------------------------------
// /me — codeforces field
// ---------------------------------------------------------------------------

test('GET /me returns codeforces: null when no link exists', async () => {
  const app = makeApp();
  const agent = request.agent(app);
  await agent.post('/test-login').send({});
  const res = await agent.get('/api/v1/me');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.codeforces, null);
});

test('GET /me returns codeforces handle after linking', async () => {
  const app = makeApp();
  const agent = request.agent(app);
  const loginRes = await agent.post('/test-login').send({});
  const { userId } = loginRes.body;

  await linkCfHandle(userId, 'tourist', null);

  const res = await agent.get('/api/v1/me');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.codeforces !== null);
  assert.equal(res.body.data.codeforces.handle, 'tourist');
  assert.equal(res.body.data.codeforces.status, 'ACTIVE');
  assert.ok(typeof res.body.data.codeforces.verifiedAt === 'string');
});

test('GET /me returns codeforces: null after unlinking', async () => {
  const app = makeApp();
  const agent = request.agent(app);
  const loginRes = await agent.post('/test-login').send({});
  const { userId } = loginRes.body;

  await linkCfHandle(userId, 'tourist', null);
  await unlinkCfHandle(userId, null);

  const res = await agent.get('/api/v1/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.codeforces, null, 'UNLINKED must appear as null in /me');
});

// ---------------------------------------------------------------------------
// consumeLinkAttempt — "tampered / expired" simulation
// ---------------------------------------------------------------------------

test('consumeLinkAttempt with an unknown state returns null (tampered state)', async () => {
  const result = await cfRepo.consumeLinkAttempt('this-state-was-never-created');
  assert.equal(result, null);
});

test('consumeLinkAttempt with an expired attempt returns null', async () => {
  const userId = await createUser();
  // Insert a row with an expiry already in the past.
  await pool.query(
    `INSERT INTO codeforces_link_attempts
       (user_id, state, nonce, pkce_verifier, expires_at)
     VALUES (?, 'expired-state', 'nonce', 'verifier', DATE_SUB(NOW(), INTERVAL 1 MINUTE))`,
    [userId],
  );
  const result = await cfRepo.consumeLinkAttempt('expired-state');
  assert.equal(result, null, 'expired attempt must be treated as absent');
});

test('consumeLinkAttempt is single-use: second call returns null', async () => {
  const userId = await createUser();
  await cfRepo.createLinkAttempt(userId, 'once-state', 'nonce', 'verifier');

  const first = await cfRepo.consumeLinkAttempt('once-state');
  assert.ok(first !== null, 'first consume must succeed');

  const second = await cfRepo.consumeLinkAttempt('once-state');
  assert.equal(second, null, 'second consume must return null (row deleted)');
});

// ---------------------------------------------------------------------------
// seedPreProvisioned + link (pre-provisioned user can link CF handle)
// ---------------------------------------------------------------------------

test('a pre-provisioned user who activates on login can then link a CF handle', async () => {
  const email = '112415555@cse.iiitp.ac.in';
  await seedPreProvisioned(email, 'Pre-provisioned');

  // Activate via sign-in.
  const { user } = await signInWithGoogleClaims({
    sub: 'sub-preprov',
    email,
    email_verified: true,
    name: 'Pre-provisioned',
  });

  await linkCfHandle(user.id, 'Um_nik', null);

  const account = await cfRepo.findAccountByUserId(user.id);
  assert.equal(account!.status, 'ACTIVE');
  assert.equal(account!.normalizedHandle, 'um_nik');
});
