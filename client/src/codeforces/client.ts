/**
 * Browser CF API client (§C1, §C2).
 *
 * Calls only anonymous public CF endpoints:
 *   user.info    — profile data
 *   user.rating  — contest rating history
 *   user.status  — submission list (paginated, 500 per page)
 *
 * All calls go through the shared queue (§C2 ≥2,200 ms spacing).
 * Throws CfRateLimitError / CfUnavailableError — never leaks raw responses.
 *
 * No Vue imports. No credentials sent to CF (§C1).
 */
import { enqueue, CfRateLimitError, CfUnavailableError } from './queue.ts';
import { normalizeProfile, normalizeRatingChanges, normalizeSubmissions } from './normalize.ts';
import type {
  CfApiEnvelope,
  CfContest,
  CfProfile,
  CfRatingPoint,
  CfRawContest,
  CfRawRatingChange,
  CfRawSubmission,
  CfRawUser,
  CfSubmission,
} from './types.ts';

const CF_BASE = 'https://codeforces.com/api';
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Low-level fetch with timeout
// ---------------------------------------------------------------------------

async function cfFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',   // never send cookies to CF (§C1)
    });
    clearTimeout(timer);

    if (res.status === 429) throw new CfRateLimitError();
    if (!res.ok) throw new CfUnavailableError(`CF API HTTP ${res.status}`);

    const body: CfApiEnvelope<T> = await res.json();
    if (body.status === 'FAILED') {
      const comment = body.comment ?? '';
      if (comment.toLowerCase().includes('limit')) throw new CfRateLimitError();
      // "not found" / "illegal" style errors — bubble as unavailable (caller decides)
      throw new CfUnavailableError(comment);
    }
    return (body as { status: 'OK'; result: T }).result;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof CfRateLimitError || err instanceof CfUnavailableError) throw err;
    if ((err as Error).name === 'AbortError') throw new CfUnavailableError('CF API timed out');
    throw new CfUnavailableError(`Network error: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public methods (all queued)
// ---------------------------------------------------------------------------

export async function fetchProfile(handle: string): Promise<CfProfile> {
  return enqueue(async () => {
    const result = await cfFetch<CfRawUser[]>(
      `${CF_BASE}/user.info?handles=${encodeURIComponent(handle)}`,
    );
    if (!result[0]) throw new CfUnavailableError('user.info returned empty result');
    return normalizeProfile(result[0]);
  });
}

export async function fetchRatingHistory(handle: string): Promise<CfRatingPoint[]> {
  return enqueue(async () => {
    const result = await cfFetch<CfRawRatingChange[]>(
      `${CF_BASE}/user.rating?handle=${encodeURIComponent(handle)}`,
    );
    return normalizeRatingChanges(result);
  });
}

/**
 * Fetch one page (≤500) of submissions starting at `from` (1-based).
 * Returns normalized submissions, newest first (CF default order).
 */
export async function fetchSubmissionsPage(
  handle: string,
  from: number,
  count = 500,
): Promise<CfSubmission[]> {
  return enqueue(async () => {
    const result = await cfFetch<CfRawSubmission[]>(
      `${CF_BASE}/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`,
    );
    return normalizeSubmissions(result);
  });
}

export async function fetchUpcomingContests(limit = 6): Promise<CfContest[]> {
  return enqueue(async () => {
    const result = await cfFetch<CfRawContest[]>(`${CF_BASE}/contest.list?gym=false`);
    return result
      .filter((contest) => contest.phase === 'BEFORE' && contest.startTimeSeconds !== undefined)
      .sort((a, b) => a.startTimeSeconds! - b.startTimeSeconds!)
      .slice(0, limit)
      .map((contest) => ({
        id: contest.id,
        name: contest.name,
        type: contest.type,
        startsAt: contest.startTimeSeconds! * 1000,
        durationSeconds: contest.durationSeconds,
      }));
  });
}
