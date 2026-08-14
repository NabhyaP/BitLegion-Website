<script setup lang="ts">
import { useMe } from '../auth/useMe.ts';
const { me, load, logout } = useMe();
load();
</script>

<template>
  <!-- Placeholder: the real dashboard (CF widgets) is Phase 6. -->
  <h2>Dashboard</h2>
  <p v-if="me">
    Signed in as {{ me.displayName }} ({{ me.branch ?? '—' }}, batch {{ me.batchYear ?? '—' }}).
  </p>
  <p>Codeforces linking arrives in Phase 2.</p>
  <button @click="logout().then(() => $router.push('/login'))">Sign out</button>
</template>
