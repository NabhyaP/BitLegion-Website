<script setup lang="ts">
/**
 * Leaderboard — Phase 6.
 * URL-driven state: ?sort=&batch=&branch=&q=&cursor=
 * 300 ms debounce on search. AbortController on stale requests.
 * ETag / 304 handled by apiFetch automatically (browser cache).
 * §0.3: zero data logic in template — all in script setup.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fetchLeaderboard } from '@/api/index.ts';
import { rankInfo } from '@/utils/rankColor.ts';
import { useSessionStore } from '@/stores/session.ts';
import type { LeaderboardEntry, LeaderboardMeta } from '@contracts';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

/** Highlight the signed-in user's own name so they can find themselves in the list. */
const myUserId = computed(() => session.me?.id ?? null);

// ── State ──────────────────────────────────────────────────────────────────
const entries = ref<LeaderboardEntry[]>([]);
const meta = ref<LeaderboardMeta | null>(null);
const disabled = ref(false);
const previewOnly = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

// Filters bound to URL
const sort = ref<'rating' | 'maxRating' | 'solvedCount'>('rating');
const batch = ref<string>('');   // string for select binding
const branch = ref<string>('');
const q = ref<string>('');
const cursor = ref<string | null>(null);

// Debounce timer
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _abortCtrl: AbortController | null = null;

// Batch years: from 2019 to current year + 1
const currentYear = new Date().getFullYear();
const batchYears = Array.from({ length: currentYear - 2019 + 2 }, (_, i) => 2019 + i);

// Branches from data (static list for filter; server validates)
const BRANCHES = ['CSE', 'ECE'];

// ── Sync URL → local state ─────────────────────────────────────────────────
function readFromUrl() {
  sort.value = (['rating', 'maxRating', 'solvedCount'].includes(String(route.query.sort))
    ? route.query.sort : 'rating') as 'rating' | 'maxRating' | 'solvedCount';
  batch.value = String(route.query.batch ?? '');
  branch.value = String(route.query.branch ?? '');
  q.value = String(route.query.q ?? '');
  cursor.value = (route.query.cursor as string) || null;
}

function pushUrl() {
  const query: Record<string, string> = {};
  if (sort.value !== 'rating') query.sort = sort.value;
  if (batch.value) query.batch = batch.value;
  if (branch.value) query.branch = branch.value;
  if (q.value) query.q = q.value;
  if (cursor.value) query.cursor = cursor.value;
  router.replace({ query });
}

// ── Fetch ──────────────────────────────────────────────────────────────────
async function fetchPage() {
  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();
  loading.value = true;
  error.value = null;
  try {
    const params = {
      sort: sort.value,
      batch: batch.value ? Number(batch.value) : undefined,
      branch: branch.value || undefined,
      q: q.value || undefined,
      limit: 50,
      cursor: cursor.value || undefined,
    };
    const res = await fetchLeaderboard(params);
    if ('disabled' in res && res.disabled) {
      disabled.value = true;
      entries.value = [];
      meta.value = null;
    } else {
      disabled.value = false;
      previewOnly.value = !!(res as { meta: LeaderboardMeta }).meta.previewOnly;
      entries.value = (res as { data: LeaderboardEntry[] }).data;
      meta.value = (res as { meta: LeaderboardMeta }).meta;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load leaderboard.';
  } finally {
    loading.value = false;
  }
}

// ── Watchers ───────────────────────────────────────────────────────────────
watch([sort, batch, branch], () => {
  cursor.value = null;  // reset pagination on filter change
  pushUrl();
  fetchPage();
});

// Debounce search
watch(q, () => {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    cursor.value = null;
    pushUrl();
    fetchPage();
  }, 300);
});

watch(() => route.query, () => {
  readFromUrl();
}, { deep: true });

onMounted(() => {
  readFromUrl();
  fetchPage();
});

