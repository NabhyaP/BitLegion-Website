/**
 * Router — extracted from main.ts so it can be imported independently (e.g. in tests).
 *
 * Route-level code splitting for all pages except Login (§B4: "keeps the login path's bundle small").
 * Guards: requiresAuth → redirect to /login; requiresNoAuth → redirect to /dashboard if signed in.
 * Profile confirmation: unconfirmed users are sent to /onboarding except from /onboarding itself.
 * Admin guard: /admin/** requires ADMIN or SUPERADMIN role.
 *
 * Server enforces everything; guards only save a round-trip (§G).
 */
import { createRouter, createWebHistory } from 'vue-router';
import { useSessionStore } from '@/stores/session.ts';
import Login from '@/pages/Login.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Public — eager-loaded (tiny, always needed)
    { path: '/login', component: Login, meta: { requiresNoAuth: true } },

    // Auth required — lazy (§B4 route-level code splitting)
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/onboarding',
      component: () => import('@/pages/Onboarding.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/dashboard',
      component: () => import('@/pages/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/leaderboard',
      component: () => import('@/pages/Leaderboard.vue'),
    },
    {
      path: '/teams',
      component: () => import('@/pages/Teams.vue'),
    },
    {
      path: '/profile/:handle',
      component: () => import('@/pages/Profile.vue'),
    },
    {
      path: '/settings',
      component: () => import('@/pages/Settings.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin',
      component: () => import('@/pages/admin/AdminLayout.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        { path: '', redirect: '/admin/settings' },
        { path: 'settings', component: () => import('@/pages/admin/AdminSettings.vue') },
        { path: 'members', component: () => import('@/pages/admin/AdminMembers.vue') },
        { path: 'teams', component: () => import('@/pages/admin/AdminTeams.vue') },
        { path: 'ops', component: () => import('@/pages/admin/AdminOps.vue') },
        { path: 'audit', component: () => import('@/pages/admin/AdminAudit.vue') },
      ],
    },
    // Phase 0 spikes (kept for reference, not linked in main nav)
    { path: '/spike/cf', component: () => import('@/pages/CfSpike.vue') },
    // Catch-all
    { path: '/:pathMatch(.*)*', component: () => import('@/pages/NotFound.vue') },
  ],
});

// ---------------------------------------------------------------------------
// Navigation guards
// ---------------------------------------------------------------------------

router.beforeEach(async (to) => {
  const session = useSessionStore();

  // Load session if not yet checked
  if (session.signedIn === null) {
    await session.load();
  }

  const authed = session.signedIn === true;

  // requiresNoAuth: signed-in users bounce to dashboard
  if (to.meta.requiresNoAuth && authed) {
    return '/dashboard';
  }

  // requiresAuth: unauthenticated users bounce to login
  if (to.meta.requiresAuth && !authed) {
    return { path: '/login', query: { returnTo: to.fullPath } };
  }

  // Admin guard
  if (to.meta.requiresAdmin && !session.isAdmin) {
    return authed ? '/dashboard' : '/login';
  }

  // Onboarding gate: unconfirmed profile must go through /onboarding first
  if (
    authed &&
    session.me &&
    !session.me.profileConfirmed &&
    to.path !== '/onboarding' &&
    to.meta.requiresAuth
  ) {
    return '/onboarding';
  }

  return true;
});
