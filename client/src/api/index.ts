/**
 * Typed fetch wrappers — all server API calls go through here.
 * Templates and composables import from this module; raw fetch is never used elsewhere.
 * TanStack Query keys are co-located with each function.
 *
 * §0.3: all data fetching in composables/adapters, never in .vue templates.
 * §0.4.1: browser never contains a CF API secret — only anonymous public CF endpoints.
 * §0.4.2: personal CF data never passes through Express.
 */
import type {
  MeResponse,
  LeaderboardResponse,
  PublicSettingsResponse,
  TeamResponse,
  PublicProfileResponse,
  AdminSettingsResponse,
} from '../../../shared/contracts/index.ts';

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

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
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
