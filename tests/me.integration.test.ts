// Integration: /me, PATCH /me one-time confirm, auth guards and session rotation over HTTP.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { signInWithGoogleClaims } from '../server/src/modules/auth/service.ts';
import { meRouter } from '../server/src/modules/users/router.ts';
import { errorHandler } from '../server/src/middleware/errorHandler.ts';
import { regenerate, sessionMiddleware } from '../server/src/middleware/session.ts';
import { pool } from '../server/src/db/pool.ts';
import { closeDb, resetDb } from './helpers/db.ts';

/** Minimal app: session + a test-only login route + the real /me router. */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware());

  // Stands in for the Google callback: same session handling, no network.
  app.post('/test-login', async (req, res, next) => {
    try {
      const { user } = await signInWithGoogleClaims({
        sub: req.body.sub ?? 'sub-1',
        email: req.body.email ?? '112415119@cse.iiitp.ac.in',
        email_verified: true,
        name: 'Test Student',
      });
      const before = req.sessionID;
      await regenerate(req);
      req.session.userId = user.id;
      req.session.authAt = Date.now();
      req.session.save(() => res.json({ userId: user.id, sidBefore: before, sidAfter: req.sessionID }));
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1/me', meRouter);
  app.use(errorHandler);
  return app;
}

const app = makeApp();
beforeEach(resetDb);
after(closeDb);

test('GET /me requires authentication', async () => {
  const res = await request(app).get('/api/v1/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.ok(!JSON.stringify(res.body).includes('stack'), 'no stack leaked');
});

test('GET /me returns the session user and is not cacheable', async () => {
  const agent = request.agent(app);
  await agent.post('/test-login').send({});
  const res = await agent.get('/api/v1/me');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.data.batchYear, 2024);
  assert.equal(res.body.data.branch, 'CSE');
  assert.deepEqual(res.body.data.roles, ['MEMBER']);
});

test('session ID rotates on sign-in', async () => {
  const agent = request.agent(app);
  await agent.get('/api/v1/me'); // establish a pre-login session id
  const res = await agent.post('/test-login').send({});
  assert.notEqual(res.body.sidAfter, res.body.sidBefore, 'session must be regenerated');
});

test('a suspended user loses access immediately, not at next login', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/test-login').send({});
  await pool.query("UPDATE users SET status='SUSPENDED' WHERE id=?", [login.body.userId]);
  const res = await agent.get('/api/v1/me');
  assert.equal(res.status, 403);
});

test('PATCH /me confirms identity once, then locks it', async () => {
  const agent = request.agent(app);
  await agent.post('/test-login').send({});

  const first = await agent
    .patch('/api/v1/me')
    .send({ displayName: 'Chosen Name', batchYear: 2023, confirmProfile: true });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.batchYear, 2023);
  assert.equal(first.body.data.profileConfirmed, true);

  const second = await agent.patch('/api/v1/me').send({ batchYear: 2019 });
  assert.equal(second.status, 403, 'identity fields are editable only once');

  // displayName stays editable afterwards.
  const third = await agent.patch('/api/v1/me').send({ displayName: 'Renamed' });
  assert.equal(third.status, 200);
  assert.equal(third.body.data.displayName, 'Renamed');
  assert.equal(third.body.data.batchYear, 2023, 'unchanged');
});

test('PATCH /me rejects unknown fields and bad values', async () => {
  const agent = request.agent(app);
  await agent.post('/test-login').send({});
  const injected = await agent.patch('/api/v1/me').send({ status: 'ACTIVE' });
  assert.equal(injected.status, 400, 'strict schema blocks privilege fields');
  const bad = await agent.patch('/api/v1/me').send({ batchYear: 1200 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields.batchYear);
});
