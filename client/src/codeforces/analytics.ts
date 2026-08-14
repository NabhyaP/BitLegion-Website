/**
 * Pure analytics computations (§C — "pure analytics.ts; worker when >500 subs").
 * No Vue, no fetch, no side effects — runs identically in main thread and Web Worker.
 */
import type {
  CfSubmission,
  AnalyticsResult,
  DifficultyBucket,
  TagCount,
  CalendarDay,
} from './types.ts';

const TOP_TAGS = 10;
const ACCEPTED = 'OK';

export function computeAnalytics(submissions: CfSubmission[]): AnalyticsResult {
  const acceptedKeys = new Set<string>();
  const allKeys = new Set<string>();
  const tagCounts = new Map<string, number>();
  const diffMap = new Map<number | null, number>();
  const langCounts = new Map<string, number>();
  const dayMap = new Map<string, number>();

  for (const s of submissions) {
    const accepted = s.verdict === ACCEPTED;

    if (accepted) acceptedKeys.add(s.problemKey);
    allKeys.add(s.problemKey);

    // Language usage (all submissions)
    langCounts.set(s.language, (langCounts.get(s.language) ?? 0) + 1);

    if (!accepted) continue;

    // Tags (accepted only to avoid inflating failed attempts)
    for (const tag of s.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    // Difficulty distribution (accepted only)
    const bucket = s.rating ?? null;
    diffMap.set(bucket, (diffMap.get(bucket) ?? 0) + 1);

    // Practice calendar — UTC date of the submission
    const date = new Date(s.createdAt).toISOString().slice(0, 10);
    dayMap.set(date, (dayMap.get(date) ?? 0) + 1);
  }

  // Attempted but never solved
  const attemptedUnsolved = [...allKeys].filter((k) => !acceptedKeys.has(k)).length;

  // Top tags + "other"
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topTags: TagCount[] = sortedTags.slice(0, TOP_TAGS).map(([tag, count]) => ({ tag, count }));
  const otherCount = sortedTags.slice(TOP_TAGS).reduce((s, [, c]) => s + c, 0);
  if (otherCount > 0) topTags.push({ tag: 'other', count: otherCount });

  // Difficulty distribution — sorted by rating (null last)
  const difficultyDistribution: DifficultyBucket[] = [...diffMap.entries()]
    .sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return a[0] - b[0];
    })
    .map(([rating, count]) => ({ rating, count }));

  // Practice calendar — sorted by date ascending
  const practiceCalendar: CalendarDay[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Language usage — sorted descending
  const languageUsage = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => ({ language, count }));

  return {
    uniqueAccepted: acceptedKeys.size,
    attemptedUnsolved,
    totalSubmissions: submissions.length,
    difficultyDistribution,
    topTags,
    practiceCalendar,
    languageUsage,
  };
}
