const CF_MIN_INTERVAL_MS = 2_200;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;
const LOCK_NAME = 'bitlegion-cf-queue';
const LEASE_KEY = 'bitlegion.cf.leader';
const LEASE_MS = 15_000;
const TAB_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

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

let _lastCallStart = 0;
let _chain: Promise<void> = Promise.resolve();
let _rateLimitedUntil = 0;

export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = _chain.then(async (): Promise<T> => {
    const now = Date.now();
    if (_rateLimitedUntil > now) throw new CfRateLimitError(_rateLimitedUntil - now);

    const gap = Date.now() - _lastCallStart;
    if (gap < CF_MIN_INTERVAL_MS) await sleep(CF_MIN_INTERVAL_MS - gap);
    _lastCallStart = Date.now();

    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof CfRateLimitError) {
          _rateLimitedUntil = Date.now() + err.retryAfterMs;
          throw err;
        }
        if (err instanceof CfUnavailableError && attempt < MAX_RETRIES) {
          attempt++;
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1) + jitter());
          continue;
        }
        throw err;
      }
    }
  });

  _chain = result.then(() => undefined, () => undefined);
  return result;
}

export type TabRole = 'leader' | 'follower';
let _tabRole: TabRole = 'follower';
let _lockController: AbortController | null = null;
let _leaseTimer: ReturnType<typeof setInterval> | null = null;
let _observedLeaderUntil = 0;

const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(LOCK_NAME)
  : null;

channel?.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type?: string; tabId?: string; expiresAt?: number };
  if (message.tabId === TAB_ID) return;
  if (message.type === 'probe' && _tabRole === 'leader') {
    channel.postMessage({ type: 'leader', tabId: TAB_ID, expiresAt: Date.now() + LEASE_MS });
  }
  if (message.type === 'leader' && typeof message.expiresAt === 'number') {
    _observedLeaderUntil = Math.max(_observedLeaderUntil, message.expiresAt);
  }
});

function readLease(): { tabId: string; expiresAt: number } | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { tabId?: unknown; expiresAt?: unknown };
    return typeof value.tabId === 'string' && typeof value.expiresAt === 'number'
      ? { tabId: value.tabId, expiresAt: value.expiresAt }
      : null;
  } catch {
    return null;
  }
}

function writeLease(): boolean {
  try {
    const lease = { tabId: TAB_ID, expiresAt: Date.now() + LEASE_MS };
    localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
    channel?.postMessage({ type: 'leader', ...lease });
    return true;
  } catch {
    return false;
  }
}

async function tryFallbackLeadership(): Promise<boolean> {
  channel?.postMessage({ type: 'probe', tabId: TAB_ID });
  await sleep(80);
  const current = readLease();
  const now = Date.now();
  if (_observedLeaderUntil > now || (current && current.tabId !== TAB_ID && current.expiresAt > now)) {
    return false;
  }

  if (!writeLease()) {
    // Storage can be disabled; BroadcastChannel still prevents established leaders.
    _tabRole = 'leader';
    return true;
  }

  // Give simultaneous contenders a chance to overwrite the lease, then verify ownership.
  await sleep(50);
  if (readLease()?.tabId !== TAB_ID) return false;
  _tabRole = 'leader';
  _leaseTimer = setInterval(() => {
    if (_tabRole === 'leader') writeLease();
  }, LEASE_MS / 3);
  return true;
}

export async function tryBecomeLeader(): Promise<boolean> {
  if (_tabRole === 'leader') return true;
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return tryFallbackLeadership();
  }

  const immediateController = new AbortController();
  _lockController = immediateController;
  const gotImmediately = await new Promise<boolean>((resolve) => {
    navigator.locks.request(
      LOCK_NAME,
      { ifAvailable: true, signal: immediateController.signal },
      (lock) => {
        if (!lock) {
          resolve(false);
          return Promise.resolve();
        }
        _tabRole = 'leader';
        resolve(true);
        return new Promise<void>((release) => {
          immediateController.signal.addEventListener('abort', () => release(), { once: true });
        });
      },
    ).catch(() => resolve(false));
  });
  if (gotImmediately) return true;

  const controller = new AbortController();
  _lockController = controller;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      resolve(false);
    }, 4_000);

    navigator.locks.request(
      LOCK_NAME,
      { signal: controller.signal },
      () => {
        if (settled) return Promise.resolve();
        settled = true;
        clearTimeout(timeout);
        _tabRole = 'leader';
        resolve(true);
        return new Promise<void>((release) => {
          controller.signal.addEventListener('abort', () => release(), { once: true });
        });
      },
    ).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

export function releaseLeader(): void {
  _lockController?.abort();
  _lockController = null;
  if (_leaseTimer) clearInterval(_leaseTimer);
  _leaseTimer = null;
  try {
    if (readLease()?.tabId === TAB_ID) localStorage.removeItem(LEASE_KEY);
  } catch {
    // Storage is optional.
  }
  _tabRole = 'follower';
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', releaseLeader);
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

export function setRateLimited(untilMs: number): void {
  _rateLimitedUntil = Math.max(_rateLimitedUntil, untilMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
  return Math.random() * 1_000;
}
