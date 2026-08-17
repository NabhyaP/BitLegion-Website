<script setup lang="ts">
/**
 * Onboarding — confirm parsed roll-no / batch / branch, then link Codeforces.
 * Uses the Pinia session store so PATCH /me gets the CSRF token automatically. (§0.3)
 */
import { computed, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session.ts';
import { ApiError, fetchCourseCodes } from '@/api/index.ts';

const session = useSessionStore();

const rollNo = ref('');
const batchYear = ref<number | null>(null);
const branch = ref('');
const error = ref<string | null>(null);
const saving = ref(false);
const configuredBranches = ref<string[]>([]);
const branchOptions = computed(() => [...new Set([
  ...configuredBranches.value,
  ...(branch.value ? [branch.value] : []),
])].sort());

void fetchCourseCodes()
  .then((courses) => { configuredBranches.value = courses.map((course) => course.branch); })
  .catch(() => { configuredBranches.value = []; });

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

/**
 * Two steps, in order: confirm details → link Codeforces. Confirming no longer jumps
 * to the dashboard, because a user without a CF link has an empty dashboard and no
 * leaderboard row — the exact dead end that reads as "the site is broken".
 */
const step = ref<1 | 2>(session.me?.profileConfirmed ? 2 : 1);

watch(
  () => session.me?.profileConfirmed,
  (confirmed) => {
    if (confirmed) step.value = 2;
  },
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
    step.value = 2; // advance to CF linking rather than leaving onboarding
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main style="padding:2rem;max-width:32rem;margin:0 auto">
    <p style="color:var(--muted);margin:0 0 0.35rem;font-size:0.8rem">Step {{ step }} of 2</p>
    <template v-if="step === 1">
      <h2 style="margin:0 0 0.5rem">Confirm your details</h2>
      <p style="color:var(--muted);margin:0 0 1.5rem;font-size:0.9rem">
        We read these from your college email. Check them — you can only set them once.
      </p>
    </template>
    <h2 v-else style="margin:0 0 1rem">Almost done</h2>

    <div v-if="error" role="alert"
         style="background:var(--danger-bg);border:1px solid var(--danger);border-radius:4px;padding:0.75rem;margin-bottom:1rem;color:var(--danger);font-size:0.9rem">
      Error: {{ error }}
    </div>

    <form v-if="step === 1" @submit.prevent="confirm" style="display:grid;gap:1rem">
      <label style="font-size:0.9rem">
        Roll number
        <input v-model="rollNo"
               style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem;box-sizing:border-box" />
      </label>
      <label style="font-size:0.9rem">
        Batch year
        <input v-model.number="batchYear" type="number" min="2000" max="2100"
               style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.9rem;box-sizing:border-box" />
      </label>
      <label style="font-size:0.9rem">
        Branch
        <select v-if="branchOptions.length" v-model="branch" required
                style="display:block;width:100%;margin-top:0.25rem">
          <option value="" disabled>Select branch</option>
          <option v-for="option in branchOptions" :key="option" :value="option">{{ option }}</option>
        </select>
        <input v-else v-model="branch" placeholder="e.g. CSE" required
               style="display:block;width:100%;margin-top:0.25rem" />
      </label>

      <div style="display:flex;gap:1rem;align-items:center;margin-top:0.5rem">
        <button type="submit" :disabled="saving"
                style="padding:0.45rem 1.25rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer;font-size:0.9rem">
          {{ saving ? 'Saving…' : 'Continue' }}
        </button>
      </div>
    </form>

    <!-- Step 2: the only remaining action, so it is the whole screen rather than a
         footnote under the form. -->
    <div v-else>
      <h3 style="font-size:1.05rem;margin:0 0 0.5rem">Link your Codeforces account</h3>
      <p style="font-size:0.9rem;color:var(--muted);margin:0 0 1.25rem">
        This is the last step. You'll appear on the leaderboard straight away.
      </p>
      <!-- Full page navigation — triggers the server OAuth redirect -->
      <a href="/api/v1/codeforces/link/start"
         style="padding:0.55rem 1.25rem;background:var(--warn);color:var(--surface);border-radius:4px;text-decoration:none;font-size:0.95rem;display:inline-block">
        Link Codeforces account →
      </a>
    </div>
  </main>
</template>
