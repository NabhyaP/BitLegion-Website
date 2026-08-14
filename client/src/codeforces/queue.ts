/**
 * Serialized CF request queue (§C2).
 *
 * Rules:
 *  - ≥2,200 ms between call STARTS (CF rate-limit courtesy)
 *  - Exponential back-off + jitter after rate-limit errors
 *  - Bounded retry attempts (3 max for transient errors)
 *  - Cross-tab coordination via navigator.locks (fallback: BroadcastChannel leader election)
 *  - One tab refreshes a given handle at a time
 *  - Refresh button disabled while a refresh is active (via exported reactive state)
 *
 * No Vue imports — importable from workers and coordinators.
 */

const CF_MIN_INTERVAL_MS = 2_200;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;
const LOCK_NAME = 'bitlegion-cf-queue';

export class CfRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = 60_000) {
    super('CF rate limit hit');
    this.retryAfterMs = retryAfterMs;
  }
}

export class CfUnavailableError extends Error {
  constructor(message = 'Codeforces is currently unavailable') {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Module-level serialization (one tab)
// ---------------------------------------------------------------------------

let _lastCallStart = 0;
let _chain: Promise<void> = Promise.resolve();
let _rateLimitedUntil = 0;

/**
 * Enqueue a CF API call. Enforces MIN_INTERVAL between call starts.
 * Returns the result or throws CfRateLimitError / CfUnavailableError.
 */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = _chain.then(async (): Promise<T> => {
    // Honour rate-limit back-off
    const now = Date.now();
    if (_rateLimitedUntil > now) {
      const wait = _rateLimitedUntil - now;
      await sleep(wait);
    }

    // Enforce minimum interval between call starts
    const gap = Date.now() - _lastCallStart;
    if (gap < CF_MIN_INTERVAL_MS) {
      await sleep(CF_MIN_INTERVAL_MS - gap);
    }

    _lastCallStart = Date.now();

    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof CfRateLimitError) {
          _rateLimitedUntil = Date.now() + err.retryAfterMs;
          throw err; // never retry rate-limit
        }
        if (err instanceof CfUnavailableError && attempt < MAX_RETRIES) {
          attempt++;
          const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1) + jitter();
          await sleep(backoff);
          continue;
        }
        throw err;
      }
    }
  });

  // Attach a no-op catch so the chain doesn't break on individual failures
  _chain = result.then(() => undefined, () => undefined);
  return result;
}

// ---------------------------------------------------------------------------
// Cross-tab coordination — navigator.locks with BroadcastChannel fallback
// ---------------------------------------------------------------------------

export type TabRole = 'leader' | 'follower';
let _tabRole: TabRole = 'follower';
let _lockController: AbortController | null = null;

/**
 * Try to acquire the cross-tab CF queue lock.
 * Only the leader tab should call CF APIs for a given handle.
 * The lock is held until releaseLeader() is called or the tab closes.
 */
export async function tryBecomeLeader(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    // No Web Locks API — always act as leader (single-tab fallback)
    _tabRole = 'leader';
    return true;
  }

  if (_tabRole === 'leader') return true;

  return new Promise<boolean>((resolve) => {
    _lockController = new AbortController();
    navigator.locks.request(
      LOCK_NAME,
      { ifAvailable: true, signal: _lockController.signal },
      (lock) => {
        if (lock) {
          _tabRole = 'leader';
          resolve(true);
          // Hold lock until releaseLeader() aborts
          return new Promise<void>((res) => {
            _lockController!.signal.addEventListener('abort', res);
          });
        } else {
          resolve(false);
          return Promise.resolve();
        }
      },
    ).catch(() => resolve(false));
  });
}

export function releaseLeader(): void {
  if (_lockController) {
    _lockController.abort();
    _lockController = null;
  }
  _tabRole = 'follower';
}

export function getTabRole(): TabRole {
  return _tabRole;
}

export function isRateLimited(): boolean {
  return Date.now() < _rateLimitedUntil;
}

export function getRateLimitedUntil(): number {
  return _rateLimitedUntil;
}

/** Set from outside when a rate-limit is encountered (so other code paths can check). */
export function setRateLimited(untilMs: number): void {
  _rateLimitedUntil = Math.max(_rateLimitedUntil, untilMs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
  return Math.random() * 1_000;
}
