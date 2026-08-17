<script setup lang="ts">
import { ref } from 'vue';
import AsciiIntro from '@/components/AsciiIntro.vue';
import { useSessionStore } from '@/stores/session.ts';

const session = useSessionStore();

// ponytail: sessionStorage, so the intro plays once per tab, not on every route bounce.
const played = sessionStorage.getItem('introPlayed') === '1';
const showIntro = ref(!played);

function introDone() {
  sessionStorage.setItem('introPlayed', '1');
  showIntro.value = false;
}
</script>

<template>
  <AsciiIntro v-if="showIntro" @done="introDone" />

  <main class="landing">
    <header>
      <span class="mark">BITLEGION</span>
      <nav>
        <RouterLink to="/leaderboard">Leaderboard</RouterLink>
        <RouterLink to="/teams">Teams</RouterLink>
        <RouterLink :to="session.signedIn ? '/dashboard' : '/login'">
          {{ session.signedIn ? 'Dashboard' : 'Sign in' }}
        </RouterLink>
      </nav>
    </header>

    <section class="hero">
      <p class="eyebrow">IIIT Pune — competitive programming club</p>
      <h1>Compete.<br />Climb.<br />Repeat.</h1>
      <p class="sub">
        Codeforces ratings, team standings and solve counts for the legion, synced automatically.
      </p>
      <RouterLink class="cta" :to="session.signedIn ? '/dashboard' : '/login'">
        {{ session.signedIn ? 'Open dashboard' : 'Sign in with college account' }} →
      </RouterLink>
    </section>

    <footer>
      <span>a001 — BitLegion</span>
      <span>IIIT Pune</span>
    </footer>
  </main>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: #0a0a0a;
  color: #e8e8e8;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  display: flex;
  flex-direction: column;
  padding: 1.5rem clamp(1rem, 5vw, 4rem);
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  letter-spacing: 0.12em;
}
.mark {
  font-weight: 700;
}
nav {
  display: flex;
  gap: clamp(1rem, 3vw, 2.5rem);
}
a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.25s;
}
a:hover,
a:focus-visible {
  border-color: currentColor;
}

.hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 46rem;
  padding: 4rem 0;
}
.eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #7a7a7a;
  margin: 0 0 1.5rem;
}
h1 {
  margin: 0;
  font-size: clamp(2.75rem, 11vw, 7.5rem);
  line-height: 0.92;
  letter-spacing: -0.03em;
  font-weight: 500;
}
.sub {
  margin: 2rem 0 0;
  max-width: 34rem;
  color: #9a9a9a;
  line-height: 1.6;
  font-size: 0.95rem;
}
.cta {
  margin-top: 2.5rem;
  align-self: flex-start;
  border: 1px solid #333;
  padding: 0.85rem 1.5rem;
  font-size: 0.85rem;
  letter-spacing: 0.08em;
}
.cta:hover,
.cta:focus-visible {
  background: #e8e8e8;
  color: #0a0a0a;
  border-color: #e8e8e8;
}

footer {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #1e1e1e;
  padding-top: 1.25rem;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: #6a6a6a;
}
</style>
