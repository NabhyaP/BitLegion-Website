import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRatingTrendSeries, median, summarizeComparison } from './statistics.ts';

test('median handles odd, even, and empty inputs without mutating them', () => {
  const values = [1500, 1100, 1300, 1700];
  assert.equal(median(values), 1400);
  assert.deepEqual(values, [1500, 1100, 1300, 1700]);
  assert.equal(median([1200, 900, 1000]), 1000);
  assert.equal(median([]), 0);
});

test('summarizeComparison calculates tied rank and cohort statistics', () => {
  assert.deepEqual(summarizeComparison([900, 1200, 1200, 1500], 1200), {
    rank: 2,
    total: 4,
    percentile: 67,
    average: 1200,
    median: 1200,
    differenceFromAverage: 0,
  });
});

test('buildRatingTrendSeries includes overall and year cohorts in date order', () => {
  const result = buildRatingTrendSeries([
    { date: '2026-08-02', batchYear: 2025, rating: 1400 },
    { date: '2026-08-01', batchYear: 2025, rating: 1000 },
    { date: '2026-08-01', batchYear: 2024, rating: 1200 },
  ]);

  assert.equal(result[0]?.label, 'Overall');
  assert.deepEqual(result[0]?.points, [
    { date: '2026-08-01', average: 1100, median: 1100, memberCount: 2 },
    { date: '2026-08-02', average: 1400, median: 1400, memberCount: 1 },
  ]);
  assert.deepEqual(result.map((series) => series.batchYear), [null, 2025, 2024]);
});
