import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from './return-to.ts';

test('safeReturnTo accepts same-origin paths', () => {
  assert.equal(safeReturnTo('/leaderboard?batch=2024#top'), '/leaderboard?batch=2024#top');
});

test('safeReturnTo rejects external and malformed redirects', () => {
  assert.equal(safeReturnTo('//evil.example/path'), null);
  assert.equal(safeReturnTo('/\\evil.example'), null);
  assert.equal(safeReturnTo('/%5cevil.example'), null);
  assert.equal(safeReturnTo('https://evil.example'), null);
  assert.equal(safeReturnTo('/ok\nSet-Cookie:test'), null);
});
