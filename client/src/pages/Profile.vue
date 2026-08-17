<script setup lang="ts">
/**
 * Public Profile page — Phase 6.
 * Server-only data (leaderboard snapshot fields). No CF API calls (§B4).
 * 404 for hidden/suspended users — never 403 (§G).
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { fetchProfile, queryKeys } from '@/api/index.ts';
import { rankInfo } from '@/utils/rankColor.ts';
import { ApiError } from '@/api/index.ts';

const route = useRoute();
const handle = computed(() => String(route.params.handle).toLowerCase());

const { data: profile, isLoading, error } = useQuery({
  queryKey: computed(() => queryKeys.profile(handle.value)),
  queryFn: () => fetchProfile(handle.value),
  retry: (count, err) => {
    if (err instanceof ApiError && err.status === 404) return false;
    return count < 2;
  },
  staleTime: 60 * 1000,
});

const is404 = computed(() => error.value instanceof ApiError && (error.value as ApiError).status === 404);

const rankData = computed(() => profile.value ? rankInfo(profile.value.rating) : null);
const maxRankData = computed(() => profile.value ? rankInfo(profile.value.maxRating) : null);

function snapshotAge(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  return `${Math.round(diff / 60)} hr ago`;
}
</script>

<template>
  <main style="padding:2rem;max-width:40rem;margin:0 auto">
    <nav style="font-size:0.9rem;margin-bottom:1.5rem;color:var(--muted)">
      <RouterLink to="/leaderboard">← Leaderboard</RouterLink>
    </nav>

    <!-- Loading -->
    <div v-if="isLoading" aria-live="polite" role="status" style="text-align:center;padding:3rem;color:var(--muted)">
      Loading profile…
    </div>

    <!-- 404 -->
    <div v-else-if="is404" style="text-align:center;padding:3rem">
      <h1 style="font-size:1.5rem;margin-bottom:0.5rem">Profile not found</h1>
      <p style="color:var(--muted)">This user's profile is not available.</p>
      <RouterLink to="/leaderboard" style="margin-top:1rem;display:inline-block">Back to leaderboard</RouterLink>
    </div>

    <!-- Other error -->
    <div v-else-if="error && !is404" role="alert"
         style="background:var(--danger-bg);border-radius:4px;padding:1rem;color:var(--danger)">
      Could not load profile.
    </div>

    <!-- Profile -->
    <template v-else-if="profile">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap">
        <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;background:var(--line);flex-shrink:0">
          <img v-if="profile.avatarUrl" :src="profile.avatarUrl"
               :alt="`${profile.displayName} avatar`"
               width="80" height="80"
               style="object-fit:cover;width:100%;height:100%" />
          <span v-else style="display:flex;align-items:center;justify-content:center;height:100%;font-size:2rem;color:var(--muted)" aria-hidden="true">👤</span>
        </div>
        <div>
          <h1 style="margin:0;font-size:1.4rem;color:var(--text)">{{ profile.displayName }}</h1>
          <div :style="{ color: rankData?.color, fontWeight:600, fontSize:'1rem' }">
            {{ profile.handle }}
          </div>
          <div style="font-size:0.85rem;color:var(--muted);margin-top:0.25rem">
            {{ rankData?.label }}
            <span v-if="profile.batch" style="margin-left:0.5rem">· Batch {{ profile.batch }}</span>
            <span v-if="profile.branch" style="margin-left:0.5rem">· {{ profile.branch }}</span>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
          <div :style="{ fontSize:'1.5rem', fontWeight:700, color: rankData?.color }">{{ profile.rating }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">Rating</div>
        </div>
        <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
          <div :style="{ fontSize:'1.5rem', fontWeight:700, color: maxRankData?.color }">{{ profile.maxRating }}</div>
          <div style="font-size:0.75rem;color:var(--muted)">Max Rating</div>
          <div style="font-size:0.7rem" :style="{ color: maxRankData?.color }">{{ maxRankData?.label }}</div>
        </div>
        <div style="background:var(--surface);padding:1rem;border-radius:6px;text-align:center;border:1px solid var(--line)">
          <div style="font-size:1.5rem;font-weight:700;color:var(--text)">
            <template v-if="profile.solvedCount === null">
              <span title="Syncing — updates daily" style="color:var(--muted)">—</span>
            </template>
            <template v-else>{{ profile.solvedCount }}</template>
          </div>
          <div style="font-size:0.75rem;color:var(--muted)">Solved</div>
        </div>
      </div>

      <!-- Stale notice -->
      <div v-if="profile.stale"
           style="font-size:0.8rem;color:var(--warn);background:var(--warn-bg);border-radius:4px;padding:0.5rem 0.75rem;margin-bottom:1rem">
        ⚠ This data is from a previous snapshot. Updated {{ snapshotAge(profile.profileUpdatedAt) }}.
      </div>
      <div v-else style="font-size:0.75rem;color:var(--muted);margin-bottom:1rem">
        Updated {{ snapshotAge(profile.profileUpdatedAt) }}
      </div>

      <p style="font-size:0.8rem;color:var(--muted)">
        Profile data is sourced from Codeforces and refreshed hourly.
        Personal analytics are only visible on your own <RouterLink to="/dashboard">Dashboard</RouterLink>.
      </p>
    </template>
  </main>
</template>
