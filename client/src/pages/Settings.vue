<script setup lang="ts">
// Phase 6: settings page (display name, CF link status, unlink, clear local data)
import { useSessionStore } from '@/stores/session.ts';
import { clearLocalData } from '@/codeforces/coordinator.ts';

const session = useSessionStore();

async function handleClearData() {
  const handle = session.cfHandle;
  if (!handle) return;
  await clearLocalData(handle);
  alert('Local Codeforces data cleared.');
}
</script>
<template>
  <main style="padding:2rem;max-width:40rem;margin:0 auto">
    <h1>Settings</h1>
    <section>
      <h2>Account</h2>
      <p><strong>Email:</strong> {{ session.me?.collegeEmail }}</p>
      <p><strong>Display name:</strong> {{ session.me?.displayName }}</p>
    </section>
    <section style="margin-top:1.5rem">
      <h2>Codeforces</h2>
      <p v-if="session.hasCfLink">
        Linked: <strong>{{ session.cfHandle }}</strong>
        <RouterLink to="/onboarding" style="margin-left:1rem">Change / Unlink</RouterLink>
      </p>
      <p v-else>No Codeforces handle linked. <RouterLink to="/onboarding">Link now</RouterLink></p>
      <button
        v-if="session.hasCfLink"
        style="margin-top:0.5rem"
        @click="handleClearData"
      >
        Clear local Codeforces data
      </button>
    </section>
    <section style="margin-top:1.5rem">
      <button @click="session.logout().then(() => $router.push('/login'))">Sign out</button>
    </section>
  </main>
</template>
