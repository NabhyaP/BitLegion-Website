import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Hello from './pages/Hello.vue';
import CfSpike from './pages/CfSpike.vue';
import Login from './pages/Login.vue';
import { useMe } from './auth/useMe.ts';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Hello },
    { path: '/login', component: Login },
    { path: '/spike/cf', component: CfSpike },
    // Lazy: keeps the login path's bundle small (§B4 route-level code splitting).
    {
      path: '/onboarding',
      component: () => import('./pages/Onboarding.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/dashboard',
      component: () => import('./pages/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', component: Hello },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const { load } = useMe();
  const me = await load();
  if (!me) return { path: '/login', query: { returnTo: to.fullPath } };
  // Server still enforces everything; this only saves a round trip.
  if (!me.profileConfirmed && to.path !== '/onboarding') return '/onboarding';
  return true;
});

createApp(App).use(router).mount('#app');
