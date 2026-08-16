/**
 * Typed fetch wrappers — all server API calls go through here.
 * Templates and composables import from this module; raw fetch is never used elsewhere.
 * TanStack Query keys are co-located with each function.
 *
 * §0.3: all data fetching in composables/adapters, never in .vue templates.
 * §0.4.1: browser never contains a CF API secret — only anonymous public CF endpoints.
 * §0.4.2: personal CF data never passes through Express.
 * §G: CSRF double-submit — token fetched once and injected into every mutating request.
 */
import type {
  MeResponse,
  LeaderboardResponse,
  PublicSettingsResponse,
  TeamResponse,
  PublicProfileResponse,
  AdminSettingsResponse,
} from '@contracts';

// ---------------------------------------------------------------------------
// CSRF token — fetched once at app init, reused for the session lifetime
// ---------------------------------------------------------------------------

let _csrfToken: string | null = null;
let _csrfFetch: Promise<string> | null = null;

async function getCsrfToken(): Promise<string> {
  if (_csrfToken) return _csrfToken;
  // Deduplicate concurrent calls to the token endpoint
  if (!_csrfFetch) {
    _csrfFetch = fetch('/api/v1/auth/csrf-token', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => { _csrfToken = b.csrfToken as string; _csrfFetch = null; return _csrfToken!; })
      .catch(() => { _csrfFetch = null; return ''; });
  }
  return _csrfFetch;
}

/** Called by App.vue on mount to pre-warm the token before the first mutation. */
export function prefetchCsrfToken(): void {
  void getCsrfToken();
}

/** Invalidate stored CSRF token (e.g. after logout — session changes). */
export function invalidateCsrfToken(): void {
  _csrfToken = null;
  _csrfFetch = null;
}

// ---------------------------------------------------------------------------
// Base fetch — throws on non-2xx, attaches requestId to errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  };

  // Inject CSRF token on every mutating request (§G double-submit)
  if (!SAFE_METHODS.has(method)) {
    const token = await getCsrfToken();
    if (token) headers['x-csrf-token'] = token;
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  // If the server rejects the CSRF token (403 EBADCSRFTOKEN), clear our cached
  // token so the next request fetches a fresh one.
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const code = body?.error?.code ?? '';
    if (code === 'INVALID_CSRF_TOKEN' || code === 'EBADCSRFTOKEN') {
      _csrfToken = null;
      throw new ApiError(403, code, 'Session expired. Please refresh the page.');
    }
    const err = body?.error ?? {};
    throw new ApiError(403, err.code ?? 'FORBIDDEN', err.message ?? res.statusText, err.fields);
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.message ?? res.statusText, err.fields);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Query keys (stable references for TanStack Query cache invalidation)
// ---------------------------------------------------------------------------

