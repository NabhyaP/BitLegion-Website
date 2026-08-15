/**
 * Session store (Pinia) — replaces the module-level refs in auth/useMe.ts.
 *
 * Single source of truth for: who is signed in, their roles, their CF link status.
 * Components and composables read from this store; never call /me directly.
 * §0.3: all data fetching in composables/stores, never in .vue templates.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { fetchMe, patchMe, logout as apiLogout, invalidateCsrfToken } from '@/api/index.ts';
import type { MeResponse } from '@contracts';

export const useSessionStore = defineStore('session', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const me = ref<MeResponse | null>(null);
  const loading = ref(false);
  /** null = not yet checked, true/false = known */
  const signedIn = ref<boolean | null>(null);
  const error = ref<string | null>(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const isAdmin = computed(() =>
    (me.value?.roles ?? []).some((r: string) => r === 'ADMIN' || r === 'SUPERADMIN'),
  );

  const hasCfLink = computed(
    () => me.value?.codeforces != null && me.value.codeforces.status === 'ACTIVE',
  );

  const cfHandle = computed(() =>
    me.value?.codeforces?.status === 'ACTIVE' ? me.value.codeforces.handle : null,
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Load /me. Cached unless force=true. Called by the router guard and App.vue. */
  async function load(force = false): Promise<MeResponse | null> {
    if (me.value && !force) return me.value;
    loading.value = true;
    error.value = null;
    try {
      const data = await fetchMe();
      me.value = data;
      signedIn.value = true;
      return data;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        me.value = null;
        signedIn.value = false;
        return null;
      }
      error.value = err instanceof Error ? err.message : 'Failed to load session.';
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function patch(body: Parameters<typeof patchMe>[0]): Promise<MeResponse> {
    const data = await patchMe(body);
    me.value = data;
    return data;
  }

  async function logout(): Promise<void> {
    await apiLogout();
    invalidateCsrfToken();   // session changed — old token is dead
    me.value = null;
    signedIn.value = false;
  }

  /** Called by router after CF link completes to refresh the session. */
  function invalidate(): void {
    me.value = null;
    signedIn.value = null;
  }

  return {
    me,
    loading,
    signedIn,
    error,
    isAdmin,
    hasCfLink,
    cfHandle,
    load,
    patch,
    logout,
    invalidate,
  };
});
