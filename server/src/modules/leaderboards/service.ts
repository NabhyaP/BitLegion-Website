/**
 * Leaderboard service (§F leaderboard contract, §B3.1 disabled/preview logic).
 *
 * Responsibilities:
 *  - Check leaderboard_enabled setting; return disabled sentinel or previewOnly flag.
 *  - Delegate to repository for filtered/paginated data.
 *  - Compute ETag string from snapshotId + query hash.
 *  - Assemble the LeaderboardResponse shape (contracts/index.ts).
 *  - 60-second in-process cache for ratingChange30d computations (§F).
 */
import crypto from 'node:crypto';
import * as repo from './repository.ts';
import type { SortField, QueryLeaderboardOptions } from './repository.ts';
import * as settingsRepo from '../settings/repository.ts';
import { badRequest } from '../../shared/errors.ts';
import { buildRatingTrendSeries, summarizeComparison } from './statistics.ts';
import type {
  LeaderboardEntry,
  LeaderboardMeta,
  LeaderboardResponse,
  PersonalComparisonResponse,
  RatingTrendsResponse,
} from '../../../../shared/contracts/index.ts';

// ---------------------------------------------------------------------------
// In-process cache for the active snapshot meta (60 s, §F)
// ---------------------------------------------------------------------------
async function getVersionMeta(): Promise<{ versionId: number; completedAt: Date } | null> {
  return repo.getActiveVersionMeta();
}

// ---------------------------------------------------------------------------
// Public query
// ---------------------------------------------------------------------------

export type LeaderboardQuery = {
  sort: SortField;
  scope: 'all' | 'batch' | 'branch';
  batch?: number | null;
  branch?: string | null;
  q?: string | null;
  limit: number;
  cursor?: string | null;
  /** True when the caller is an admin (skips disabled check; adds previewOnly flag). */
  isAdmin?: boolean;
};

export async function getLeaderboard(
  query: LeaderboardQuery,
): Promise<LeaderboardResponse> {
  // 1. Read settings
  const [enabledRaw, refreshMinutesRaw] = await Promise.all([
    settingsRepo.getSetting('leaderboard_enabled'),
    settingsRepo.getSetting('leaderboard_refresh_minutes'),
  ]);
  const enabled = (enabledRaw ?? 'true') === 'true';
  const refreshMinutes = Number(refreshMinutesRaw ?? '60');

  // 2. Non-admin sees disabled sentinel
  if (!enabled && !query.isAdmin) {
    return { disabled: true };
  }

  // 3. Get active snapshot
  const meta = await getVersionMeta();
  if (!meta) {
    // No snapshot published yet — treat as disabled for public, empty for admin
    if (!query.isAdmin) return { disabled: true };
  }

  const versionId = meta?.versionId ?? 0;
  const generatedAt = meta?.completedAt ?? new Date(0);
  const nextRefreshAfter = new Date(generatedAt.getTime() + refreshMinutes * 60_000);

  // 4. Decode cursor
  const cursor = query.cursor ? repo.decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw badRequest('Invalid leaderboard cursor.');

  // 5. Query — scope gates which filters are active
  const opts: QueryLeaderboardOptions = {
    versionId,
    sort: query.sort,
    // scope=all ignores batch+branch; scope=batch ignores branch; scope=branch ignores batch
    batch: query.scope !== 'branch' ? (query.batch ?? null) : null,
    branch: query.scope !== 'batch' ? (query.branch ?? null) : null,
    q: query.q ?? null,
    limit: query.limit,
    cursor,
  };

  const rows = versionId ? await repo.queryLeaderboard(opts) : [];

  // 6. Detect next page (we fetched limit+1)
  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;

  // 7. Build next cursor from last row
  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1]!;
    nextCursor = repo.encodeCursor({
      rating: last.rating,
      maxRating: last.maxRating,
      solvedCount: last.solvedCount,
      handle: last.handle,
      offset: (cursor?.offset ?? 0) + pageRows.length,
    });
  }

  // 8. Assign rank (ROW_NUMBER over this page starting from 1 for page 1,
  //    or continuing from decoded cursor position for subsequent pages).
  //    Per spec: rank is recomputed for the requested sort/filter — use sequential page rank.
  const data: LeaderboardEntry[] = pageRows.map((r, i) => ({
    rank: (cursor?.offset ?? 0) + i + 1,
    userId: r.userId,
    displayName: r.displayName,
    handle: r.handle,
    batch: r.batch,
    branch: r.branch,
    rating: r.rating,
    maxRating: r.maxRating,
    codeforcesRank: r.codeforcesRank,
    ratingChange30d: r.ratingChange30d,
    solvedCount: r.solvedCount,
    avatarUrl: r.avatarUrl,
    profileUpdatedAt: r.profileUpdatedAt.toISOString(),
    stale: r.stale,
  }));

  // 9. Build meta
  const responseMeta: LeaderboardMeta = {
    snapshotId: versionId,
    generatedAt: generatedAt.toISOString(),
    nextRefreshAfter: nextRefreshAfter.toISOString(),
    scope: query.scope,
    limit: query.limit,
    nextCursor,
    ...(query.isAdmin && !enabled ? { previewOnly: true as const } : {}),
  };

  return { data, meta: responseMeta };
}

