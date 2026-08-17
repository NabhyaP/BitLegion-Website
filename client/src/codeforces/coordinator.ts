/**
 * CF data coordinator (§C — incremental fetch, failure matrix, analytics dispatch).
 *
 * This is the single entry point that Vue composables call.
 * Implements the full §C4 failure matrix:
 *   CF unavailable     → serve cached + stale timestamp
 *   Rate limit         → stop queue, keep cache, manual retry later
 *   First visit no cache → compact error, rest of site usable
 *   One method fails   → keep successful widgets, mark failed ones
 *   Handle changed     → clear old cache first
 *   Storage unavailable → memory-only + notice
 *
 * Incremental submissions: first visit pages up to 2,000-cap; later visits
 * fetch newest page and stop when overlap with lastSubmissionId is found.
 *
 * No Vue imports.
 */
import { ref, readonly } from 'vue';
import * as cfClient from './client.ts';
import * as cache from './cache.ts';
import { computeAnalytics } from './analytics.ts';
import { tryBecomeLeader, releaseLeader, CfRateLimitError, CfUnavailableError, setRateLimited } from './queue.ts';
import type { CfProfile, CfRatingPoint, CfSubmission, AnalyticsResult, FetchStatus } from './types.ts';

const INCREMENTAL_MAX_PAGES = 4; // 4 × 500 = 2,000 cap
const PAGE_SIZE = 500;
const WORKER_THRESHOLD = 500; // use Web Worker above this count

// ---------------------------------------------------------------------------
// Per-handle reactive state (Vue refs — this file IS allowed Vue imports
// because it is the bridge layer, not a pure compute module)
// ---------------------------------------------------------------------------

export type HandleData = {
  profile: CfProfile | null;
  ratings: CfRatingPoint[];
  submissions: CfSubmission[];
  analytics: AnalyticsResult | null;
  status: FetchStatus;
  lastSuccessAt: number | null;
  stale: boolean;
  storageUnavailable: boolean;
  errorMessage: string | null;
};

const _handles = new Map<string, ReturnType<typeof createHandleRefs>>();

function createHandleRefs(handle: string) {
  const profile = ref<CfProfile | null>(null);
  const ratings = ref<CfRatingPoint[]>([]);
  const submissions = ref<CfSubmission[]>([]);
  const analytics = ref<AnalyticsResult | null>(null);
  const status = ref<FetchStatus>('idle');
  const lastSuccessAt = ref<number | null>(null);
  const stale = ref(false);
  const errorMessage = ref<string | null>(null);
  const storageUnavailable = ref(false);
  return { handle, profile, ratings, submissions, analytics, status, lastSuccessAt, stale, errorMessage, storageUnavailable };
}

export function getHandleRefs(handle: string) {
  const norm = handle.toLowerCase();
  if (!_handles.has(norm)) _handles.set(norm, createHandleRefs(norm));
  return _handles.get(norm)!;
}

// ---------------------------------------------------------------------------
// Worker setup (lazy)
// ---------------------------------------------------------------------------

let _worker: Worker | null = null;
let _workerRequestId = 0;

function getWorker(): Worker {
  if (!_worker) {
    // Vite resolves the worker URL at build time
    _worker = new Worker(
      new URL('./analytics.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return _worker;
}

function computeInWorker(subs: CfSubmission[]): Promise<AnalyticsResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const requestId = ++_workerRequestId;
    const handler = (e: MessageEvent) => {
      if (e.data.requestId !== requestId) return;
      w.removeEventListener('message', handler);
      if (e.data.type === 'result') resolve(e.data.result);
      else reject(new Error(e.data.message));
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'compute', requestId, submissions: subs });
  });
}

async function runAnalytics(subs: CfSubmission[]): Promise<AnalyticsResult> {
  if (subs.length > WORKER_THRESHOLD) {
    return computeInWorker(subs);
  }
  return computeAnalytics(subs);
}

// ---------------------------------------------------------------------------
// Main refresh entry point
// ---------------------------------------------------------------------------

const _refreshing = new Set<string>();

/**
 * Refresh data for a handle. Safe to call concurrently — deduplicated per handle.
 * Returns immediately if another refresh for the same handle is in progress.
 */
