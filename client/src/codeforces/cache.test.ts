import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getMeta, getSubmissions, upsertSubmissions } from './cache.ts';
import type { CfSubmission } from './types.ts';

function submission(id: number): CfSubmission {
  return {
    submissionId: id,
    createdAt: id * 1000,
    contestId: 1,
    problemIndex: 'A',
    problemName: `Problem ${id}`,
    rating: 800,
    tags: ['implementation'],
    verdict: 'OK',
    language: 'GNU C++20',
    problemKey: `1-${id}`,
  };
}

describe('Codeforces cache', () => {
  it('counts only new submissions and preserves the highest submission id', async () => {
    const handle = `cache-test-${Date.now()}`;
    expect(await upsertSubmissions(handle, [submission(20), submission(10)])).toBe(2);
    expect(await upsertSubmissions(handle, [submission(20), submission(30)])).toBe(1);

    const stored = await getSubmissions(handle);
    const meta = await getMeta(handle);
    expect(stored.map((item) => item.submissionId).sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(meta?.lastSubmissionId).toBe(30);
    expect(meta?.coverage.retainedSubmissionCount).toBe(3);
    expect(meta?.submissionsFetchedAt).not.toBeNull();
  });
});
