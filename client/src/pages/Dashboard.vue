<script setup lang="ts">
/**
 * Dashboard — Phase 5 version.
 * Starts the CF data fetch cycle using the coordinator.
 * Displays reactive state from the coordinator refs.
 * Full widget UI (charts, calendar, donut) is Phase 6.
 * §0.3: zero business logic in this template — all in coordinator/store.
 */
import { onMounted, watch } from 'vue';
import { useSessionStore } from '@/stores/session.ts';
import { getHandleRefs, refresh } from '@/codeforces/coordinator.ts';
import { isStorageUnavailable } from '@/codeforces/cache.ts';

const session = useSessionStore();

// Reactive CF state — only populated once we know the handle
const cfHandle = session.cfHandle;
const cfRefs = cfHandle ? getHandleRefs(cfHandle) : null;

onMounted(async () => {
  await session.load();
  const handle = session.cfHandle;
  if (handle) {
    // Non-blocking: start fetching CF data
    refresh(handle);
  }
});

// If CF handle changes mid-session (rare but possible), restart
watch(
  () => session.cfHandle,
  (newHandle) => {
    if (newHandle) refresh(newHandle);
  },
);
</script>

<template>
  <main style="padding:2rem;max-width:64rem;margin:0 auto">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h1>Dashboard</h1>
      <div style="display:flex;gap:1rem;align-items:center">
        <span v-if="session.me">{{ session.me.displayName }}</span>
        <RouterLink to="/settings">Settings</RouterLink>
        <button @click="session.logout().then(() => $router.push('/login'))">Sign out</button>
      </div>
    </header>

    <!-- Storage unavailable notice (§C4) -->
    <div
      v-if="isStorageUnavailable()"
      role="alert"
      style="background:#fef3c7;border:1px solid #d97706;padding:0.75rem;border-radius:4px;margin-bottom:1rem"
    >
      IndexedDB is not available. Codeforces data will be lost on page reload.
    </div>

    <!-- No CF link -->
    <section v-if="!session.hasCfLink" style="background:#f8fafc;padding:1.5rem;border-radius:4px">
      <p>Your Codeforces handle is not linked yet.</p>
      <RouterLink to="/onboarding">Link Codeforces →</RouterLink>
    </section>

    <!-- CF data section -->
    <template v-else-if="cfRefs">
      <!-- Rate-limited notice (§C4) -->
      <div
        v-if="cfRefs.status.value === 'rate-limited'"
        role="alert"
        style="background:#fee2e2;border:1px solid #dc2626;padding:0.75rem;border-radius:4px;margin-bottom:1rem"
      >
        Codeforces rate limit reached. Your data is cached.
        <button style="margin-left:1rem" @click="refresh(session.cfHandle!)">Retry</button>
        <small style="display:block;margin-top:0.25rem">
          Note: Many students on the same network share CF's rate limit.
        </small>
      </div>

      <!-- CF unavailable notice (§C4) -->
      <div
        v-if="cfRefs.status.value === 'cf-unavailable'"
        role="alert"
        style="background:#fef3c7;padding:0.75rem;border-radius:4px;margin-bottom:1rem"
      >
        Codeforces is currently unavailable. Showing cached data.
      </div>

      <!-- First visit, no cache (§C4) -->
      <div v-if="cfRefs.status.value === 'loading' && !cfRefs.profile.value" style="padding:1rem">
        Loading Codeforces data for <strong>{{ session.cfHandle }}</strong>…
      </div>

      <!-- Stat row (Phase 6 adds real widgets) -->
      <template v-else-if="cfRefs.profile.value">
        <div
          style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem"
        >
          <div style="background:#f8fafc;padding:1rem;border-radius:4px;text-align:center">
            <div style="font-size:1.5rem;font-weight:700">{{ cfRefs.profile.value.rating }}</div>
            <div style="font-size:0.8rem;color:#64748b">Current Rating</div>
          </div>
          <div style="background:#f8fafc;padding:1rem;border-radius:4px;text-align:center">
            <div style="font-size:1.5rem;font-weight:700">{{ cfRefs.profile.value.maxRating }}</div>
            <div style="font-size:0.8rem;color:#64748b">Max Rating</div>
          </div>
          <div style="background:#f8fafc;padding:1rem;border-radius:4px;text-align:center">
            <div style="font-size:1.5rem;font-weight:700">
              {{ cfRefs.analytics.value?.uniqueAccepted ?? '—' }}
            </div>
            <div style="font-size:0.8rem;color:#64748b">Problems Solved</div>
          </div>
          <div style="background:#f8fafc;padding:1rem;border-radius:4px;text-align:center">
            <div style="font-size:1.5rem;font-weight:700">{{ cfRefs.ratings.value.length }}</div>
            <div style="font-size:0.8rem;color:#64748b">Contests</div>
          </div>
        </div>

        <!-- Freshness label (§B4 "updated at labels on all CF-derived data") -->
        <p style="font-size:0.8rem;color:#94a3b8;margin-bottom:1rem">
          <template v-if="cfRefs.stale.value">⚠ Data may be stale — </template>
          <template v-else-if="cfRefs.lastSuccessAt.value">
            Updated {{ new Date(cfRefs.lastSuccessAt.value).toLocaleTimeString() }} —
          </template>
          <button
            :disabled="cfRefs.status.value === 'loading' || cfRefs.status.value === 'revalidating'"
            style="font-size:0.8rem;cursor:pointer"
            @click="refresh(session.cfHandle!)"
          >
            {{ cfRefs.status.value === 'revalidating' ? 'Refreshing…' : 'Refresh' }}
          </button>
        </p>

        <!-- Phase 6 placeholder widgets -->
        <div style="color:#64748b;font-style:italic">
          Full charts and analytics coming in Phase 6.
        </div>
      </template>
    </template>
  </main>
</template>
