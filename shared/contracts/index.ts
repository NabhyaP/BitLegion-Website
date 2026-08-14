// Shared request/response types (§0.5). Populated from Phase 1 onward.
// Phase 3 adds leaderboard and settings types (Phase 4 endpoints will use these).

export type HealthResponse = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  activeLeaderboardGeneratedAt: string | null;
  version: string;
};

// ---------------------------------------------------------------------------
// Codeforces link (Phase 2)
// ---------------------------------------------------------------------------

export type CfLinkStatus =
  | 'ACTIVE'
  | 'NOT_FOUND'
  | 'RENAMED_OR_MISMATCHED'
  | 'TEMPORARY_ERROR'
  | 'UNLINKED';

/** Shape of the `codeforces` field inside GET /me. null means no active link. */
export type CfLinkInfo = {
  handle: string;
  status: CfLinkStatus;
  verifiedAt: string; // ISO-8601 UTC
} | null;

// ---------------------------------------------------------------------------
// /me (Phase 1 + 2)
// ---------------------------------------------------------------------------

export type MeResponse = {
  id: number;
  displayName: string;
  collegeEmail: string;
  rollNo: string | null;
  batchYear: number | null;
  branch: string | null;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'ALUMNI';
  showInLeaderboard: boolean;
  avatarUrl: string | null;
  profileConfirmed: boolean;
  roles: string[];
  codeforces: CfLinkInfo;
};

// ---------------------------------------------------------------------------
// Leaderboard (Phase 3 / Phase 4)
// ---------------------------------------------------------------------------

/** One row returned by GET /api/v1/leaderboards/codeforces */
export type LeaderboardEntry = {
  rank: number;
  userId: number;
  displayName: string;
  handle: string;
  batch: number | null;
  branch: string | null;
  rating: number;
  maxRating: number;
  codeforcesRank: string | null;
  ratingChange30d: number | null;
  solvedCount: number | null;  // null renders "—" (syncing)
  avatarUrl: string | null;
  profileUpdatedAt: string;    // ISO-8601
  stale: boolean;
};

export type LeaderboardMeta = {
  snapshotId: number;
  generatedAt: string;         // ISO-8601
  nextRefreshAfter: string;    // ISO-8601
  scope: 'all' | 'batch' | 'branch';
  limit: number;
  nextCursor: string | null;
  disabled?: true;
  previewOnly?: true;
};

export type LeaderboardResponse = {
  data: LeaderboardEntry[];
  meta: LeaderboardMeta;
} | { disabled: true };

// ---------------------------------------------------------------------------
// Public settings (Phase 3 / Phase 4)
// ---------------------------------------------------------------------------

export type PublicSettingsResponse = {
  announcement: string;        // empty string = no banner
  leaderboardEnabled: boolean;
};

// ---------------------------------------------------------------------------
// Job status (Phase 3 / Phase 7 admin panel)
// ---------------------------------------------------------------------------

export type JobStatus = 'RUNNING' | 'OK' | 'FAILED';

export type JobRunSummary = {
  id: number;
  jobCode: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  detail: Record<string, unknown> | null;
};