export const queryKeys = {
  me: ['me'] as const,
  settings: ['settings', 'public'] as const,
  leaderboard: (params: Record<string, unknown>) => ['leaderboard', params] as const,
  teams: ['teams'] as const,
  profile: (handle: string) => ['profile', handle.toLowerCase()] as const,
  adminSettings: ['admin', 'settings'] as const,
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  await apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Codeforces link
// ---------------------------------------------------------------------------

/** Unlink CF handle. Requires recent auth (<30 min since login). */
export async function unlinkCf(): Promise<void> {
  await apiFetch<void>('/api/v1/codeforces/link', { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// /me
// ---------------------------------------------------------------------------

export async function fetchMe(): Promise<MeResponse> {
  const body = await apiFetch<{ data: MeResponse }>('/api/v1/me');
  return body.data;
}

export async function patchMe(patch: Partial<{
  displayName: string;
  rollNo: string;
  batchYear: number;
  branch: string;
  confirmProfile: boolean;
}>): Promise<MeResponse> {
  const body = await apiFetch<{ data: MeResponse }>('/api/v1/me', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body.data;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function fetchPublicSettings(): Promise<PublicSettingsResponse> {
  const body = await apiFetch<{ data: PublicSettingsResponse }>('/api/v1/settings/public');
  return body.data;
}

export async function fetchAdminSettings(): Promise<AdminSettingsResponse> {
  const body = await apiFetch<{ data: AdminSettingsResponse }>('/api/v1/admin/settings');
  return body.data;
}

export async function patchAdminSettings(
  patch: Partial<{ announcement: string; leaderboardEnabled: boolean; leaderboardRefreshMinutes: number }>,
): Promise<AdminSettingsResponse> {
  const body = await apiFetch<{ data: AdminSettingsResponse }>('/api/v1/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body.data;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export type LeaderboardParams = {
  sort?: 'rating' | 'maxRating' | 'solvedCount';
  scope?: 'all' | 'batch' | 'branch';
  batch?: number;
  branch?: string;
  q?: string;
  limit?: number;
  cursor?: string;
};

export async function fetchLeaderboard(params: LeaderboardParams = {}): Promise<LeaderboardResponse> {
  const qs = new URLSearchParams();
  if (params.sort) qs.set('sort', params.sort);
  if (params.scope) qs.set('scope', params.scope);
  if (params.batch) qs.set('batch', String(params.batch));
  if (params.branch) qs.set('branch', params.branch);
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const body = await apiFetch<LeaderboardResponse>(
    `/api/v1/leaderboards/codeforces?${qs.toString()}`,
  );
  return body;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function fetchTeams(): Promise<TeamResponse[]> {
  const body = await apiFetch<{ data: TeamResponse[] }>('/api/v1/teams');
  return body.data;
}

// ---------------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------------

export async function fetchProfile(handle: string): Promise<PublicProfileResponse> {
  const body = await apiFetch<{ data: PublicProfileResponse }>(
    `/api/v1/profiles/${encodeURIComponent(handle.toLowerCase())}`,
  );
  return body.data;
}

// ---------------------------------------------------------------------------
// Admin — import new types
// ---------------------------------------------------------------------------
// (Re-export the apiFetch helper so admin composables can use it if needed)

import type {
  AdminMembersPageResponse,
  AdminMemberResponse,
  CsvImportResult,
  HandleIssueResponse,
  AuditEventsPageResponse,
  AdminStatsResponse,
  JobRunSummary,
} from '@contracts';

export type { AdminMembersPageResponse, AdminMemberResponse, CsvImportResult, HandleIssueResponse, AuditEventsPageResponse, AdminStatsResponse };

// ---------------------------------------------------------------------------
// Admin members
// ---------------------------------------------------------------------------

export type AdminMembersParams = {
  year?: number;
  branch?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export async function fetchAdminMembers(params: AdminMembersParams = {}): Promise<AdminMembersPageResponse> {
  const qs = new URLSearchParams();
  if (params.year) qs.set('year', String(params.year));
  if (params.branch) qs.set('branch', params.branch);
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  return apiFetch<AdminMembersPageResponse>(`/api/v1/admin/members?${qs.toString()}`);
}

export async function fetchAdminMember(userId: number): Promise<{ data: AdminMemberResponse }> {
  return apiFetch<{ data: AdminMemberResponse }>(`/api/v1/admin/members/${userId}`);
}

export async function createAdminMember(body: {
  collegeEmail: string; displayName: string; rollNo?: string | null;
  batchYear?: number | null; branch?: string | null;
}): Promise<{ data: AdminMemberResponse }> {
  return apiFetch<{ data: AdminMemberResponse }>('/api/v1/admin/members', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function updateAdminMember(userId: number, patch: Record<string, unknown>): Promise<{ data: AdminMemberResponse }> {
  return apiFetch<{ data: AdminMemberResponse }>(`/api/v1/admin/members/${userId}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}

export async function clearAdminCfLink(userId: number): Promise<void> {
  await apiFetch<void>(`/api/v1/admin/members/${userId}/codeforces-link`, { method: 'DELETE' });
}

export async function patchAdminRoles(userId: number, body: { grant: string[]; revoke: string[] }): Promise<{ data: { roles: string[] } }> {
  return apiFetch<{ data: { roles: string[] } }>(`/api/v1/admin/members/${userId}/roles`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

export async function importMembersCSV(rows: unknown[]): Promise<{ data: CsvImportResult }> {
  return apiFetch<{ data: CsvImportResult }>('/api/v1/admin/members/import', {
    method: 'POST', body: JSON.stringify({ rows }),
  });
}

// ---------------------------------------------------------------------------
// Admin jobs
// ---------------------------------------------------------------------------

export async function fetchLeaderboardJobStatus(): Promise<{ data: { runs: JobRunSummary[] } }> {
  return apiFetch(`/api/v1/admin/jobs/leaderboard`);
}

export async function retryLeaderboardJob(): Promise<{ data: { message: string } }> {
  return apiFetch(`/api/v1/admin/jobs/leaderboard/retry`, { method: 'POST' });
}

export async function fetchSolvedSyncJobStatus(): Promise<{ data: { runs: JobRunSummary[] } }> {
  return apiFetch(`/api/v1/admin/jobs/solved-sync`);
}

export async function forceResyncUser(userId: number): Promise<{ data: { message: string } }> {
  return apiFetch(`/api/v1/admin/jobs/solved-sync/user/${userId}`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Admin handle issues
// ---------------------------------------------------------------------------

export async function fetchHandleIssues(): Promise<{ data: HandleIssueResponse[] }> {
  return apiFetch(`/api/v1/admin/handle-issues`);
}

export async function recheckHandle(userId: number): Promise<{ data: { message: string } }> {
  return apiFetch(`/api/v1/admin/handle-issues/${userId}/recheck`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Admin audit
// ---------------------------------------------------------------------------

export type AuditParams = { actor?: number; action?: string; page?: number; pageSize?: number };

export async function fetchAuditEvents(params: AuditParams = {}): Promise<AuditEventsPageResponse> {
  const qs = new URLSearchParams();
  if (params.actor) qs.set('actor', String(params.actor));
  if (params.action) qs.set('action', params.action);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  return apiFetch<AuditEventsPageResponse>(`/api/v1/admin/audit-events?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Admin stats
// ---------------------------------------------------------------------------

export async function fetchAdminStats(): Promise<{ data: AdminStatsResponse }> {
  return apiFetch(`/api/v1/admin/stats`);
}

// Extend queryKeys for admin
export const adminQueryKeys = {
  members: (params: AdminMembersParams) => ['admin', 'members', params] as const,
  member: (id: number) => ['admin', 'member', id] as const,
  lbJob: ['admin', 'jobs', 'lb'] as const,
  solvedJob: ['admin', 'jobs', 'solved'] as const,
  handleIssues: ['admin', 'handle-issues'] as const,
  audit: (params: AuditParams) => ['admin', 'audit', params] as const,
  stats: ['admin', 'stats'] as const,
};
