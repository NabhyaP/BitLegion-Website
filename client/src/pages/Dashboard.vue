<script setup lang="ts">
/**
 * Dashboard — Phase 6.
 * Widgets: stat row, rating line chart (SVG), tag donut (SVG), difficulty bars,
 * practice calendar (heatmap), language usage, manual refresh, freshness label.
 * All business logic in coordinator / analytics — this template is presentation-only (§0.3).
 * Each widget has its own failure state per §C4.
 */
import { onMounted, watch, computed, ref } from 'vue';
import { useSessionStore } from '@/stores/session.ts';
import { getHandleRefs, refresh } from '@/codeforces/coordinator.ts';
import { isStorageUnavailable } from '@/codeforces/cache.ts';
import { rankInfo } from '@/utils/rankColor.ts';
import { localDateKey } from '@/utils/date.ts';
import { fetchUpcomingContests } from '@/codeforces/client.ts';
import AccountMenu from '@/components/AccountMenu.vue';
import type { CfContest } from '@/codeforces/types.ts';

const session = useSessionStore();
const cfHandle = computed(() => session.cfHandle);
const cfRefs = computed(() => (cfHandle.value ? getHandleRefs(cfHandle.value) : null));

const upcomingContests = ref<CfContest[]>([]);
const contestsLoading = ref(true);
const contestsError = ref<string | null>(null);

async function loadUpcomingContests() {
  contestsLoading.value = true;
  contestsError.value = null;
  try {
    upcomingContests.value = await fetchUpcomingContests();
  } catch (error) {
    contestsError.value = error instanceof Error ? error.message : 'Could not load upcoming contests.';
  } finally {
    contestsLoading.value = false;
  }
}

onMounted(async () => {
  void loadUpcomingContests();
  // Always force-reload on dashboard — session may be stale (e.g. just linked CF).
  await session.load(true);
  if (session.cfHandle) refresh(session.cfHandle);
});

// Trigger refresh when cfHandle becomes available after load
watch(cfHandle, (h, prev) => {
  if (h && h !== prev) refresh(h);
});

// ── Rank info ──────────────────────────────────────────────────────────────
const ratingRank = computed(() => {
  const r = cfRefs.value?.profile.value?.rating;
  return r !== undefined ? rankInfo(r) : null;
});
const maxRatingRank = computed(() => {
  const r = cfRefs.value?.profile.value?.maxRating;
  return r !== undefined ? rankInfo(r) : null;
});

// ── Rating line chart (SVG) ───────────────────────────────────────────────
const CHART_W = 600;
const CHART_H = 180;
const CHART_PAD = { top: 16, right: 16, bottom: 24, left: 48 };

const chartPath = computed(() => {
  const ratings = cfRefs.value?.ratings.value;
  if (!ratings || ratings.length < 2) return null;
  const xs = ratings.map((r) => r.timeSeconds);
  const ys = ratings.map((r) => r.newRating);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const W = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const H = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const px = (x: number) => CHART_PAD.left + ((x - minX) / rangeX) * W;
  const py = (y: number) => CHART_PAD.top + H - ((y - minY) / rangeY) * H;
  const d = ratings.map((r, i) => `${i === 0 ? 'M' : 'L'}${px(r.timeSeconds).toFixed(1)},${py(r.newRating).toFixed(1)}`).join(' ');
  const lastX = px(xs[xs.length - 1]!).toFixed(1);
  const lastY = py(ys[ys.length - 1]!).toFixed(1);
  // Y-axis labels
  const yTicks = [minY, Math.round((minY + maxY) / 2), maxY];
  const yTickLines = yTicks.map((v) => ({
    y: py(v).toFixed(1),
    label: String(v),
  }));
  return { d, lastX, lastY, yTickLines, minX, maxX, px, py };
});

// ── Tag donut (SVG) ───────────────────────────────────────────────────────
const DONUT_R = 70;
const DONUT_INNER = 40;
const DONUT_CX = 90;
const DONUT_CY = 90;

