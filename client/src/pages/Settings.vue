<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session.ts';
import { clearLocalData } from '@/codeforces/coordinator.ts';
import { ApiError, unlinkCf } from '@/api/index.ts';

const session = useSessionStore();
const router = useRouter();

// Always reload session on settings page so CF link status is fresh
onMounted(() => session.load(true));

// ── Display name edit ──────────────────────────────────────────────────────
const editing = ref(false);
const displayNameDraft = ref('');
const saving = ref(false);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);

function startEdit() {
  displayNameDraft.value = session.me?.displayName ?? '';
  saveError.value = null;
  saveSuccess.value = false;
  editing.value = true;
}

async function saveDisplayName() {
  const name = displayNameDraft.value.trim();
  if (!name) { saveError.value = 'Name cannot be empty.'; return; }
  saving.value = true;
  saveError.value = null;
  try {
    await session.patch({ displayName: name });
    editing.value = false;
    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  } catch (e) {
    saveError.value = e instanceof ApiError ? e.message : 'Failed to save.';
  } finally {
    saving.value = false;
  }
}

// ── CF unlink ──────────────────────────────────────────────────────────────
const unlinking = ref(false);
const unlinkError = ref<string | null>(null);

async function handleUnlink() {
  if (!confirm('Unlink your Codeforces handle? You can re-link anytime.')) return;
  unlinking.value = true;
  unlinkError.value = null;
  try {
    await unlinkCf();
    const handle = session.cfHandle;
    if (handle) await clearLocalData(handle);
    await session.load(true); // refresh session to clear cfHandle
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && e.message.toLowerCase().includes('sign in')) {
      unlinkError.value = 'Session expired. Please sign out and sign back in, then try again.';
    } else {
      unlinkError.value = e instanceof ApiError ? e.message : 'Failed to unlink.';
    }
  } finally {
    unlinking.value = false;
  }
}

// ── Clear local CF data ────────────────────────────────────────────────────
const clearingData = ref(false);
const clearDone = ref(false);

async function handleClearData() {
  const handle = session.cfHandle;
  if (!handle) return;
  clearingData.value = true;
  await clearLocalData(handle);
  clearingData.value = false;
  clearDone.value = true;
  setTimeout(() => { clearDone.value = false; }, 3000);
}

// ── Sign out ───────────────────────────────────────────────────────────────
async function handleLogout() {
  await session.logout();
  router.push('/login');
}
</script>

<template>
  <main style="padding:2rem;max-width:40rem;margin:0 auto">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h1 style="margin:0">Settings</h1>
      <RouterLink to="/dashboard" style="font-size:0.9rem">← Dashboard</RouterLink>
    </header>

    <!-- Account section -->
    <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1.5rem;margin-bottom:1.5rem">
      <h2 style="font-size:1rem;margin:0 0 1rem">Account</h2>

      <div style="font-size:0.9rem;margin-bottom:0.75rem;color:var(--muted)">
        <strong>Email:</strong> {{ session.me?.collegeEmail ?? '—' }}
      </div>

      <!-- Display name -->
      <div style="font-size:0.9rem;margin-bottom:0.75rem">
        <strong>Display name:</strong>
        <span style="margin-left:0.4rem">{{ session.me?.displayName }}</span>
        <button v-if="!editing"
                style="margin-left:0.75rem;font-size:0.8rem;cursor:pointer;padding:0.2rem 0.6rem;border:1px solid var(--line);border-radius:4px"
                @click="startEdit">Edit</button>
        <form v-if="editing" @submit.prevent="saveDisplayName"
              style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          <input v-model="displayNameDraft" maxlength="100" required
                 :disabled="saving"
                 style="padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem;flex:1;min-width:160px" />
          <button type="submit" :disabled="saving"
                  style="padding:0.35rem 0.8rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" :disabled="saving"
                  style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                  @click="editing=false">Cancel</button>
        </form>
        <div v-if="saveError" role="alert" style="color:var(--danger);font-size:0.8rem;margin-top:0.25rem">{{ saveError }}</div>
        <div v-if="saveSuccess" role="status" style="color:var(--ok);font-size:0.8rem;margin-top:0.25rem">Saved.</div>
      </div>

      <div style="font-size:0.9rem;color:var(--muted)">
        <span><strong>Batch:</strong> {{ session.me?.batchYear ?? '—' }}</span>
        <span style="margin-left:1rem"><strong>Branch:</strong> {{ session.me?.branch ?? '—' }}</span>
      </div>
    </section>

    <!-- Codeforces section -->
    <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1.5rem;margin-bottom:1.5rem">
      <h2 style="font-size:1rem;margin:0 0 1rem">Codeforces</h2>

      <div v-if="session.loading" style="color:var(--muted);font-size:0.9rem">Loading…</div>

      <div v-else-if="session.hasCfLink" style="font-size:0.9rem">
        <div style="margin-bottom:0.75rem">
          <strong>Linked handle:</strong>
          <span style="margin-left:0.5rem;font-weight:600;color:var(--accent)">{{ session.cfHandle }}</span>
        </div>

        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem">
          <!-- Re-link: real navigation to trigger server OAuth -->
          <a href="/api/v1/codeforces/link/start"
             style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;font-size:0.85rem;text-decoration:none;color:var(--text);display:inline-block">
            Re-link
          </a>

          <!-- Unlink -->
          <button :disabled="unlinking"
                  style="padding:0.35rem 0.8rem;border:1px solid var(--danger);color:var(--danger);border-radius:4px;font-size:0.85rem;cursor:pointer;background:var(--surface)"
                  @click="handleUnlink">
            {{ unlinking ? 'Unlinking…' : 'Unlink' }}
          </button>

          <!-- Clear local data -->
          <button :disabled="clearingData"
                  style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;font-size:0.85rem;cursor:pointer;background:var(--surface)"
                  @click="handleClearData">
            {{ clearingData ? 'Clearing…' : 'Clear local data' }}
          </button>
        </div>

        <div v-if="unlinkError" role="alert"
             style="color:var(--danger);font-size:0.8rem;background:var(--danger-bg);border-radius:4px;padding:0.5rem 0.75rem;">
          {{ unlinkError }}
        </div>
        <div v-if="clearDone" role="status" style="color:var(--ok);font-size:0.8rem;margin-top:0.25rem">
          Local data cleared. It will re-fetch on next dashboard visit.
        </div>
      </div>

      <div v-else style="font-size:0.9rem">
        <p style="margin:0 0 0.75rem;color:var(--muted)">No Codeforces handle linked.</p>
        <a href="/api/v1/codeforces/link/start"
           style="padding:0.35rem 0.9rem;background:var(--accent);color:var(--surface);border-radius:4px;text-decoration:none;font-size:0.85rem;display:inline-block">
          Link Codeforces
        </a>
      </div>
    </section>

    <!-- Sign out -->
    <section style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1.5rem">
      <h2 style="font-size:1rem;margin:0 0 1rem">Session</h2>
      <button style="padding:0.4rem 1rem;background:var(--surface);border:1px solid var(--danger);color:var(--danger);border-radius:4px;cursor:pointer;font-size:0.9rem"
              @click="handleLogout">
        Sign out
      </button>
    </section>
  </main>
</template>
