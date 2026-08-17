<script setup lang="ts">
/**
 * Admin Ops — Phase 7.
 * Job 1 (leaderboard refresh) status + retry trigger.
 * Job 2 (solved sync) status + per-user force resync.
 * Handle reconciliation queue with recheck / unlink actions.
 * Stats section.
 */
import { ref, onMounted } from 'vue';
import {
  fetchLeaderboardJobStatus, retryLeaderboardJob,
  fetchSolvedSyncJobStatus, forceResyncUser,
  fetchHandleIssues, recheckHandle, clearAdminCfLink,
  fetchAdminStats,
  type HandleIssueResponse, type AdminStatsResponse,
} from '@/api/index.ts';
import type { JobRunSummary } from '@contracts';
import { ApiError } from '@/api/index.ts';

// ── State ──────────────────────────────────────────────────────────────────
const lbRuns = ref<JobRunSummary[]>([]);
const solvedRuns = ref<JobRunSummary[]>([]);
const handleIssues = ref<HandleIssueResponse[]>([]);
const stats = ref<AdminStatsResponse | null>(null);
const loadError = ref<string | null>(null);

async function loadAll() {
  loadError.value = null;
  const [lb, solved, issues, st] = await Promise.allSettled([
    fetchLeaderboardJobStatus(),
    fetchSolvedSyncJobStatus(),
    fetchHandleIssues(),
    fetchAdminStats(),
  ]);
  if (lb.status === 'fulfilled') lbRuns.value = lb.value.data.runs;
  if (solved.status === 'fulfilled') solvedRuns.value = solved.value.data.runs;
  if (issues.status === 'fulfilled') handleIssues.value = issues.value.data;
  if (st.status === 'fulfilled') stats.value = st.value.data;

  const failures = [lb, solved, issues, st]
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason instanceof Error ? result.reason.message : 'Request failed.');
  if (failures.length) loadError.value = `Some operations data could not be loaded: ${failures.join(' ')}`;
}

onMounted(loadAll);

// ── LB retry ──────────────────────────────────────────────────────────────
const retrying = ref(false);
const retryMsg = ref<string | null>(null);
const retryFailed = ref(false);

async function doRetry() {
  retrying.value = true; retryMsg.value = null; retryFailed.value = false;
  try {
    const res = await retryLeaderboardJob();
    retryMsg.value = res.data.message;
    setTimeout(() => { retryMsg.value = null; loadAll(); }, 3000);
  } catch (e) { retryFailed.value = true; retryMsg.value = e instanceof Error ? e.message : 'Failed.'; }
  finally { retrying.value = false; }
}

// ── Force resync ──────────────────────────────────────────────────────────
const resyncingUser = ref<number | null>(null);
const resyncMsg = ref<string | null>(null);
const resyncFailed = ref(false);

async function doResync(userId: number) {
  resyncingUser.value = userId; resyncMsg.value = null; resyncFailed.value = false;
  try {
    const res = await forceResyncUser(userId);
    resyncMsg.value = res.data.message;
    setTimeout(() => { resyncMsg.value = null; }, 4000);
  } catch (e) { resyncFailed.value = true; resyncMsg.value = e instanceof Error ? e.message : 'Failed.'; }
  finally { resyncingUser.value = null; }
}

// ── Handle recheck ────────────────────────────────────────────────────────
const recheckingUser = ref<number | null>(null);

async function doRecheck(userId: number) {
  recheckingUser.value = userId;
  try {
    await recheckHandle(userId);
    handleIssues.value = handleIssues.value.filter((h) => h.userId !== userId);
  } catch (e) { alert(e instanceof Error ? e.message : 'Failed.'); }
  finally { recheckingUser.value = null; }
}