const DONUT_COLORS = [
  '#60a5fa', '#4ade80', '#fbbf24', '#fb7185', '#22d3ee',
  '#c084fc', '#f97316', '#a3e635', '#e879f9', '#38bdf8', '#8a8a8a',
];

const donutArcs = computed(() => {
  const tags = cfRefs.value?.analytics.value?.topTags;
  if (!tags || tags.length === 0) return null;
  const total = tags.reduce((s, t) => s + t.count, 0);
  let angle = -Math.PI / 2;
  return tags.map((t, i) => {
    const sweep = (t.count / total) * 2 * Math.PI;
    const x1 = DONUT_CX + DONUT_R * Math.cos(angle);
    const y1 = DONUT_CY + DONUT_R * Math.sin(angle);
    angle += sweep;
    const x2 = DONUT_CX + DONUT_R * Math.cos(angle);
    const y2 = DONUT_CY + DONUT_R * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const ix1 = DONUT_CX + DONUT_INNER * Math.cos(angle - sweep);
    const iy1 = DONUT_CY + DONUT_INNER * Math.sin(angle - sweep);
    const ix2 = DONUT_CX + DONUT_INNER * Math.cos(angle);
    const iy2 = DONUT_CY + DONUT_INNER * Math.sin(angle);
    const path = `M${x1.toFixed(2)},${y1.toFixed(2)} A${DONUT_R},${DONUT_R} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${DONUT_INNER},${DONUT_INNER} 0 ${large},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`;
    return { path, color: DONUT_COLORS[i % DONUT_COLORS.length], tag: t.tag, count: t.count };
  });
});

// ── Difficulty bars ───────────────────────────────────────────────────────
const diffBars = computed(() => {
  const dist = cfRefs.value?.analytics.value?.difficultyDistribution;
  if (!dist || dist.length === 0) return null;
  const maxCount = Math.max(...dist.map((d) => d.count));
  return dist.map((d) => ({
    label: d.rating === null ? 'Unrated' : String(d.rating),
    count: d.count,
    pct: maxCount > 0 ? (d.count / maxCount) * 100 : 0,
    color: d.rating === null ? 'var(--muted)' : rankInfo(d.rating ?? 0).color,
  }));
});

// ── Practice calendar (last 52 weeks) ────────────────────────────────────
const calendarCells = computed(() => {
  const cal = cfRefs.value?.analytics.value?.practiceCalendar;
  if (!cal) return null;
  const map = new Map(cal.map((c) => [c.date, c.count]));
  const today = new Date();
  const startDay = new Date(today);
  startDay.setDate(today.getDate() - 364 - today.getDay());
  const cells: Array<{ date: string; count: number; wi: number; di: number }> = [];
  for (let w = 0; w < 53; w++) {
    for (let d = 0; d < 7; d++) {
      const dt = new Date(startDay);
      dt.setDate(startDay.getDate() + w * 7 + d);
      if (dt > today) { cells.push({ date: '', count: -1, wi: w, di: d }); continue; }
      const key = localDateKey(dt);
      cells.push({ date: key, count: map.get(key) ?? 0, wi: w, di: d });
    }
  }
  return cells;
});

function calColor(count: number): string {
  if (count <= 0) return 'var(--line)';
  if (count <= 2) return 'rgba(74, 222, 128, 0.25)';
  if (count <= 5) return 'rgba(74, 222, 128, 0.5)';
  if (count <= 10) return 'rgba(74, 222, 128, 0.75)';
  return 'rgb(74, 222, 128)';
}

const CALENDAR_LEGEND = [
  'var(--line)',
  'rgba(74, 222, 128, 0.25)',
  'rgba(74, 222, 128, 0.5)',
  'rgba(74, 222, 128, 0.75)',
  'rgb(74, 222, 128)',
];

