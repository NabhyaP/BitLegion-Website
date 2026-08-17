<script setup lang="ts">
/**
 * Teams page — Phase 6.
 * Club org chart: a roster section per team, one row per member.
 * Uses TanStack Query for server state. §0.3: no logic in template.
 */
import { useQuery } from '@tanstack/vue-query';
import { fetchTeams, queryKeys } from '@/api/index.ts';

const {
  data: teams,
  isLoading,
  error,
} = useQuery({
  queryKey: queryKeys.teams,
  queryFn: fetchTeams,
  staleTime: 5 * 60 * 1000,
});

/** Two-letter fallback when a member has no photo. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

const pad = (n: number) => String(n + 1).padStart(2, '0');
</script>

<template>
  <main class="teams">
    <header>
      <div>
        <p class="eyebrow">Roster</p>
        <h1>Club Teams</h1>
      </div>
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/leaderboard">Leaderboard</RouterLink>
      </nav>
    </header>

    <div v-if="isLoading" aria-live="polite" role="status" class="state">Loading teams…</div>

    <div v-else-if="error" role="alert" class="state error">Could not load teams.</div>

    <div v-else-if="!teams?.length" class="state">No teams configured yet.</div>

    <template v-else>
      <section v-for="team in teams" :key="team.id" :aria-label="team.name">
        <div class="team-head">
          <h2>{{ team.name }}</h2>
          <span class="count">{{ team.members.length }}</span>
        </div>

        <ul class="roster">
          <li v-for="(member, i) in team.members" :key="member.id">
            <span class="idx" aria-hidden="true">{{ pad(i) }}</span>

            <span class="avatar">
              <img
                v-if="member.photoUrl"
                :src="member.photoUrl"
                :alt="`${member.name} photo`"
                width="40"
                height="40"
                loading="lazy"
              />
              <span v-else aria-hidden="true">{{ initials(member.name) }}</span>
            </span>

            <span class="who">
              <span class="name">{{ member.name }}</span>
              <span class="role">{{ member.roleTitle }}</span>
            </span>

            <!-- CF handle → the member's actual Codeforces profile.
                 Not an internal /profile/ link: team members need not be registered
                 users here, so that route 404s for anyone added manually. -->
            <a
              v-if="member.cfHandle"
              class="handle"
              :href="`https://codeforces.com/profile/${encodeURIComponent(member.cfHandle)}`"
              target="_blank"
              rel="noopener noreferrer"
              :title="`${member.cfHandle} on Codeforces (opens in a new tab)`"
            >
              {{ member.cfHandle }}<span aria-hidden="true"> ↗</span>
            </a>
            <span v-else class="handle empty" aria-hidden="true">—</span>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped>
.teams {
  max-width: 62rem;
  margin: 0 auto;
  padding: 3rem clamp(1rem, 4vw, 2rem) 5rem;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 3rem;
}
.eyebrow {
  margin: 0 0 0.4rem;
  font-size: 0.68rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
}
nav {
  display: flex;
  gap: 1.5rem;
  font-size: 0.8rem;
}

.state {
  text-align: center;
  padding: 4rem 1rem;
  color: var(--muted);
}
.state.error {
  color: var(--danger);
  background: var(--danger-bg);
  border: 1px solid var(--danger);
  border-radius: 4px;
  padding: 1rem;
}

section {
  margin-bottom: 3rem;
}
.team-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.6rem;
  margin-bottom: 0.25rem;
}
.team-head h2 {
  margin: 0;
  font-size: 0.8rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.count {
  font-size: 0.7rem;
  color: var(--muted);
}

.roster {
  list-style: none;
  margin: 0;
  padding: 0;
}
.roster li {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 0.5rem;
  border-bottom: 1px solid var(--line);
  transition: background 0.15s;
}
.roster li:hover {
  background: var(--surface);
}

.idx {
  font-size: 0.7rem;
  color: var(--muted);
  min-width: 1.6rem;
}

.avatar {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  color: var(--muted);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.name {
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role {
  font-size: 0.72rem;
  color: var(--muted);
}

.handle {
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
}
.handle:hover {
  color: var(--text);
}
.handle.empty {
  opacity: 0.35;
}

@media (max-width: 34rem) {
  .idx {
    display: none;
  }
}
</style>