async function doUnlinkHandle(userId: number, handle: string) {
  if (!confirm(`Unlink handle "${handle}"? The user can re-link a different handle.`)) return;
  try {
    await clearAdminCfLink(userId);
    handleIssues.value = handleIssues.value.filter((h) => h.userId !== userId);
  } catch (e) { alert(e instanceof Error ? e.message : 'Failed.'); }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDur(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function jobStatusStyle(s: string): string {
  if (s === 'OK') return 'color:var(--ok);font-weight:600';
  if (s === 'FAILED') return 'color:var(--danger);font-weight:600';
  if (s === 'RUNNING') return 'color:var(--warn);font-weight:600';
  return 'color:var(--muted)';
}
</script>

<template>
  <div>
    <h1 style="margin:0 0 1.5rem;font-size:1.3rem">Operations</h1>

    <div v-if="loadError" role="alert"
         style="background:var(--danger-bg);border-radius:4px;padding:0.75rem;margin-bottom:1rem;font-size:0.9rem">
      {{ loadError }}
      <button style="margin-left:0.75rem;cursor:pointer" @click="loadAll">Retry</button>
    </div>

    <!-- Stats -->
    <section v-if="stats" style="margin-bottom:2rem">
      <h2 style="font-size:1rem;margin:0 0 0.75rem">Summary</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.75rem">
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:0.9rem;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:var(--text)">{{ stats.totalUsers }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">Total Users</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:0.9rem;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:var(--ok)">{{ stats.activeUsers }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">Active</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:0.9rem;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:var(--accent)">{{ stats.linkedUsers }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">CF Linked</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:0.9rem;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:var(--warn)">{{ stats.pendingUsers }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">Pending</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:0.9rem;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:var(--danger)">{{ stats.suspendedUsers }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">Suspended</div>
        </div>
      </div>
      <!-- Signups chart (text-based) -->
      <div v-if="stats.signupsLast7d.length" style="margin-top:1rem">
        <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.4rem">Sign-ups last 7 days:</div>
        <div style="display:flex;gap:0.5rem;align-items:flex-end;height:60px">
          <div v-for="d in stats.signupsLast7d" :key="d.date"
               style="display:flex;flex-direction:column;align-items:center;flex:1;gap:0.2rem">
            <span style="font-size:0.7rem;color:var(--muted)">{{ d.count }}</span>
            <div :style="{
              width:'100%', background:'var(--accent)', borderRadius:'2px 2px 0 0',
              height: d.count > 0 ? Math.max(4, d.count * 4) + 'px' : '2px',
              opacity: d.count > 0 ? 1 : 0.2
            }"></div>
            <span style="font-size:0.65rem;color:var(--muted);white-space:nowrap">{{ d.date.slice(5) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Job 1: Leaderboard refresh -->
    <section style="margin-bottom:2rem;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
        <h2 style="font-size:1rem;margin:0">Job 1: Leaderboard Refresh</h2>
        <div style="display:flex;align-items:center;gap:0.75rem">
          <span v-if="retryMsg" :style="retryFailed ? 'color:var(--danger)' : 'color:var(--ok)'"
                style="font-size:0.8rem">{{ retryMsg }}</span>
          <button :disabled="retrying"
                  style="padding:0.3rem 0.7rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer;font-size:0.85rem"
                  @click="doRetry">
            {{ retrying ? 'Triggering…' : 'Trigger refresh' }}
          </button>
        </div>
      </div>
      <div v-if="!lbRuns.length" style="color:var(--muted);font-size:0.85rem">No recent runs.</div>
      <table v-else style="width:100%;border-collapse:collapse;font-size:0.8rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid var(--line)">
            <th style="padding:0.4rem" scope="col">Started</th>
            <th style="padding:0.4rem" scope="col">Status</th>
            <th style="padding:0.4rem" scope="col">Duration</th>
            <th style="padding:0.4rem" scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in lbRuns" :key="r.id" style="border-bottom:1px solid var(--surface)">
            <td style="padding:0.4rem;color:var(--muted)">{{ fmtTime(r.startedAt) }}</td>
            <td style="padding:0.4rem" :style="jobStatusStyle(r.status)">{{ r.status }}</td>
            <td style="padding:0.4rem;color:var(--muted)">{{ fmtDur(r.durationMs) }}</td>
            <td style="padding:0.4rem;color:var(--muted);font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <span v-if="r.detail">
                req={{ (r.detail as Record<string,unknown>).handlesRequested }},
                upd={{ (r.detail as Record<string,unknown>).handlesUpdated }},
                stale={{ (r.detail as Record<string,unknown>).handlesStale }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Job 2: Solved sync -->
    <section style="margin-bottom:2rem;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <h2 style="font-size:1rem;margin:0">Job 2: Solved-Count Sync</h2>
        <button style="padding:0.3rem 0.7rem;border:1px solid var(--line);border-radius:4px;cursor:pointer;font-size:0.85rem"
                @click="loadAll">Refresh</button>
      </div>
      <div v-if="!solvedRuns.length" style="color:var(--muted);font-size:0.85rem">No recent runs.</div>
      <table v-else style="width:100%;border-collapse:collapse;font-size:0.8rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid var(--line)">
            <th style="padding:0.4rem" scope="col">Started</th>
            <th style="padding:0.4rem" scope="col">Status</th>
            <th style="padding:0.4rem" scope="col">Duration</th>
            <th style="padding:0.4rem" scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in solvedRuns" :key="r.id" style="border-bottom:1px solid var(--surface)">
            <td style="padding:0.4rem;color:var(--muted)">{{ fmtTime(r.startedAt) }}</td>
            <td style="padding:0.4rem" :style="jobStatusStyle(r.status)">{{ r.status }}</td>
            <td style="padding:0.4rem;color:var(--muted)">{{ fmtDur(r.durationMs) }}</td>
            <td style="padding:0.4rem;color:var(--muted);font-size:0.75rem">
              <span v-if="r.detail">
                synced={{ (r.detail as Record<string,unknown>).usersSynced }},
                newSolved={{ (r.detail as Record<string,unknown>).newSolved }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="resyncMsg" :style="{ color: resyncFailed ? 'var(--danger)' : 'var(--ok)' }"
           style="margin-top:0.5rem;font-size:0.8rem">{{ resyncMsg }}</div>
    </section>

    <!-- Handle reconciliation queue -->
    <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1rem">
      <h2 style="font-size:1rem;margin:0 0 0.75rem">Handle Issues</h2>
      <div v-if="!handleIssues.length" style="color:var(--muted);font-size:0.85rem">No handle issues. ✓</div>
      <table v-else style="width:100%;border-collapse:collapse;font-size:0.8rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid var(--line)">
            <th style="padding:0.4rem" scope="col">User</th>
            <th style="padding:0.4rem" scope="col">Handle</th>
            <th style="padding:0.4rem" scope="col">Issue</th>
            <th style="padding:0.4rem" scope="col">Last checked</th>
            <th style="padding:0.4rem" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in handleIssues" :key="h.userId" style="border-bottom:1px solid var(--surface)">
            <td style="padding:0.4rem;font-weight:500">{{ h.displayName }}</td>
            <td style="padding:0.4rem;font-family:monospace">{{ h.handle }}</td>
            <td style="padding:0.4rem;color:var(--danger);font-size:0.75rem">{{ h.cfStatus }}</td>
            <td style="padding:0.4rem;color:var(--muted);font-size:0.75rem">{{ fmtTime(h.lastCheckedAt) }}</td>
            <td style="padding:0.4rem;white-space:nowrap">
              <button style="font-size:0.7rem;cursor:pointer;padding:0.15rem 0.4rem;border:1px solid var(--line);border-radius:3px;margin-right:0.25rem"
                      :disabled="recheckingUser===h.userId"
                      @click="doRecheck(h.userId)">
                {{ recheckingUser===h.userId ? '…' : 'Recheck' }}
              </button>
              <button style="font-size:0.7rem;cursor:pointer;padding:0.15rem 0.4rem;border:1px solid var(--danger);border-radius:3px;color:var(--danger)"
                      @click="doUnlinkHandle(h.userId, h.handle)">Unlink</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