function formatContestStart(startsAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(startsAt);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

// ── Freshness label ───────────────────────────────────────────────────────
const freshnessLabel = computed(() => {
  const ts = cfRefs.value?.lastSuccessAt.value;
  if (!ts) return null;
  const ago = Math.round((Date.now() - ts) / 60000);
  if (ago < 1) return 'Updated just now';
  if (ago === 1) return 'Updated 1 min ago';
  return `Updated ${ago} min ago`;
});

const isRefreshing = computed(() =>
  cfRefs.value?.status.value === 'loading' || cfRefs.value?.status.value === 'revalidating',
);

function doRefresh() {
  if (session.cfHandle) refresh(session.cfHandle, { force: true });
}
</script>

<template>
  <main style="padding:2rem;max-width:72rem;margin:0 auto">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem">
      <h1 style="margin:0">Dashboard</h1>
      <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
        <RouterLink to="/leaderboard">Leaderboard</RouterLink>
        <AccountMenu />
      </div>
    </header>

    <!-- Storage unavailable notice -->
    <div v-if="isStorageUnavailable()" role="alert" aria-live="polite"
         style="background:var(--warn-bg);border:1px solid var(--warn);border-radius:4px;padding:0.75rem;margin-bottom:1rem">
      <strong>Notice:</strong> IndexedDB is not available. Codeforces data will be lost on page reload.
    </div>

    <section class="contest-section" aria-labelledby="upcoming-contests-title">
      <div class="section-heading">
        <div>
          <h2 id="upcoming-contests-title">Upcoming Codeforces Contests</h2>
          <p>Times are shown in your local timezone.</p>
        </div>
        <button v-if="contestsError" type="button" @click="loadUpcomingContests">Retry</button>
      </div>
      <div v-if="contestsLoading" class="contest-state" role="status">Loading contests...</div>
      <div v-else-if="contestsError" class="contest-state contest-error" role="alert">
        Codeforces contests are temporarily unavailable.
      </div>
      <div v-else-if="upcomingContests.length === 0" class="contest-state">No upcoming contests announced.</div>
      <div v-else class="contest-list">
        <a
          v-for="contest in upcomingContests"
          :key="contest.id"
          class="contest-item"
          :href="`https://codeforces.com/contest/${contest.id}`"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="contest-date">{{ formatContestStart(contest.startsAt) }}</span>
          <strong>{{ contest.name }}</strong>
          <span class="contest-duration">{{ formatDuration(contest.durationSeconds) }}</span>
        </a>
      </div>
    </section>

    <!-- No CF link -->
    <section v-if="!session.hasCfLink && !session.loading"
             style="background:var(--surface);padding:2rem;border-radius:6px;text-align:center">
      <p style="margin-bottom:1rem">Your Codeforces handle is not linked yet.</p>
      <a href="/api/v1/codeforces/link/start"
         style="background:var(--accent);color:var(--surface);padding:0.5rem 1.25rem;border-radius:4px;text-decoration:none">
        Link Codeforces →
      </a>
    </section>

    <!-- Loading session -->
    <div v-else-if="!session.hasCfLink && session.loading"
         role="status" style="padding:2rem;text-align:center;color:var(--muted)">
      Loading…
    </div>

    <template v-else-if="cfRefs">
      <!-- Rate-limited notice -->
      <div v-if="cfRefs.status.value === 'rate-limited'" role="alert" aria-live="assertive"
           style="background:var(--danger-bg);border:1px solid var(--danger);border-radius:4px;padding:0.75rem;margin-bottom:1rem">
        <strong>Rate limit reached.</strong> Your cached data is shown below.
        <button style="margin-left:1rem;cursor:pointer" @click="doRefresh">Retry</button>
        <small style="display:block;margin-top:0.25rem;color:var(--danger)">
          Note: Many students on the same campus network share Codeforces' rate limit.
        </small>
      </div>

      <!-- CF unavailable notice -->
      <div v-if="cfRefs.status.value === 'cf-unavailable'" role="alert" aria-live="polite"
           style="background:var(--warn-bg);border-radius:4px;padding:0.75rem;margin-bottom:1rem">
        <strong>Codeforces is currently unavailable.</strong> Showing cached data.
      </div>

      <div v-if="cfRefs.status.value === 'partial'" role="status" aria-live="polite"
           style="background:var(--warn-bg);border-radius:4px;padding:0.75rem;margin-bottom:1rem">
        Some Codeforces details could not be refreshed. Available cached data is shown below.
      </div>

      <!-- Error: first visit, no cache -->
      <div v-if="cfRefs.status.value === 'error' && !cfRefs.profile.value" role="alert"
           style="background:var(--danger-bg);border-radius:4px;padding:1rem;margin-bottom:1rem">
        Could not load Codeforces data.
        <span v-if="cfRefs.errorMessage.value" style="margin-left:0.25rem">({{ cfRefs.errorMessage.value }})</span>
        <button style="margin-left:1rem;cursor:pointer" @click="doRefresh">Retry</button>
        <p style="margin-top:0.5rem;font-size:0.85rem;color:var(--muted)">The rest of BitLegion is fully usable.</p>
      </div>

      <!-- Loading spinner — first visit only -->
      <div v-if="cfRefs.status.value === 'loading' && !cfRefs.profile.value"
           aria-live="polite" role="status" style="padding:2rem;text-align:center;color:var(--muted)">
        Loading Codeforces data for <strong>{{ session.cfHandle }}</strong>…
      </div>

      <!-- Main content — shown once we have a profile -->
      <template v-if="cfRefs.profile.value">

        <!-- Freshness + refresh button -->
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:0.75rem;margin-bottom:1rem;font-size:0.8rem;color:var(--muted)">
          <span v-if="cfRefs.stale.value">⚠ Data may be stale</span>
          <span v-else-if="freshnessLabel">{{ freshnessLabel }}</span>
          <span v-if="isRefreshing" aria-live="polite">Refreshing…</span>
          <button
            :disabled="isRefreshing"
            style="font-size:0.8rem;cursor:pointer;padding:0.25rem 0.75rem;border:1px solid var(--line);border-radius:4px;background:var(--surface)"
            :aria-label="isRefreshing ? 'Refreshing data' : 'Refresh Codeforces data'"
            @click="doRefresh"
          >
            {{ isRefreshing ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <!-- Stat row -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:2rem"
             role="region" aria-label="Codeforces stats summary">
          <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
            <div :style="{ fontSize:'1.75rem', fontWeight:700, color: ratingRank?.color }">
              {{ cfRefs.profile.value.rating }}
            </div>
            <div style="font-size:0.75rem;color:var(--muted)">Current Rating</div>
            <div style="font-size:0.75rem" :style="{ color: ratingRank?.color }">{{ ratingRank?.label }}</div>
          </div>
          <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
            <div :style="{ fontSize:'1.75rem', fontWeight:700, color: maxRatingRank?.color }">
              {{ cfRefs.profile.value.maxRating }}
            </div>
            <div style="font-size:0.75rem;color:var(--muted)">Max Rating</div>
            <div style="font-size:0.75rem" :style="{ color: maxRatingRank?.color }">{{ maxRatingRank?.label }}</div>
          </div>
          <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
            <div style="font-size:1.75rem;font-weight:700;color:var(--text)">
              {{ cfRefs.analytics.value?.uniqueAccepted ?? '—' }}
            </div>
            <div style="font-size:0.75rem;color:var(--muted)">Problems Solved</div>
          </div>
          <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
            <div style="font-size:1.75rem;font-weight:700;color:var(--text)">
              {{ cfRefs.ratings.value.length }}
            </div>
            <div style="font-size:0.75rem;color:var(--muted)">Contests</div>
          </div>
          <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
            <div style="font-size:1.75rem;font-weight:700;color:var(--text)">
              {{ cfRefs.analytics.value?.attemptedUnsolved ?? '—' }}
            </div>
            <div style="font-size:0.75rem;color:var(--muted)">Unsolved Attempts</div>
          </div>
        </div>

        <!-- Rating history chart -->
        <section style="margin-bottom:2rem;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem"
                 aria-label="Rating history chart">
          <h2 style="font-size:1rem;margin:0 0 0.75rem">Rating History</h2>
          <div v-if="!chartPath" style="color:var(--muted);font-size:0.9rem">
            Not enough contest data to show a chart.
          </div>
          <template v-else>
            <svg
              :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
              style="width:100%;height:auto;display:block"
              role="img"
              aria-label="Rating history line chart"
            >
              <!-- Grid lines -->
              <line
                v-for="tick in chartPath.yTickLines"
                :key="tick.label"
                :x1="CHART_PAD.left" :y1="tick.y"
                :x2="CHART_W - CHART_PAD.right" :y2="tick.y"
                stroke="var(--line)" stroke-width="1"
              />
              <!-- Y axis labels -->
              <text
                v-for="tick in chartPath.yTickLines"
                :key="'label-' + tick.label"
                :x="CHART_PAD.left - 4"
                :y="tick.y"
                font-size="11"
                fill="var(--muted)"
                text-anchor="end"
                dominant-baseline="middle"
              >{{ tick.label }}</text>
              <!-- Line -->
              <path :d="chartPath.d" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" />
              <!-- Current point -->
              <circle :cx="chartPath.lastX" :cy="chartPath.lastY" r="4" fill="var(--accent)" />
            </svg>
            <!-- Text summary for accessibility -->
            <!-- <details style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem">
              <summary>Rating history data</summary>
              <ul style="max-height:8rem;overflow-y:auto;margin:0.5rem 0 0;padding-left:1.5rem">
                <li v-for="r in cfRefs.ratings.value" :key="r.contestId">
                  {{ r.contestName }}: {{ r.oldRating }} → {{ r.newRating }}
                  ({{ r.newRating - r.oldRating >= 0 ? '+' : '' }}{{ r.newRating - r.oldRating }})
                </li>
              </ul>
            </details> -->
          </template>
        </section>

        <!-- Two-column: tag donut + difficulty bars -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem;margin-bottom:2rem">

          <!-- Tag donut -->
          <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem"
                   aria-label="Problems by topic">
            <h2 style="font-size:1rem;margin:0 0 0.75rem">Problems by Topic</h2>
            <div v-if="!donutArcs" style="color:var(--muted);font-size:0.9rem">No tag data yet.</div>
            <template v-else>
              <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
                <svg :viewBox="`0 0 180 180`" style="width:180px;height:180px;flex-shrink:0"
                     role="img" aria-label="Topic donut chart">
                  <path
                    v-for="arc in donutArcs"
                    :key="arc.tag"
                    :d="arc.path"
                    :fill="arc.color"
                    :aria-label="`${arc.tag}: ${arc.count}`"
                  />
                  <text x="90" y="86" text-anchor="middle" font-size="13" fill="var(--text)" font-weight="600">
                    {{ cfRefs.analytics.value?.uniqueAccepted }}
                  </text>
                  <text x="90" y="101" text-anchor="middle" font-size="10" fill="var(--muted)">solved</text>
                </svg>
                <ul style="list-style:none;padding:0;margin:0;font-size:0.8rem;flex:1;min-width:0">
                  <li v-for="(arc, i) in donutArcs" :key="arc.tag"
                      style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem;min-width:0">
                    <span :style="{ width:'10px', height:'10px', borderRadius:'2px', background: arc.color, flexShrink:0 }" aria-hidden="true"></span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ arc.tag }}</span>
                    <span style="margin-left:auto;color:var(--muted);flex-shrink:0">{{ arc.count }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </section>

          <!-- Difficulty bars -->
          <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem"
                   aria-label="Problems by difficulty">
            <h2 style="font-size:1rem;margin:0 0 0.75rem">Problems by Difficulty</h2>
            <div v-if="!diffBars" style="color:var(--muted);font-size:0.9rem">No difficulty data yet.</div>
            <template v-else>
              <div v-for="bar in diffBars" :key="bar.label"
                   style="display:grid;grid-template-columns:3.5rem 1fr 2rem;gap:0.5rem;align-items:center;margin-bottom:0.5rem;font-size:0.8rem">
                <span style="text-align:right;color:var(--muted)" :style="{ color: bar.color }">{{ bar.label }}</span>
                <div style="background:var(--surface);border-radius:3px;height:14px;overflow:hidden" role="presentation">
                  <div :style="{ width: bar.pct + '%', height:'100%', background: bar.color, borderRadius:'3px' }"></div>
                </div>
                <span style="color:var(--muted)">{{ bar.count }}</span>
              </div>
              <!-- Text summary for accessibility -->
              <!-- <details style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem">
                <summary>Difficulty data table</summary>
                <table style="width:100%;border-collapse:collapse;margin-top:0.4rem">
                  <thead><tr><th style="text-align:left;font-weight:600">Rating</th><th style="text-align:right;font-weight:600">Count</th></tr></thead>
                  <tbody>
                    <tr v-for="bar in diffBars" :key="'tr-' + bar.label">
                      <td>{{ bar.label }}</td><td style="text-align:right">{{ bar.count }}</td>
                    </tr>
                  </tbody>
                </table>
              </details> -->
            </template>
          </section>
        </div>

        <!-- Practice calendar -->
        <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem;margin-bottom:2rem"
                 aria-label="Practice calendar — last 52 weeks">
          <h2 style="font-size:1rem;margin:0 0 0.75rem">Practice Calendar (last 52 weeks)</h2>
          <div v-if="!calendarCells" style="color:var(--muted);font-size:0.9rem">No submission data yet.</div>
          <template v-else>
            <div style="overflow-x:auto">
              <svg
                :viewBox="`0 0 ${53 * 13 + 2} ${7 * 13 + 2}`"
                style="display:block;min-width:400px"
                role="img"
                aria-label="Practice heatmap calendar"
              >
                <g v-for="cell in calendarCells" :key="`${cell.wi}-${cell.di}`">
                  <rect
                    :x="cell.wi * 13"
                    :y="cell.di * 13"
                    width="11"
                    height="11"
                    rx="2"
                    :fill="cell.count < 0 ? 'transparent' : calColor(cell.count)"
                  >
                    <title v-if="cell.date">{{ cell.date }}: {{ cell.count }} submission{{ cell.count !== 1 ? 's' : '' }}</title>
                  </rect>
                </g>
              </svg>
            </div>
            <!-- Calendar legend -->
            <div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.5rem;font-size:0.75rem;color:var(--muted)">
              <span>Less</span>
              <span v-for="(c, i) in CALENDAR_LEGEND" :key="i"
                    :style="{ width:'12px', height:'12px', background:c, borderRadius:'2px', display:'inline-block' }" aria-hidden="true"></span>
              <span>More</span>
            </div>
          </template>
        </section>

        <!-- Language usage -->
        <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem;margin-bottom:2rem"
                 aria-label="Language usage">
          <h2 style="font-size:1rem;margin:0 0 0.75rem">Language Usage</h2>
          <div v-if="!cfRefs.analytics.value?.languageUsage?.length" style="color:var(--muted);font-size:0.9rem">No data yet.</div>
          <ul v-else style="list-style:none;padding:0;margin:0;font-size:0.85rem;display:flex;flex-wrap:wrap;gap:0.5rem">
            <li
              v-for="l in cfRefs.analytics.value.languageUsage.slice(0, 10)"
              :key="l.language"
              style="background:var(--surface);padding:0.25rem 0.6rem;border-radius:12px;color:var(--text)"
            >
              {{ l.language }}: <strong>{{ l.count }}</strong>
            </li>
          </ul>
        </section>

      </template>
    </template>
  </main>
</template>

<style scoped>
.contest-section {
  margin-bottom: 1.5rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 1rem 0;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.section-heading h2 {
  margin: 0;
  font-size: 1rem;
}

.section-heading p {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.75rem;
}

.section-heading button {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.3rem 0.65rem;
  cursor: pointer;
}

.contest-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 0.6rem;
}

.contest-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem 0.75rem;
  border-left: 3px solid var(--accent);
  background: var(--surface);
  padding: 0.7rem 0.8rem;
  color: var(--text);
  text-decoration: none;
}

.contest-item strong {
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
  font-size: 0.88rem;
}

.contest-date,
.contest-duration,
.contest-state {
  color: var(--muted);
  font-size: 0.75rem;
}

.contest-duration {
  text-align: right;
}

.contest-error {
  color: var(--danger);
}
</style>
