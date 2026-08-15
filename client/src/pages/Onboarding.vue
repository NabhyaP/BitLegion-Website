<script setup lang="ts">
/**
 * Onboarding — confirm parsed roll-no / batch / branch, then link Codeforces.
 * Uses the Pinia session store so PATCH /me gets the CSRF token automatically. (§0.3)
 */
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session.ts';
import { ApiError } from '@/api/index.ts';

const router = useRouter();
const session = useSessionStore();

const rollNo = ref('');
const batchYear = ref<number | null>(null);
const branch = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

// Pre-fill from session once it loads
watch(
  () => session.me,
  (v) => {
    if (!v) return;
    rollNo.value = v.rollNo ?? '';
    batchYear.value = v.batchYear;
    branch.value = v.branch ?? '';
  },
  { immediate: true },
);

async function confirm() {
  saving.value = true;
  error.value = null;
  try {
    await session.patch({
      rollNo: rollNo.value || undefined,
      batchYear: batchYear.value ?? undefined,
      branch: branch.value || undefined,
      confirmProfile: true,
    });
    router.push('/dashboard');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main style="padding:2rem;max-width:32rem;margin:0 auto">
    <h2 style="margin:0 0 0.5rem">Confirm your details</h2>
    <p style="color:#64748b;margin:0 0 1.5rem;font-size:0.9rem">
      We read these from your college email. Check them — you can only set them once.
    </p>

    <div v-if="error" role="alert"
         style="background:#fee2e2;border:1px solid #fca5a5;border-radius:4px;padding:0.75rem;margin-bottom:1rem;color:#7f1d1d;font-size:0.9rem">
      Error: {{ error }}
    </div>

    <form @submit.prevent="confirm" style="display:grid;gap:1rem">
      <label style="font-size:0.9rem">
        Roll number
        <input v-model="rollNo"
               style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;font-size:0.9rem;box-sizing:border-box" />
      </label>
      <label style="font-size:0.9rem">
        Batch year
        <input v-model.number="batchYear" type="number" min="2000" max="2100"
               style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;font-size:0.9rem;box-sizing:border-box" />
      </label>
      <label style="font-size:0.9rem">
        Branch
        <input v-model="branch" placeholder="e.g. CSE"
               style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;font-size:0.9rem;box-sizing:border-box" />
      </label>

      <div style="display:flex;gap:1rem;align-items:center;margin-top:0.5rem">
        <button type="submit" :disabled="saving"
                style="padding:0.45rem 1.25rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem">
          {{ saving ? 'Saving…' : 'Confirm' }}
        </button>
        <RouterLink to="/dashboard" style="font-size:0.85rem;color:#64748b">Skip for now</RouterLink>
      </div>
    </form>

    <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid #e2e8f0">
      <h3 style="font-size:0.95rem;margin:0 0 0.5rem">Link Codeforces</h3>
      <p style="font-size:0.85rem;color:#64748b;margin:0 0 0.75rem">
        Connect your Codeforces account to appear on the leaderboard.
      </p>
      <!-- Full page navigation — triggers the server OAuth redirect -->
      <a href="/api/v1/codeforces/link/start"
         style="padding:0.4rem 1rem;background:#f97316;color:#fff;border-radius:4px;text-decoration:none;font-size:0.875rem;display:inline-block">
        Link Codeforces account →
      </a>
    </div>
  </main>
</template>