export async function refresh(rawHandle: string, options: { force?: boolean } = {}): Promise<void> {
  const handle = rawHandle.toLowerCase();
  if (_refreshing.has(handle)) return;

  const refs = getHandleRefs(handle);
  refs.storageUnavailable.value = cache.isStorageUnavailable();

  // Always load cached data first — so the UI shows something immediately
  // regardless of whether we win the leader lock.
  const [cachedProfile, cachedRatings, cachedSubs, meta] = await Promise.all([
    cache.getProfile(handle),
    cache.getRatings(handle),
    cache.getSubmissions(handle),
    cache.getMeta(handle),
  ]);

  if (cachedProfile) refs.profile.value = cachedProfile;
  if (cachedRatings) refs.ratings.value = cachedRatings;
  if (cachedSubs.length) refs.submissions.value = cachedSubs;

  const hadCache = !!cachedProfile;
  refs.stale.value = hadCache && !cache.isFresh(meta?.profileFetchedAt ?? null);
  refs.lastSuccessAt.value = meta?.profileFetchedAt ?? null;
  const profileFresh = !options.force && cache.isFresh(meta?.profileFetchedAt ?? null);
  const ratingsFresh = !options.force && cache.isFresh(meta?.ratingsFetchedAt ?? null);
  const submissionsFresh = !options.force && cache.isFresh(meta?.submissionsFetchedAt ?? null);

  // If cached data is fresh, compute analytics and return without hitting the network.
  if (profileFresh && ratingsFresh && submissionsFresh) {
    if (cachedSubs.length > 0) {
      refs.analytics.value = await runAnalytics(cachedSubs);
    }
    refs.status.value = 'success';
    return;
    // Still need submissions — fall through to network fetch
  }

  // Try cross-tab leader lock. tryBecomeLeader() has a built-in 4-second
  // blocking fallback so stale locks from dead tabs don't block forever.
  if (_refreshing.has(handle)) return;
  _refreshing.add(handle);
  let isLeader: boolean;
  try {
    isLeader = await tryBecomeLeader();
  } catch (error) {
    _refreshing.delete(handle);
    throw error;
  }

  if (!isLeader) {
    // Another tab is refreshing — show cached data with revalidating indicator
    refs.status.value = hadCache ? 'revalidating' : 'loading';
    // Retry once after a delay in case the other tab finishes
    setTimeout(() => {
      if (refs.status.value === 'revalidating') refresh(rawHandle, options);
    }, 5_000);
    _refreshing.delete(handle);
    return;
  }

  try {
    // Cache was already loaded above (before the lock). Use those values.
    refs.status.value = hadCache ? (profileFresh ? 'success' : 'revalidating') : 'loading';

    // Skip network if everything is fresh and we have submissions
    if (profileFresh && ratingsFresh && submissionsFresh) {
      refs.analytics.value = await runAnalytics(cachedSubs);
      refs.status.value = 'success';
      return;
    }

    // Fetch profile + ratings in parallel, submissions separately (incremental)
    let profileOk = profileFresh;
    let ratingsOk = ratingsFresh;

    const [profileResult, ratingsResult] = await Promise.allSettled([
      profileFresh ? Promise.resolve(cachedProfile!) : cfClient.fetchProfile(handle),
      ratingsFresh ? Promise.resolve(cachedRatings ?? []) : cfClient.fetchRatingHistory(handle),
    ]);

    if (profileResult.status === 'fulfilled') {
      refs.profile.value = profileResult.value;
      if (!profileFresh) await cache.setProfile(handle, profileResult.value);
      profileOk = true;
    } else {
      handleFetchError(profileResult.reason, refs);
    }

    if (ratingsResult.status === 'fulfilled') {
      refs.ratings.value = ratingsResult.value;
      if (!ratingsFresh) await cache.setRatings(handle, ratingsResult.value);
      ratingsOk = true;
    } else {
      handleFetchError(ratingsResult.reason, refs);
    }

    // Incremental submissions fetch
    const subsOk = submissionsFresh
      ? true
      : await fetchSubmissionsIncremental(handle, meta?.lastSubmissionId ?? 0, refs);

    // Compute analytics from whatever we have
    const allSubs = await cache.getSubmissions(handle);
    if (allSubs.length > 0) {
      refs.submissions.value = allSubs;
      refs.analytics.value = await runAnalytics(allSubs);
    }

    // Set final status
    const failureStatus = currentFetchStatus(refs);
    if (profileOk && ratingsOk && subsOk) {
      refs.status.value = 'success';
      refs.lastSuccessAt.value = Date.now();
      refs.stale.value = false;
      refs.errorMessage.value = null;
    } else if (refs.profile.value) {
      if (failureStatus !== 'rate-limited') refs.status.value = 'partial';
      refs.stale.value = true;
    } else if (!hadCache && failureStatus !== 'rate-limited' && failureStatus !== 'cf-unavailable') {
      refs.status.value = 'error';
    }
  } catch (err) {
    handleFetchError(err, refs);
  } finally {
    _refreshing.delete(handle);
    releaseLeader();
  }
}

