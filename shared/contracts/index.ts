// Shared request/response types (§0.5). Populated from Phase 1 onward.

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
