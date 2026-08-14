// Integration: §B1 callback rules against a real MySQL.
// Run with tests/run-integration.ps1 (or set DB_* at a disposable MySQL and run node --test).
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SignInError, signInWithGoogleClaims } from '../server/src/modules/auth/service.ts';
import * as users from '../server/src/modules/users/repository.ts';
import { pool } from '../server/src/db/pool.ts';
import { closeDb, countRows, resetDb, seedPreProvisioned } from './helpers/db.ts';

const claims = (over: Record<string, unknown> = {}) => ({
  sub: 'google-sub-1',
  email: '112415119@cse.iiitp.ac.in',
  email_verified: true,
  name: 'Test Student',
  ...over,
});

before(async () => {
  await pool.query('SELECT 1'); // fail fast with a clear error if no DB is configured
});
beforeEach(resetDb);
after(closeDb);

test('accepts a verified college address and creates an ACTIVE MEMBER', async () => {
  const { user, isNew } = await signInWithGoogleClaims(claims());
  assert.equal(isNew, true);
  assert.equal(user.collegeEmail, '112415119@cse.iiitp.ac.in');
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.batchYear, 2024, 'batch decoded from roll digits');
  assert.equal(user.branch, 'CSE', 'course code 15 mapped via course_codes');
  assert.deepEqual(await users.getRoles(user.id), ['MEMBER']);
});

test('second sign-in returns the same user, does not duplicate', async () => {
  const first = await signInWithGoogleClaims(claims());
  const second = await signInWithGoogleClaims(claims());
  assert.equal(second.user.id, first.user.id);
  assert.equal(second.isNew, false);
  assert.equal(await countRows('users'), 1);
});

test('rejects non-college and lookalike domains', async () => {
  for (const email of [
    'someone@gmail.com',
    'someone@iiitp.ac.in.evil.com',
    'someone@notiiitp.ac.in',
  ]) {
    await assert.rejects(
      () => signInWithGoogleClaims(claims({ email, sub: `sub-${email}` })),
      (err: unknown) => err instanceof SignInError && err.reason === 'not-college-email',
      email,
    );
  }
  assert.equal(await countRows('users'), 0, 'no user rows created for rejected sign-ins');
});

test('rejects unverified email even on the right domain', async () => {
  await assert.rejects(
    () => signInWithGoogleClaims(claims({ email_verified: false })),
    (err: unknown) => err instanceof SignInError && err.reason === 'not-college-email',
  );
  assert.equal(await countRows('users'), 0);
});

test('suspended accounts are rejected', async () => {
  const { user } = await signInWithGoogleClaims(claims());
  await pool.query("UPDATE users SET status='SUSPENDED' WHERE id=?", [user.id]);
  await assert.rejects(
    () => signInWithGoogleClaims(claims()),
    (err: unknown) => err instanceof SignInError && err.reason === 'account-suspended',
  );
});

test('pre-provisioned PENDING row activates on first matching login', async () => {
  const email = '112415777@cse.iiitp.ac.in';
  const seededId = await seedPreProvisioned(email, 'Roster Name');
  const { user, isNew } = await signInWithGoogleClaims(
    claims({ email, sub: 'sub-preprov', name: 'Google Name' }),
  );
  assert.equal(user.id, seededId, 'reuses the pre-provisioned row');
  assert.equal(isNew, false);
  assert.equal(user.status, 'ACTIVE', 'PENDING → ACTIVE');
  assert.equal(user.displayName, 'Roster Name', 'roster name is not overwritten by Google');
  assert.equal(await countRows('users'), 1);
  assert.equal(await countRows('audit_events', "action='user.activate'"), 1);
});

test('a different Google account cannot claim an already-bound college address', async () => {
  await signInWithGoogleClaims(claims());
  await assert.rejects(
    () => signInWithGoogleClaims(claims({ sub: 'different-google-sub' })),
    (err: unknown) => err instanceof SignInError && err.reason === 'oauth-failure',
  );
  assert.equal(await countRows('users'), 1);
});

test('every sign-in path writes an audit row', async () => {
  await signInWithGoogleClaims(claims());
  assert.equal(await countRows('audit_events', "action='user.create'"), 1);
});
