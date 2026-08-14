<script setup lang="ts">
import { ref, onMounted } from 'vue';

const health = ref<string>('checking…');

onMounted(async () => {
  try {
    const res = await fetch('/api/v1/health');
    health.value = JSON.stringify(await res.json());
  } catch (err) {
    health.value = `unreachable: ${String(err)}`;
  }
});
</script>

<template>
  <p>Phase 0 bootstrap. Server health:</p>
  <pre>{{ health }}</pre>
</template>
