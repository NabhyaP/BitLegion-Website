/**
 * Normalize raw CF API responses into stored shapes.
 * Pure functions — no side effects, no Vue, no fetch.
 * §C: "normalized fields: submissionId, createdAt, contestId, problemIndex,
 *      problemName, rating, tags, verdict, language"
 */
import type {
  CfRawUser,
  CfRawRatingChange,
  CfRawSubmission,
  CfProfile,
  CfRatingPoint,
  CfSubmission,
} from './types.ts';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Handle normalization
// ---------------------------------------------------------------------------

/** Codeforces handles are case-insensitive — normalize to lowercase for storage keys. */
export function normalizeHandle(handle: string): string {
  return handle.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function normalizeProfile(raw: CfRawUser): CfProfile {
  return {
    handle: normalizeHandle(raw.handle),
    rating: raw.rating ?? 0,
    maxRating: raw.maxRating ?? 0,
    rank: raw.rank ?? 'unrated',
    maxRank: raw.maxRank ?? 'unrated',
    avatarUrl: raw.titlePhoto ?? raw.avatar ?? '',
    lastOnlineAt: (raw.lastOnlineTimeSeconds ?? 0) * 1000,
    contribution: raw.contribution ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Rating history
// ---------------------------------------------------------------------------

export function normalizeRatingChanges(raw: CfRawRatingChange[]): CfRatingPoint[] {
  return raw.map((r) => ({
    contestId: r.contestId,
    contestName: r.contestName,
    timeSeconds: r.ratingUpdateTimeSeconds,
    oldRating: r.oldRating,
    newRating: r.newRating,
  }));
}

// ---------------------------------------------------------------------------
// Problem key (§C incremental fetch idempotency)
// ---------------------------------------------------------------------------

/**
 * Stable deduplication key for a submission's problem.
 * Standard CF contest: "contestId-index"  e.g. "1234-A"
 * Problemset / gym: "ps:{setName}:{name}" (fallback when contestId is absent)
 */
export function problemKey(raw: CfRawSubmission): string {
  const p = raw.problem;
  if (p.contestId != null) {
    return `${p.contestId}-${p.index}`;
  }
  const setName = p.problemsetName ?? 'unknown';
  return `ps:${setName}:${p.name}`;
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export function normalizeSubmission(raw: CfRawSubmission): CfSubmission {
  return {
    submissionId: raw.id,
    createdAt: raw.creationTimeSeconds * 1000,
    contestId: raw.problem.contestId ?? null,
    problemIndex: raw.problem.index,
    problemName: raw.problem.name,
    rating: raw.problem.rating ?? null,
    tags: raw.problem.tags ?? [],
    verdict: raw.verdict ?? 'UNKNOWN',
    language: raw.programmingLanguage,
    problemKey: problemKey(raw),
  };
}

export function normalizeSubmissions(raw: CfRawSubmission[]): CfSubmission[] {
  return raw.map(normalizeSubmission);
}
