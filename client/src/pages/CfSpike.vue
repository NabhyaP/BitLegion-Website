<script setup lang="ts">
// Phase 0 spike (1): can the browser call the three public CF methods under current CORS behavior?
// Record the result in CONTEXT.md. Runs one call at a time, 2.2s apart (§C2).
import { ref } from 'vue';

const handle = ref('tourist');
const results = ref<{ method: string; ok: boolean; detail: string }[]>([]);
const running = ref(false);

const methods = (h: string) => [
  ['user.info', `https://codeforces.com/api/user.info?handles=${h}`],
  ['user.rating', `https://codeforces.com/api/user.rating?handle=${h}`],
  ['user.status', `https://codeforces.com/api/user.status?handle=${h}&from=1&count=10`],
];

async function run() {
  running.value = true;
  results.value = [];
  for (const [method, url] of methods(handle.value)) {
    try {
      const res = await fetch(url!, { credentials: 'omit' });
      const body = await res.json();
      results.value.push({
        method: method!,
        ok: res.ok && body.status === 'OK',
        detail: `HTTP ${res.status}, envelope ${body.status}, items ${body.result?.length ?? 'n/a'}`,
      });
    } catch (err) {
      results.value.push({ method: method!, ok: false, detail: `blocked/failed: ${String(err)}` });
    }
    await new Promise((r) => setTimeout(r, 2200));
  }
  running.value = false;
}
</script>

<template>
  <h2>Codeforces CORS spike</h2>
  <label>Handle <input v-model="handle" /></label>
  <button :disabled="running" @click="run">{{ running ? 'Running…' : 'Run 3 calls' }}</button>
  <ul>
    <li v-for="r in results" :key="r.method">
      <strong>{{ r.method }}</strong>: {{ r.ok ? 'PASS' : 'FAIL' }} — {{ r.detail }}
    </li>
  </ul>
</template>
