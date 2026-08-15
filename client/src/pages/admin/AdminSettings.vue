<script setup lang="ts">
/**
 * Admin Settings — Phase 7.
 * Controls: announcement banner text, leaderboard enabled toggle,
 * leaderboard refresh minutes (informational for cron config).
 */
import { ref, reactive, onMounted } from 'vue';
import { fetchAdminSettings, patchAdminSettings } from '@/api/index.ts';
import { ApiError } from '@/api/index.ts';

const form = reactive({ announcement: '', leaderboardEnabled: true, leaderboardRefreshMinutes: 60 });
const loading = ref(true);
const saving = ref(false);
const loadError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);

onMounted(async () => {
  try {
    const settings = await fetchAdminSettings();
    form.announcement = settings.announcement;
    form.leaderboardEnabled = settings.leaderboardEnabled;
    form.leaderboardRefreshMinutes = settings.leaderboardRefreshMinutes;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load settings.';
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true; saveError.value = null; saveSuccess.value = false;
  try {
    await patchAdminSettings({
      announcement: form.announcement,
      leaderboardEnabled: form.leaderboardEnabled,
      leaderboardRefreshMinutes: form.leaderboardRefreshMinutes,
    });
    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  } catch (e) {
    saveError.value = e instanceof ApiError ? e.message : 'Save failed.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div style="max-width:560px">
    <h1 style="margin:0 0 1.5rem;font-size:1.3rem">Settings</h1>

    <div v-if="loading" style="color:#94a3b8;padding:2rem;text-align:center">Loading…</div>
    <div v-else-if="loadError" role="alert"
         style="background:#fee2e2;border-radius:4px;padding:0.75rem;margin-bottom:1rem">
      {{ loadError }}
    </div>

    <form v-else @submit.prevent="save" style="display:grid;gap:1.25rem">
      <!-- Leaderboard enabled -->
      <fieldset style="border:1px solid #e2e8f0;border-radius:6px;padding:1rem">
        <legend style="font-size:0.9rem;font-weight:600;padding:0 0.4rem">Leaderboard</legend>
        <label style="display:flex;align-items:center;gap:0.75rem;font-size:0.9rem;cursor:pointer">
          <input v-model="form.leaderboardEnabled" type="checkbox" style="width:16px;height:16px" />
          <span>
            <strong>Leaderboard enabled</strong>
            <span style="display:block;font-size:0.75rem;color:#64748b">
              When off, the public leaderboard shows a "currently unavailable" message.
              Admins still see a preview.
            </span>
          </span>
        </label>

        <div style="margin-top:1rem">
          <label style="font-size:0.85rem">
            Refresh interval (minutes)
            <span style="font-size:0.75rem;color:#64748b;margin-left:0.25rem">(minimum 30 — informational for cron config)</span>
            <input v-model.number="form.leaderboardRefreshMinutes"
                   type="number" min="30" max="1440"
                   style="display:block;width:120px;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.3rem" />
          </label>
        </div>
      </fieldset>

      <!-- Announcement banner -->
      <fieldset style="border:1px solid #e2e8f0;border-radius:6px;padding:1rem">
        <legend style="font-size:0.9rem;font-weight:600;padding:0 0.4rem">Announcement Banner</legend>
        <label style="font-size:0.85rem">
          Banner text
          <span style="font-size:0.75rem;color:#64748b;margin-left:0.25rem">(leave empty to hide)</span>
          <textarea v-model="form.announcement" rows="3" maxlength="500"
                    placeholder="e.g. Registration closes Oct 31."
                    style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.3rem;font-size:0.85rem;resize:vertical;box-sizing:border-box"></textarea>
        </label>
        <div v-if="form.announcement"
             style="margin-top:0.5rem;background:#fef3c7;border:1px solid #d97706;border-radius:4px;padding:0.5rem 0.75rem;font-size:0.85rem">
          <strong>Preview:</strong> {{ form.announcement }}
        </div>
      </fieldset>

      <!-- Save -->
      <div style="display:flex;align-items:center;gap:1rem">
        <button type="submit" :disabled="saving"
                style="padding:0.4rem 1.2rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem">
          {{ saving ? 'Saving…' : 'Save settings' }}
        </button>
        <span v-if="saveSuccess" role="status" style="color:#16a34a;font-size:0.85rem">Saved.</span>
        <span v-if="saveError" role="alert" style="color:#dc2626;font-size:0.85rem">{{ saveError }}</span>
      </div>
    </form>
  </div>
</template>
