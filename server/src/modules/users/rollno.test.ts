import test from 'node:test';
import assert from 'node:assert/strict';
import { isCollegeEmail, parseCollegeEmail } from './rollno.ts';

const S = 'iiitp.ac.in';

test('suffix gate accepts college addresses', () => {
  assert.equal(isCollegeEmail('112415119@cse.iiitp.ac.in', S), true);
  assert.equal(isCollegeEmail('x@iiitp.ac.in', S), true);
  assert.equal(isCollegeEmail('X@CSE.IIITP.AC.IN', S), true);
});

test('suffix gate rejects impostors', () => {
  assert.equal(isCollegeEmail('x@gmail.com', S), false);
  // The attack the spec calls out explicitly:
  assert.equal(isCollegeEmail('x@iiitp.ac.in.evil.com', S), false);
  // No dot boundary — must not be treated as a subdomain.
  assert.equal(isCollegeEmail('x@notiiitp.ac.in', S), false);
  assert.equal(isCollegeEmail('x@evil.com?@iiitp.ac.in', S), false);
  assert.equal(isCollegeEmail('no-at-sign', S), false);
});

test('parses the owner-confirmed roll layout 11|24|15|119', () => {
  const p = parseCollegeEmail('112415119@cse.iiitp.ac.in', S);
  assert.equal(p.rollNo, '112415119');
  assert.equal(p.batchYear, 2024);
  assert.equal(p.courseCode, '15');
  assert.equal(p.branch, 'CSE');
});

test('branch is null on the bare domain, and short rolls decode to null', () => {
  const bare = parseCollegeEmail('someone@iiitp.ac.in', S);
  assert.equal(bare.branch, null);
  assert.equal(bare.rollNo, null);
  assert.equal(bare.batchYear, null);

  const short = parseCollegeEmail('1124@cse.iiitp.ac.in', S);
  assert.equal(short.batchYear, 2024);
  assert.equal(short.courseCode, null, 'no course digits present');
});

test('normalizes case and ignores non-digits in the local part', () => {
  const p = parseCollegeEmail('BT112415119@ECE.iiitp.ac.in', S);
  assert.equal(p.email, 'bt112415119@ece.iiitp.ac.in');
  assert.equal(p.rollNo, '112415119');
  assert.equal(p.branch, 'ECE');
});
