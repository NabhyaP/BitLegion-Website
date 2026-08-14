import test from 'node:test';
import assert from 'node:assert/strict';
import { canChangeRole } from './permissions.ts';

const ADMIN = { actorId: 1, actorRoles: ['ADMIN' as const] };
const SUPER = { actorId: 1, actorRoles: ['SUPERADMIN' as const] };

test('nobody edits their own roles, not even SUPERADMIN', () => {
  assert.equal(canChangeRole({ ...SUPER, targetId: 1, role: 'MEMBER' }), 'self-edit');
  assert.equal(canChangeRole({ ...ADMIN, targetId: 1, role: 'MODERATOR' }), 'self-edit');
});

test('ADMIN cannot grant ADMIN or SUPERADMIN', () => {
  assert.equal(canChangeRole({ ...ADMIN, targetId: 2, role: 'ADMIN' }), 'superadmin-only');
  assert.equal(canChangeRole({ ...ADMIN, targetId: 2, role: 'SUPERADMIN' }), 'superadmin-only');
});

test('ADMIN may assign roles up to MODERATOR', () => {
  for (const role of ['MEMBER', 'MENTOR', 'EDITOR', 'MODERATOR'] as const) {
    assert.equal(canChangeRole({ ...ADMIN, targetId: 2, role }), null, role);
  }
});

test('SUPERADMIN may assign anything to someone else', () => {
  assert.equal(canChangeRole({ ...SUPER, targetId: 2, role: 'ADMIN' }), null);
  assert.equal(canChangeRole({ ...SUPER, targetId: 2, role: 'SUPERADMIN' }), null);
});

test('plain members are not authorized at all', () => {
  assert.equal(
    canChangeRole({ actorId: 5, actorRoles: ['MEMBER'], targetId: 2, role: 'MEMBER' }),
    'not-authorized',
  );
  // A non-admin is rejected for lacking authority, before the target role is even considered.
  assert.equal(
    canChangeRole({ actorId: 5, actorRoles: ['MODERATOR'], targetId: 2, role: 'ADMIN' }),
    'not-authorized',
  );
});
