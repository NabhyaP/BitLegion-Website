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
  // solved-state summary (spec §F "/me" contract)
  solvedCount: number | null;
  lastSyncedAt: string | null; // ISO-8601 UTC, null if Job 2 hasn't run yet
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
// Public profile (Phase 4)
// ---------------------------------------------------------------------------

export type PublicProfileResponse = {
  userId: number;
  displayName: string;
  handle: string;
  batch: number | null;
  branch: string | null;
  rating: number;
  maxRating: number;
  codeforcesRank: string | null;
  solvedCount: number | null;
  avatarUrl: string | null;
  profileUpdatedAt: string; // ISO-8601
  stale: boolean;
};

// ---------------------------------------------------------------------------
// Settings — admin shape (Phase 4)
// ---------------------------------------------------------------------------

export type AdminSettingsResponse = {
  announcement: string;
  leaderboardEnabled: boolean;
  leaderboardRefreshMinutes: number;
};

// ---------------------------------------------------------------------------
// Teams (Phase 4)
// ---------------------------------------------------------------------------

export type TeamMemberResponse = {
  id: number;
  teamId: number;
  userId: number | null;
  name: string;
  roleTitle: string;
  cfHandle: string | null;
  photoUrl: string | null;
  displayOrder: number;
};

export type TeamResponse = {
  id: number;
  name: string;
  displayOrder: number;
  members: TeamMemberResponse[];
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

// ---------------------------------------------------------------------------
// Admin contracts (Phase 7)
// ---------------------------------------------------------------------------

export type AdminMemberResponse = {
  id: number;
  collegeEmail: string;
  displayName: string;
  rollNo: string | null;
  batchYear: number | null;
  branch: string | null;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'ALUMNI';
  showInLeaderboard: boolean;
  avatarUrl: string | null;
  profileConfirmed: boolean;
  cfHandle: string | null;
  cfStatus: string | null;
  roles: string[];
};

export type AdminMembersPageResponse = {
  data: AdminMemberResponse[];
  meta: { total: number; page: number; pageSize: number; pages: number };
};

export type CsvImportResult = {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; email: string; reason: string }>;
};

export type HandleIssueResponse = {
  userId: number;
  displayName: string;
  handle: string;
  cfStatus: string;
  lastCheckedAt: string | null;
};

export type AuditEventResponse = {
  id: number;
  actorUserId: number;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  requestId: string | null;
  createdAt: string;
};

export type AuditEventsPageResponse = {
  data: AuditEventResponse[];
  meta: { total: number; page: number; pageSize: number; pages: number };
};

export type AdminStatsResponse = {
  totalUsers: number;
  activeUsers: number;
  linkedUsers: number;
  pendingUsers: number;
  suspendedUsers: number;
  signupsLast7d: Array<{ date: string; count: number }>;
};
