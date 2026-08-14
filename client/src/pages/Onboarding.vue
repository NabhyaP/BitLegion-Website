<script setup lang="ts">
// Presentation only (§0.3): all fetching lives in the composable.
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useMe } from '../auth/useMe.ts';

const router = useRouter();
const { me, load, patch } = useMe();

const rollNo = ref('');
const batchYear = ref<number | null>(null);
const branch = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

watch(
  me,
  (v) => {
    if (!v) return;
    rollNo.value = v.rollNo ?? '';
    batchYear.value = v.batchYear;
    branch.value = v.branch ?? '';
  },
  { immediate: true },
);

load();

async function confirm() {
  saving.value = true;
  error.value = null;
  try {
    await patch({
      rollNo: rollNo.value || null,
      batchYear: batchYear.value,
      branch: branch.value || null,
      confirmProfile: true,
    });
    router.push('/dashboard');
  } catch (err) {
    error.value = String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <h2>Confirm your details</h2>
  <p>We read these from your college email. Check them — you can only set them once.</p>
  <p v-if="error" role="alert">{{ error }}</p>

  <form @submit.prevent="confirm">
    <p><label>Roll number <input v-model="rollNo" /></label></p>
    <p><label>Batch year <input v-model.number="batchYear" type="number" /></label></p>
    <p><label>Branch <input v-model="branch" /></label></p>
    <button type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Confirm' }}</button>
  </form>

  <!-- Codeforces linking arrives in Phase 2. -->
  <p><RouterLink to="/dashboard">Skip for now</RouterLink></p>
</template>
