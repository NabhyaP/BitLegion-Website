/**
 * IndexedDB cache via Dexie (§C3).
 *
 * Per-handle stores: profile, rating history, submissions, metadata.
 * Stale-while-revalidate window: serve cached instantly, revalidate if >15 min.
 * Full invalidation on handle change.
 * Falls back to memory-only if IndexedDB is unavailable (§C4 Storage unavailable).
 *
 * No Vue imports — importable from workers.
 */
import Dexie, { type Table } from 'dexie';
import type { CfProfile, CfRatingPoint, CfSubmission, CfCacheMeta } from './types.ts';
import { SCHEMA_VERSION } from './normalize.ts';

const STALE_MS = 15 * 60 * 1000;       // 15 min — start revalidation
const MAX_STALE_MS = 30 * 60 * 1000;   // 30 min — upper bound of stale-while-revalidate band
const SUBMISSION_CAP = 2000;           // §C "first visit pages up to 2,000-cap"

// ---------------------------------------------------------------------------
// Dexie database schema
// ---------------------------------------------------------------------------

class CfDatabase extends Dexie {
  meta!: Table<CfCacheMeta & { id: string }, string>;       // keyed by handle
  profiles!: Table<CfProfile & { id: string }, string>;
  ratings!: Table<{ handle: string; points: CfRatingPoint[]; id: string }, string>;
  submissions!: Table<CfSubmission & { handle: string }, number>;  // keyed by submissionId

  constructor() {
    super('bitlegion-cf-cache');
    this.version(1).stores({
      meta:        'id',
      profiles:    'id',
      ratings:     'id',
      submissions: 'submissionId, handle, createdAt, problemKey',
    });
  }
}

// ---------------------------------------------------------------------------
// Memory fallback (used when IndexedDB is unavailable)
// ---------------------------------------------------------------------------

class MemoryFallback {
  readonly unavailable = true;
  private _meta = new Map<string, CfCacheMeta>();
  private _profiles = new Map<string, CfProfile>();
  private _ratings = new Map<string, CfRatingPoint[]>();
  private _submissions = new Map<string, Map<number, CfSubmission>>();

  getMeta(handle: string) { return this._meta.get(handle) ?? null; }
  setMeta(handle: string, m: CfCacheMeta) { this._meta.set(handle, m); }
  getProfile(handle: string) { return this._profiles.get(handle) ?? null; }
  setProfile(handle: string, p: CfProfile) { this._profiles.set(handle, p); }
  getRatings(handle: string) { return this._ratings.get(handle) ?? null; }
  setRatings(handle: string, r: CfRatingPoint[]) { this._ratings.set(handle, r); }
  getSubmissions(handle: string) {
    return Array.from(this._submissions.get(handle)?.values() ?? []);
  }
  upsertSubmissions(handle: string, subs: CfSubmission[]) {
    if (!this._submissions.has(handle)) this._submissions.set(handle, new Map());
    const m = this._submissions.get(handle)!;
    for (const s of subs) m.set(s.submissionId, s);
  }
  clearHandle(handle: string) {
    this._meta.delete(handle);
    this._profiles.delete(handle);
    this._ratings.delete(handle);
    this._submissions.delete(handle);
  }
}

// ---------------------------------------------------------------------------
// CfCache — unified API over Dexie or MemoryFallback
// ---------------------------------------------------------------------------

let _db: CfDatabase | null = null;
let _fallback: MemoryFallback | null = null;
let _storageUnavailable = false;

function getDb(): CfDatabase {
  if (!_db) _db = new CfDatabase();
  return _db;
}

async function checkStorage(): Promise<void> {
  if (_fallback || _db) return;
  try {
    const db = getDb();
    await db.open();
  } catch {
    _storageUnavailable = true;
    _fallback = new MemoryFallback();
  }
}

export function isStorageUnavailable(): boolean {
  return _storageUnavailable;
}

// ---------------------------------------------------------------------------
// Freshness helpers
// ---------------------------------------------------------------------------

export function isFresh(fetchedAt: number | null): boolean {
  if (fetchedAt === null) return false;
  return Date.now() - fetchedAt < STALE_MS;
}