function currentFetchStatus(refs: ReturnType<typeof createHandleRefs>): FetchStatus {
  return refs.status.value;
}

// ---------------------------------------------------------------------------
// Incremental submissions fetch (§C incremental fetch algorithm)
// ---------------------------------------------------------------------------

async function fetchSubmissionsIncremental(
  handle: string,
  lastId: number,
  refs: ReturnType<typeof createHandleRefs>,
): Promise<boolean> {
  let from = 1;
  let pagesFetched = 0;
  let requestSucceeded = false;

  while (pagesFetched < INCREMENTAL_MAX_PAGES) {
    let page: CfSubmission[];
    try {
      page = await cfClient.fetchSubmissionsPage(handle, from, PAGE_SIZE);
      requestSucceeded = true;
    } catch (err) {
      handleFetchError(err, refs);
      return false;
    }

    if (page.length === 0) {
      await cache.upsertSubmissions(handle, []);
      break;
    }

    // Stop condition: a submission on this page has id ≤ lastId — we've reached overlap
    const overlap = page.some((s) => s.submissionId <= lastId);
    const newSubs = lastId === 0 ? page : page.filter((s) => s.submissionId > lastId);

    await cache.upsertSubmissions(handle, newSubs);

    if (overlap || page.length < PAGE_SIZE) break; // last page or caught up

    from += PAGE_SIZE;
    pagesFetched++;
  }

  return requestSucceeded;
}

// ---------------------------------------------------------------------------
// Error handling per §C4 failure matrix
// ---------------------------------------------------------------------------

function handleFetchError(
  err: unknown,
  refs: ReturnType<typeof createHandleRefs>,
): void {
  if (err instanceof CfRateLimitError) {
    setRateLimited(Date.now() + err.retryAfterMs);
    refs.status.value = 'rate-limited';
    refs.errorMessage.value = 'Codeforces rate limit reached. Please try again later.';
  } else if (err instanceof CfUnavailableError) {
    // Keep cached data (already loaded above); just mark stale
    if (refs.profile.value) {
      refs.status.value = 'success'; // has cache — usable
      refs.stale.value = true;
    } else {
      refs.status.value = 'cf-unavailable';
    }
    refs.errorMessage.value = 'Codeforces is currently unavailable. Showing cached data.';
  } else {
    refs.status.value = 'error';
    refs.errorMessage.value = err instanceof Error ? err.message : 'Unknown error.';
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Call when the user changes their CF handle — clears old cache before refresh. */
export async function switchHandle(oldHandle: string | null, newHandle: string): Promise<void> {
  if (oldHandle) {
    const norm = oldHandle.toLowerCase();
    await cache.clearHandle(norm);
    _handles.delete(norm);
  }
  await refresh(newHandle);
}

/** "Clear local Codeforces data" action (§B4 settings page). */
export async function clearLocalData(handle: string): Promise<void> {
  const norm = handle.toLowerCase();
  await cache.clearHandle(norm);
  const refs = getHandleRefs(norm);
  refs.profile.value = null;
  refs.ratings.value = [];
  refs.submissions.value = [];
  refs.analytics.value = null;
  refs.status.value = 'idle';
  refs.lastSuccessAt.value = null;
  refs.stale.value = false;
  refs.errorMessage.value = null;
}

export { readonly };
