/**
 * All Codeforces browser subsystem types (§C).
 * No Vue imports — this module is pure TS, importable from workers.
 */

// ---------------------------------------------------------------------------
// Raw CF API shapes (public endpoints only — §C1)
// ---------------------------------------------------------------------------

export type CfApiEnvelope<T> =
  | { status: 'OK'; result: T }
  | { status: 'FAILED'; comment: string };

export type CfRawUser = {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  avatar?: string;
  titlePhoto?: string;
  lastOnlineTimeSeconds?: number;
  contribution?: number;
};

export type CfRawRatingChange = {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
};

export type CfRawSubmission = {
  id: number;
  creationTimeSeconds: number;
  problem: {
    contestId?: number;
    problemsetName?: string;
    index: string;
    name: string;
    rating?: number;
    tags: string[];
  };
  verdict?: string;
  programmingLanguage: string;
};

export type CfRawContest = {
  id: number;
  name: string;
  type: string;
  phase: string;
  durationSeconds: number;
  startTimeSeconds?: number;
  relativeTimeSeconds?: number;
};

// ---------------------------------------------------------------------------
// Normalized shapes stored in IndexedDB
// ---------------------------------------------------------------------------

export type CfProfile = {
  handle: string;         // normalized lowercase
  rating: number;
  maxRating: number;
  rank: string;
  maxRank: string;
  avatarUrl: string;
  lastOnlineAt: number;   // epoch ms
  contribution: number;
};

export type CfRatingPoint = {
  contestId: number;
  contestName: string;
  timeSeconds: number;    // epoch s
  oldRating: number;
  newRating: number;
};

export type CfContest = {
  id: number;
  name: string;
  type: string;
  startsAt: number;
  durationSeconds: number;
};

/** Normalized submission — stored per handle. */
export type CfSubmission = {
  submissionId: number;
  createdAt: number;      // epoch ms
  contestId: number | null;
  problemIndex: string;
  problemName: string;
  rating: number | null;
  tags: string[];
  verdict: string;
  language: string;
  /** Deduplication key: "contestId-index" or "ps:{setName}:{name}" (§C incremental fetch). */
  problemKey: string;
};

// ---------------------------------------------------------------------------
// Per-handle cache metadata
// ---------------------------------------------------------------------------

export type CfCacheMeta = {
  handle: string;                   // normalized lowercase
  schemaVersion: number;            // bump to invalidate old cache
  profileFetchedAt: number | null;  // epoch ms
  ratingsFetchedAt: number | null;
  submissionsFetchedAt: number | null;
  lastSubmissionId: number;
  coverage: {
    complete: boolean;
    retainedSubmissionCount: number;
  };
};

// ---------------------------------------------------------------------------
// Fetch state — passed to UI components
// ---------------------------------------------------------------------------

export type FetchStatus =
  | 'idle'
  | 'loading'
  | 'revalidating'   // serving cached data, background refresh in progress
  | 'success'
  | 'partial'
  | 'rate-limited'
  | 'cf-unavailable'
  | 'error';

export type CfHandleState = {
  handle: string;
  status: FetchStatus;
  /** Epoch ms of last successful fetch, or null. */
  lastSuccessAt: number | null;
  /** Whether cached data is stale (>30 min since last successful fetch). */
  stale: boolean;
  errorMessage: string | null;
};

// ---------------------------------------------------------------------------
// Worker message protocol
// ---------------------------------------------------------------------------

export type WorkerRequest = {
  type: 'compute';
  requestId: number;
  submissions: CfSubmission[];
};

export type WorkerResponse = {
  type: 'result';
  requestId: number;
  result: AnalyticsResult;
} | {
  type: 'error';
  requestId: number;
  message: string;
};

// ---------------------------------------------------------------------------
// Analytics result
// ---------------------------------------------------------------------------

export type DifficultyBucket = {
  rating: number | null;   // null = unrated
  count: number;
};

export type TagCount = {
  tag: string;
  count: number;
};

/** One day in the practice calendar. */
export type CalendarDay = {
  date: string;    // YYYY-MM-DD
  count: number;
};

export type AnalyticsResult = {
  uniqueAccepted: number;
  attemptedUnsolved: number;
  totalSubmissions: number;
  difficultyDistribution: DifficultyBucket[];
  /** Top 10 tags + "other" bucket. */
  topTags: TagCount[];
  practiceCalendar: CalendarDay[];
  languageUsage: { language: string; count: number }[];
};