export function isWithinStaleWindow(fetchedAt: number | null): boolean {
  if (fetchedAt === null) return false;
  return Date.now() - fetchedAt < MAX_STALE_MS;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function getMeta(handle: string): Promise<CfCacheMeta | null> {
  await checkStorage();
  if (_fallback) return _fallback.getMeta(handle);
  const row = await getDb().meta.get(handle);
  if (!row) return null;
  if (row.schemaVersion !== SCHEMA_VERSION) {
    await clearHandle(handle);
    return null;
  }
  return row;
}

export async function setMeta(handle: string, meta: Omit<CfCacheMeta, 'handle'>): Promise<void> {
  await checkStorage();
  const full: CfCacheMeta = { handle, ...meta };
  if (_fallback) { _fallback.setMeta(handle, full); return; }
  await getDb().meta.put({ id: handle, ...full });
}

async function ensureMeta(handle: string): Promise<CfCacheMeta> {
  const existing = await getMeta(handle);
  if (existing) return existing;
  const fresh: CfCacheMeta = {
    handle,
    schemaVersion: SCHEMA_VERSION,
    profileFetchedAt: null,
    ratingsFetchedAt: null,
    submissionsFetchedAt: null,
    lastSubmissionId: 0,
    coverage: { complete: false, retainedSubmissionCount: 0 },
  };
  await setMeta(handle, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(handle: string): Promise<CfProfile | null> {
  await checkStorage();
  if (_fallback) return _fallback.getProfile(handle);
  const row = await getDb().profiles.get(handle);
  return row ?? null;
}

export async function setProfile(handle: string, profile: CfProfile): Promise<void> {
  await checkStorage();
  if (_fallback) { _fallback.setProfile(handle, profile); }
  else { await getDb().profiles.put({ id: handle, ...profile }); }
  const meta = await ensureMeta(handle);
  await setMeta(handle, { ...meta, profileFetchedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export async function getRatings(handle: string): Promise<CfRatingPoint[] | null> {
  await checkStorage();
  if (_fallback) return _fallback.getRatings(handle);
  const row = await getDb().ratings.get(handle);
  return row?.points ?? null;
}

export async function setRatings(handle: string, points: CfRatingPoint[]): Promise<void> {
  await checkStorage();
  if (_fallback) { _fallback.setRatings(handle, points); }
  else { await getDb().ratings.put({ id: handle, handle, points }); }
  const meta = await ensureMeta(handle);
  await setMeta(handle, { ...meta, ratingsFetchedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Submissions — incremental upsert with cap
// ---------------------------------------------------------------------------

export async function getSubmissions(handle: string): Promise<CfSubmission[]> {
  await checkStorage();
  if (_fallback) return _fallback.getSubmissions(handle);
  return getDb().submissions.where('handle').equals(handle).toArray();
}

/**
 * Upsert new submissions for a handle.
 * Enforces the SUBMISSION_CAP by keeping the newest N (by submissionId desc).
 * Returns the count of actually-new rows added.
 */
export async function upsertSubmissions(
  handle: string,
  incoming: CfSubmission[],
): Promise<number> {
  await checkStorage();
  if (_fallback) {
    const before = _fallback.getSubmissions(handle).length;
    _fallback.upsertSubmissions(handle, incoming);
    return _fallback.getSubmissions(handle).length - before;
  }

  const db = getDb();
  const withHandle = incoming.map((s) => ({ ...s, handle }));

  // Use bulkPut — existing rows with same submissionId are overwritten (idempotent)
  await db.submissions.bulkPut(withHandle);

  // Enforce cap: keep newest SUBMISSION_CAP rows per handle
  const all = await db.submissions
    .where('handle').equals(handle)
    .sortBy('submissionId');
  const toDelete = all.slice(0, Math.max(0, all.length - SUBMISSION_CAP));
  if (toDelete.length > 0) {
    await db.submissions.bulkDelete(toDelete.map((s) => s.submissionId));
  }

  // Update meta
  const maxId = Math.max(0, ...incoming.map((s) => s.submissionId));
  const meta = await ensureMeta(handle);
  const newLastId = Math.max(meta.lastSubmissionId, maxId);
  const retained = Math.min(all.length, SUBMISSION_CAP);
  await setMeta(handle, {
    ...meta,
    submissionsFetchedAt: Date.now(),
    lastSubmissionId: newLastId,
    coverage: {
      complete: all.length <= SUBMISSION_CAP,
      retainedSubmissionCount: retained,
    },
  });

  return incoming.filter((s) => !all.some((e) => e.submissionId === s.submissionId)).length;
}

// ---------------------------------------------------------------------------
// Full handle invalidation (handle change, unlink, "Clear local CF data")
// ---------------------------------------------------------------------------

export async function clearHandle(handle: string): Promise<void> {
  await checkStorage();
  if (_fallback) { _fallback.clearHandle(handle); return; }
  const db = getDb();
  await Promise.all([
    db.meta.delete(handle),
    db.profiles.delete(handle),
    db.ratings.delete(handle),
    db.submissions.where('handle').equals(handle).delete(),
  ]);
}

/** Clear ALL cached data for all handles. */
export async function clearAll(): Promise<void> {
  await checkStorage();
  if (_fallback) {
    _fallback = new MemoryFallback();
    return;
  }
  const db = getDb();
  await Promise.all([
    db.meta.clear(),
    db.profiles.clear(),
    db.ratings.clear(),
    db.submissions.clear(),
  ]);
}
