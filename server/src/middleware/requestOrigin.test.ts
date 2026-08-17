import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedOrigin } from './requestOrigin.ts';

test('isAllowedOrigin requires an exact scheme, host, and port match', () => {
  const appUrl = 'https://club.example.edu';
  assert.equal(isAllowedOrigin('https://club.example.edu', appUrl), true);
  assert.equal(isAllowedOrigin('https://club.example.edu/path', appUrl), true);
  assert.equal(isAllowedOrigin('http://club.example.edu', appUrl), false);
  assert.equal(isAllowedOrigin('https://evil.example', appUrl), false);
  assert.equal(isAllowedOrigin('null', appUrl), false);
});
