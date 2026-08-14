import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import App from './App.vue';
import { router } from './router/index.ts';

const pinia = createPinia();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale-while-revalidate: treat data as stale after 60 s
      staleTime: 60_000,
      // Retry once on failure (network blip), but not on 4xx
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

createApp(App)
  .use(pinia)
  .use(router)
  .use(VueQueryPlugin, { queryClient })
  .mount('#app');