export async function getRatingTrends(days: number): Promise<RatingTrendsResponse> {
  const enabledRaw = await settingsRepo.getSetting('leaderboard_enabled');
  if ((enabledRaw ?? 'true') !== 'true') return { disabled: true };

  const meta = await getVersionMeta();
  if (!meta) return { disabled: true };

  const history = await repo.getRatingHistory(days);
  return {
    data: buildRatingTrendSeries(history),
    meta: { generatedAt: meta.completedAt.toISOString(), days },
  };
}

export async function getPersonalComparison(userId: number): Promise<PersonalComparisonResponse> {
  const enabledRaw = await settingsRepo.getSetting('leaderboard_enabled');
  if ((enabledRaw ?? 'true') !== 'true') {
    return { available: false, reason: 'LEADERBOARD_DISABLED' };
  }

  const [meta, population] = await Promise.all([
    getVersionMeta(),
    repo.getCurrentRatingPopulation(),
  ]);
  const personal = population.find((entry) => entry.userId === userId);
  if (!meta || !personal) return { available: false, reason: 'NOT_ON_LEADERBOARD' };
  if (personal.rating <= 0) return { available: false, reason: 'NOT_RATED' };

  const ratedPopulation = population.filter((entry) => entry.rating > 0);
  const overallRatings = ratedPopulation.map((entry) => entry.rating);
  const cohortRatings = personal.batchYear === null
    ? []
    : ratedPopulation
      .filter((entry) => entry.batchYear === personal.batchYear)
      .map((entry) => entry.rating);

  return {
    available: true,
    generatedAt: meta.completedAt.toISOString(),
    handle: personal.handle,
    rating: personal.rating,
    overall: summarizeComparison(overallRatings, personal.rating),
    cohort: personal.batchYear === null
      ? null
      : {
          batchYear: personal.batchYear,
          ...summarizeComparison(cohortRatings, personal.rating),
        },
  };
}

// ---------------------------------------------------------------------------
// ETag helpers
// ---------------------------------------------------------------------------

/**
 * Compute ETag string: "{snapshotId}:{queryHash}" per §F.
 * The queryHash is a short hash of all filter/sort parameters so different
 * filter combinations don't share cache entries.
 */
export function computeETag(snapshotId: number, query: LeaderboardQuery): string {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      sort: query.sort,
      scope: query.scope,
      batch: query.batch ?? null,
      branch: query.branch ?? null,
      q: query.q ?? null,
      limit: query.limit,
      cursor: query.cursor ?? null,
    }))
    .digest('hex')
    .slice(0, 12);
  return `"${snapshotId}:${hash}"`;
}
