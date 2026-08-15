<script setup lang="ts">
/**
 * Teams page — Phase 6.
 * Displays club org chart: sections per team, member cards with photo/name/role/handle.
 * Uses TanStack Query for server state. §0.3: no logic in template.
 */
import { useQuery } from '@tanstack/vue-query';
import { fetchTeams, queryKeys } from '@/api/index.ts';
import { rankInfo } from '@/utils/rankColor.ts';

const { data: teams, isLoading, error } = useQuery({
  queryKey: queryKeys.teams,
  queryFn: fetchTeams,
  staleTime: 5 * 60 * 1000,
});
</script>

<template>
  <main style="padding:2rem;max-width:72rem;margin:0 auto">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem">
      <h1 style="margin:0">Club Teams</h1>
      <div style="display:flex;gap:1rem;font-size:0.9rem">
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/leaderboard">Leaderboard</RouterLink>
      </div>
    </header>

    <div v-if="isLoading" aria-live="polite" role="status" style="text-align:center;padding:3rem;color:#94a3b8">
      Loading teams…
    </div>

    <div v-else-if="error" role="alert"
         style="background:#fee2e2;border-radius:4px;padding:1rem;color:#7f1d1d">
      Could not load teams.
    </div>

    <div v-else-if="!teams?.length" style="text-align:center;padding:3rem;color:#94a3b8">
      No teams configured yet.
    </div>

    <template v-else>
      <section
        v-for="team in teams"
        :key="team.id"
        style="margin-bottom:2.5rem"
        :aria-label="team.name"
      >
        <h2 style="font-size:1.1rem;margin:0 0 1rem;border-bottom:1px solid #e2e8f0;padding-bottom:0.5rem">
          {{ team.name }}
        </h2>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem">
          <article
            v-for="member in team.members"
            :key="member.id"
            style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:1rem;text-align:center"
          >
            <!-- Photo -->
            <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;margin:0 auto 0.75rem;background:#e2e8f0;display:flex;align-items:center;justify-content:center">
              <img
                v-if="member.photoUrl"
                :src="member.photoUrl"
                :alt="`${member.name} photo`"
                width="64" height="64"
                style="object-fit:cover;width:100%;height:100%"
                loading="lazy"
              />
              <span v-else style="font-size:1.5rem;color:#94a3b8" aria-hidden="true">👤</span>
            </div>

            <!-- Name -->
            <div style="font-weight:600;font-size:0.9rem;color:#1e293b;margin-bottom:0.25rem">
              {{ member.name }}
            </div>

            <!-- Role title -->
            <div style="font-size:0.8rem;color:#64748b;margin-bottom:0.4rem">
              {{ member.roleTitle }}
            </div>

            <!-- CF handle (rank-colored) -->
            <div v-if="member.cfHandle" style="font-size:0.8rem">
              <RouterLink
                :to="`/profile/${member.cfHandle}`"
                :style="{ color: rankInfo(0).color, textDecoration:'none', fontWeight:600 }"
                style="color:inherit"
              >
                {{ member.cfHandle }}
              </RouterLink>
            </div>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>
