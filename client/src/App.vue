<script setup lang="ts">
import { onMounted } from 'vue';
import { useSessionStore } from '@/stores/session.ts';
import { useQuery } from '@tanstack/vue-query';
import { fetchPublicSettings, queryKeys, prefetchCsrfToken } from '@/api/index.ts';

const session = useSessionStore();

// Warm the session cache and CSRF token on app boot (non-blocking)
onMounted(() => {
  session.load();
  prefetchCsrfToken();
});

// Announcement banner — pulled once, cached 60 s
const { data: settings } = useQuery({
  queryKey: queryKeys.settings,
  queryFn: fetchPublicSettings,
});
</script>

<template>
  <div>
    <!-- Announcement banner (§B3.5 — empty string = hidden) -->
    <div
      v-if="settings?.announcement"
      role="status"
      aria-live="polite"
      style="background:#1e40af;color:#fff;text-align:center;padding:0.5rem 1rem;font-size:0.9rem"
    >
      {{ settings.announcement }}
    </div>

    <RouterView />
  </div>
</template>