// ── Pagination ─────────────────────────────────────────────────────────────
function nextPage() {
  if (!meta.value?.nextCursor) return;
  cursor.value = meta.value.nextCursor;
  pushUrl();
  fetchPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function prevPage() {
  cursor.value = null;
  pushUrl();
  fetchPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtChange(v: number | null): string {
  if (v === null) return '—';
  return (v >= 0 ? '+' : '') + v;
}

function changeStyle(v: number | null): string {
  if (v === null) return 'color:var(--muted)';
  return v > 0 ? 'color:var(--ok)' : v < 0 ? 'color:var(--danger)' : 'color:var(--muted)';
}

function snapshotAge(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  return `${Math.round(diff / 60)} hr ago`;
}

const onCursorPage = computed(() => cursor.value !== null);
</script>

<template>
  <main style="padding:2rem;max-width:72rem;margin:0 auto">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem">
      <h1 style="margin:0">Leaderboard</h1>
      <div style="display:flex;gap:1rem;font-size:0.9rem">
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/teams">Teams</RouterLink>
      </div>
    </header>

    <!-- Preview banner (admin viewing disabled leaderboard) -->
    <div v-if="previewOnly" role="alert"
         style="background:var(--warn-bg);border:1px solid var(--warn);border-radius:4px;padding:0.75rem;margin-bottom:1rem">
      <strong>Preview mode:</strong> The leaderboard is currently hidden from the public.
    </div>

    <!-- Disabled state -->
    <div v-if="disabled && !previewOnly"
         style="background:var(--surface);padding:2rem;border-radius:6px;text-align:center;color:var(--muted)">
      The leaderboard is currently unavailable.
    </div>

    <template v-else>
      <!-- Controls -->
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;align-items:flex-end">
        <!-- Search -->
        <div style="flex:1;min-width:180px">
          <label for="lb-search" style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:0.25rem">Search</label>
          <input
            id="lb-search"
            v-model="q"
            type="search"
            placeholder="Name or handle…"
            style="width:100%;padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem;box-sizing:border-box"
            aria-label="Search by name or handle"
          />
        </div>
        <!-- Batch -->
        <div>
          <label for="lb-batch" style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:0.25rem">Batch</label>
          <select id="lb-batch" v-model="batch"
                  style="padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem"
                  aria-label="Filter by batch year">
            <option value="">All batches</option>
            <option v-for="y in batchYears" :key="y" :value="String(y)">{{ y }}</option>
          </select>
        </div>
        <!-- Branch -->
        <div>
          <label for="lb-branch" style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:0.25rem">Branch</label>
          <select id="lb-branch" v-model="branch"
                  style="padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem"
                  aria-label="Filter by branch">
            <option value="">All branches</option>
            <option v-for="b in BRANCHES" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
        <!-- Sort -->
        <div>
          <label for="lb-sort" style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:0.25rem">Sort by</label>
          <select id="lb-sort" v-model="sort"
                  style="padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem"
                  aria-label="Sort leaderboard">
            <option value="rating">Current Rating</option>
            <option value="maxRating">Max Rating</option>
            <option value="solvedCount">Problems Solved</option>
          </select>
        </div>
      </div>

      <!-- Snapshot meta -->
      <div v-if="meta" style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.4rem">
        <span>Snapshot generated {{ snapshotAge(meta.generatedAt) }}</span>
        <span>Next refresh at {{ new Date(meta.nextRefreshAfter).toLocaleTimeString() }}</span>
      </div>

      <!-- Error -->
      <div v-if="error" role="alert"
           style="background:var(--danger-bg);border-radius:4px;padding:0.75rem;margin-bottom:1rem;font-size:0.9rem">
        {{ error }}
        <button style="margin-left:0.75rem;cursor:pointer" @click="fetchPage">Retry</button>
      </div>

      <!-- Loading -->
      <div v-if="loading && entries.length === 0" aria-live="polite" role="status"
           style="text-align:center;padding:3rem;color:var(--muted)">
        Loading…
      </div>

      <!-- Empty -->
      <div v-else-if="!loading && entries.length === 0 && !error"
           style="text-align:center;padding:3rem;color:var(--muted)">
        No results found.
      </div>

      <!-- Table -->
      <div v-else style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem" aria-label="Leaderboard">
          <thead>
            <tr style="border-bottom:2px solid var(--line);text-align:left">
              <th style="padding:0.6rem 0.5rem;white-space:nowrap" scope="col">Rank</th>
              <th style="padding:0.6rem 0.5rem" scope="col">Name</th>
              <th style="padding:0.6rem 0.5rem" scope="col">Handle</th>
              <th style="padding:0.6rem 0.5rem;white-space:nowrap" scope="col">Batch</th>
              <th style="padding:0.6rem 0.5rem" scope="col">Branch</th>
              <th style="padding:0.6rem 0.5rem;white-space:nowrap;text-align:right" scope="col">Rating</th>
              <th style="padding:0.6rem 0.5rem;white-space:nowrap;text-align:right" scope="col">Max</th>
              <th style="padding:0.6rem 0.5rem;white-space:nowrap;text-align:right" scope="col">30d Δ</th>
              <th style="padding:0.6rem 0.5rem;white-space:nowrap;text-align:right" scope="col">Solved</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in entries"
              :key="e.userId"
              :style="{ opacity: e.stale ? 0.65 : 1 }"
              style="border-bottom:1px solid var(--surface)"
            >
              <td style="padding:0.6rem 0.5rem;font-weight:600;color:var(--muted)">{{ e.rank }}</td>
              <td style="padding:0.6rem 0.5rem">
                <RouterLink :to="`/profile/${e.handle}`" style="text-decoration:none;color:inherit">
                  <span style="display:flex;align-items:center;gap:0.5rem">
                    <img
                      v-if="e.avatarUrl"
                      :src="e.avatarUrl"
                      :alt="`${e.displayName} avatar`"
                      width="24" height="24"
                      style="border-radius:50%;object-fit:cover;flex-shrink:0"
                      loading="lazy"
                    />
                    <span :style="e.userId === myUserId ? 'font-weight:700' : ''">
                      {{ e.displayName }}<template v-if="e.userId === myUserId"> (you)</template>
                    </span>
                  </span>
                </RouterLink>
              </td>
              <td style="padding:0.6rem 0.5rem">
                <RouterLink :to="`/profile/${e.handle}`"
                            :style="{ color: rankInfo(e.rating).color, fontWeight: 600, textDecoration:'none' }">
                  {{ e.handle }}
                </RouterLink>
                <span v-if="e.stale" style="font-size:0.7rem;color:var(--warn);margin-left:0.25rem" title="Stale data">⚠</span>
              </td>
              <td style="padding:0.6rem 0.5rem;color:var(--muted)">{{ e.batch ?? '—' }}</td>
              <td style="padding:0.6rem 0.5rem;color:var(--muted)">{{ e.branch ?? '—' }}</td>
              <td style="padding:0.6rem 0.5rem;text-align:right">
                <span :style="{ color: rankInfo(e.rating).color, fontWeight:600 }">{{ e.rating }}</span>
                <span style="display:block;font-size:0.7rem;color:var(--muted)">{{ rankInfo(e.rating).label }}</span>
              </td>
              <td style="padding:0.6rem 0.5rem;text-align:right">
                <span :style="{ color: rankInfo(e.maxRating).color }">{{ e.maxRating }}</span>
              </td>
              <td style="padding:0.6rem 0.5rem;text-align:right" :style="changeStyle(e.ratingChange30d)">
                {{ fmtChange(e.ratingChange30d) }}
              </td>
              <td style="padding:0.6rem 0.5rem;text-align:right;color:var(--text)">
                <template v-if="e.solvedCount === null">
                  <span title="Solved count syncing — updates daily" style="color:var(--muted)">—</span>
                </template>
                <template v-else>{{ e.solvedCount }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="!loading && (meta?.nextCursor || onCursorPage)"
           style="display:flex;justify-content:space-between;margin-top:1rem">
        <button v-if="onCursorPage" style="cursor:pointer;padding:0.4rem 0.9rem;border:1px solid var(--line);border-radius:4px"
                @click="prevPage">
          ← First page
        </button>
        <div v-else></div>
        <button v-if="meta?.nextCursor"
                style="cursor:pointer;padding:0.4rem 0.9rem;border:1px solid var(--line);border-radius:4px"
                @click="nextPage">
          Next →
        </button>
      </div>

      <!-- Ranking rules footnote -->
      <p style="font-size:0.75rem;color:var(--muted);margin-top:1.5rem">
        Rankings are based on Codeforces profiles fetched hourly. Solved counts update daily and
        may take a few days for new members. Null solved counts render as "—" while syncing.
        Stale entries (⚠) carry forward data from the previous snapshot.
      </p>
    </template>
  </main>
</template>
