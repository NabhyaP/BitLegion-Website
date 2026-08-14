/**
 * Serialized Codeforces API client (§E1).
 *
 * ALL calls to the CF public API in this process go through this module so that
 * the mandatory ≥ CF_MIN_INTERVAL_MS spacing is honoured globally.
 *
 * Rules (§E1):
 * - One module-level promise chain serializes every outgoing call.
 * - CF_MIN_INTERVAL_MS (default 2200) between call *starts*.
 * - 20-second AbortController timeout per call.
 * - Typed errors: CfRateLimitError | CfHandleError | CfUnavailableError.
 * - ≤ 3 retries at 5 s / 20 s / 60 s + jitter on network/5xx only.
 * - 4xx responses are NEVER retried.
 * - The CF envelope { status: 'OK'|'FAILED', comment? } is checked.
 */

// Read the interval directly from process.env so this module can be imported in
// unit tests without triggering the zod env validation in config/env.ts.
// Jobs that call cf-client always start AFTER env.ts has already validated at server/job startup.
function getCfMinIntervalMs(): number {
  const v = Number(process.env.CF_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 2200;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class CfRateLimitError extends Error {
  constructor() {
    super('Codeforces rate limit hit (429 / FAILED).');
    this.name = 'CfRateLimitError';
  }
}

export class CfHandleError extends Error {
  // Plain field — no TS parameter properties (Node strip-types rejects them).
  readonly handle: string;
  constructor(handle: string, message = `Unknown Codeforces handle: ${handle}`) {
    super(message);
    this.name = 'CfHandleError';
    this.handle = handle;
  }
}

export class CfUnavailableError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CfUnavailableError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// CF API response shapes (minimal — we only map what we use)
// ---------------------------------------------------------------------------

export type CfUserInfo = {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  contribution?: number;
  lastOnlineTimeSeconds?: number;
  avatar?: string;
  titlePhoto?: string;
};

export type CfSubmission = {
  id: number;
  creationTimeSeconds: number;
  contestId?: number;
  problem: {
    contestId?: number;
    index: string;
    name: string;
    problemsetName?: string;
    rating?: number;
    tags: string[];
  };
  verdict?: string;
  programmingLanguage?: string;
};

type CfEnvelope<T> = {
  status: 'OK' | 'FAILED';
  comment?: string;
  result?: T;
};

// ---------------------------------------------------------------------------
// Serialization queue
// ---------------------------------------------------------------------------

/**
 * Module-level chain. Each call appends to it so calls execute one at a time
 * with the mandatory spacing regardless of how many job files call into this module.
 */
let _chain: Promise<unknown> = Promise.resolve();
let _lastCallStart = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = _chain.then(async () => {
    const now = Date.now();
    const wait = _lastCallStart + getCfMinIntervalMs() - now;
    if (wait > 0) await sleep(wait);
    _lastCallStart = Date.now();
    return task();
  });
  // Swallow errors on the chain itself so one failure doesn't block all future calls.
  _chain = result.catch(() => {/* swallowed */});
  return result;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const CF_BASE = 'https://codeforces.com/api';
const TIMEOUT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base: number): number {
  // ± 15% of base
  return base + Math.floor((Math.random() - 0.5) * 2 * base * 0.15);
}

const RETRY_DELAYS = [5_000, 20_000, 60_000];

async function fetchCf<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const delay = jitter(RETRY_DELAYS[attempt - 1]);
      await sleep(delay);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (resp.status === 429) throw new CfRateLimitError();
      if (resp.status === 503 || resp.status === 502 || resp.status >= 500) {
        // Server-side error — eligible for retry.
        throw new CfUnavailableError(`CF HTTP ${resp.status}`);
      }
      if (!resp.ok) {
        // 4xx (other than 429) — not retried.
        throw new CfUnavailableError(`CF HTTP ${resp.status} (no retry)`);
      }

      const body = (await resp.json()) as CfEnvelope<T>;

      if (body.status === 'FAILED') {
        const comment = body.comment ?? '';
        // CF says "handles" in the comment when a handle is bad.
        if (
          comment.toLowerCase().includes('not found') ||
          comment.toLowerCase().includes('handle') ||
          comment.toLowerCase().includes('unknown')
        ) {
          // Caller must inspect and bisect — throw a generic handle error without a name.
          throw new CfHandleError('', comment);
        }
        if (comment.toLowerCase().includes('limit')) throw new CfRateLimitError();
        throw new CfUnavailableError(`CF FAILED: ${comment}`);
      }

      return body.result as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof CfRateLimitError) throw err;   // never retry rate-limit
      if (err instanceof CfHandleError) throw err;       // never retry bad handle
      if (err instanceof CfUnavailableError && err.message.includes('no retry')) throw err;
      if ((err as Error)?.name === 'AbortError') {
        lastErr = new CfUnavailableError('CF request timed out', err);
      } else {
        lastErr = err;
      }
      if (attempt === RETRY_DELAYS.length) break; // exhausted retries
    }
  }
  throw lastErr instanceof CfUnavailableError
    ? lastErr
    : new CfUnavailableError('CF unavailable after retries', lastErr);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch user info for a batch of handles (max 500 per CF docs; we use ≤ 75).
 * Throws CfHandleError (with empty handle) when CF reports an unknown handle in the batch.
 * Caller should bisect to find the bad one (§E2 step 5).
 */
export async function userInfo(handles: string[]): Promise<CfUserInfo[]> {
  const url = `${CF_BASE}/user.info?handles=${handles.map(encodeURIComponent).join(';')}`;
  return enqueue(() => fetchCf<CfUserInfo[]>(url));
}

/**
 * Fetch a page of submissions for a handle.
 * @param handle  CF handle.
 * @param from    1-based start index.
 * @param count   How many to fetch (max 500).
 */
export async function userStatus(
  handle: string,
  from: number,
  count: number,
): Promise<CfSubmission[]> {
  const url =
    `${CF_BASE}/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`;
  return enqueue(() =>
    fetchCf<CfSubmission[]>(url).catch((err) => {
      // Attach the specific handle to generic handle errors.
      if (err instanceof CfHandleError && !err.handle) {
        throw new CfHandleError(handle, err.message);
      }
      throw err;
    }),
  );
}

/**
 * Reset the serialization queue (for tests only).
 * Production code must never call this.
 */
export function _resetQueueForTests(): void {
  _chain = Promise.resolve();
  _lastCallStart = 0;
}
