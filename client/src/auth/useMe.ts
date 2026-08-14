// Session state + all /me fetching. Templates never call fetch directly (§0.3).
// ponytail: a module-level ref, not Pinia — Phase 5 swaps in the real store if it needs more.
import { ref } from 'vue';

export type Me = {
  id: number;
  displayName: string;
  collegeEmail: string;
  rollNo: string | null;
  batchYear: number | null;
  branch: string | null;
  status: string;
  profileConfirmed: boolean;
  roles: string[];
  codeforces: unknown | null;
};

const me = ref<Me | null>(null);
const loading = ref(false);
/** null = not checked yet, true/false = known. */
const signedIn = ref<boolean | null>(null);

async function load(force = false): Promise<Me | null> {
  if (me.value && !force) return me.value;
  loading.value = true;
  try {
    const res = await fetch('/api/v1/me', { credentials: 'same-origin' });
    if (res.status === 401 || res.status === 403) {
      me.value = null;
      signedIn.value = false;
      return null;
    }
    const body = await res.json();
    me.value = body.data as Me;
    signedIn.value = true;
    return me.value;
  } finally {
    loading.value = false;
  }
}

async function patch(patchBody: Record<string, unknown>): Promise<Me> {
  const res = await fetch('/api/v1/me', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? 'Update failed.');
  me.value = body.data as Me;
  return me.value;
}

async function logout(): Promise<void> {
  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
  me.value = null;
  signedIn.value = false;
}

export function useMe() {
  return { me, loading, signedIn, load, patch, logout };
}
