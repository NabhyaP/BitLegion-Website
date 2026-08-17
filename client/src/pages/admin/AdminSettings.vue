<script setup lang="ts">
/**
 * Admin Settings — Phase 7.
 * Controls: announcement banner text, leaderboard enabled toggle,
 * leaderboard refresh minutes (informational for cron config).
 */
import { ref, reactive, onMounted } from 'vue';
import {
  createCourseCode,
  deleteCourseCode,
  fetchAdminSettings,
  fetchCourseCodes,
  patchAdminSettings,
  updateCourseCode,
} from '@/api/index.ts';
import { ApiError } from '@/api/index.ts';
import type { CourseCodeResponse } from '@contracts';

const form = reactive({ announcement: '', leaderboardEnabled: true, leaderboardRefreshMinutes: 60 });
const loading = ref(true);
const saving = ref(false);
const loadError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);
const courseCodes = ref<CourseCodeResponse[]>([]);
const courseError = ref<string | null>(null);
const courseBusy = ref<string | null>(null);
const editingCode = ref<string | null>(null);
const editCourse = reactive({ branch: '', name: '' });
const newCourse = reactive({ code: '', branch: '', name: '' });

async function loadCourseCodes() {
  try {
    courseCodes.value = await fetchCourseCodes();
    courseError.value = null;
  } catch (error) {
    courseError.value = error instanceof Error ? error.message : 'Failed to load course codes.';
  }
}

onMounted(async () => {
  const [settingsResult] = await Promise.allSettled([fetchAdminSettings(), loadCourseCodes()]);
  if (settingsResult.status === 'fulfilled') {
    const settings = settingsResult.value;
    form.announcement = settings.announcement;
    form.leaderboardEnabled = settings.leaderboardEnabled;
    form.leaderboardRefreshMinutes = settings.leaderboardRefreshMinutes;
  } else {
    loadError.value = settingsResult.reason instanceof Error
      ? settingsResult.reason.message
      : 'Failed to load settings.';
  }
  loading.value = false;
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

function startCourseEdit(course: CourseCodeResponse) {
  editingCode.value = course.code;
  editCourse.branch = course.branch;
  editCourse.name = course.name;
  courseError.value = null;
}

async function saveCourseEdit(code: string) {
  courseBusy.value = code;
  courseError.value = null;
  try {
    await updateCourseCode(code, {
      branch: editCourse.branch.trim().toUpperCase(),
      name: editCourse.name.trim(),
    });
    editingCode.value = null;
    await loadCourseCodes();
  } catch (error) {
    courseError.value = error instanceof Error ? error.message : 'Course code update failed.';
  } finally {
    courseBusy.value = null;
  }
}

async function addCourse() {
  courseBusy.value = 'new';
  courseError.value = null;
  try {
    await createCourseCode({
      code: newCourse.code.trim(),
      branch: newCourse.branch.trim().toUpperCase(),
      name: newCourse.name.trim(),
    });
    newCourse.code = '';
    newCourse.branch = '';
    newCourse.name = '';
    await loadCourseCodes();
  } catch (error) {
    courseError.value = error instanceof Error ? error.message : 'Course code creation failed.';
  } finally {
    courseBusy.value = null;
  }
}

async function removeCourse(code: string) {
  if (!confirm(`Delete course code ${code}? Existing member records will keep their current branch.`)) return;
  courseBusy.value = code;
  courseError.value = null;
  try {
    await deleteCourseCode(code);
    await loadCourseCodes();
  } catch (error) {
    courseError.value = error instanceof Error ? error.message : 'Course code deletion failed.';
  } finally {
    courseBusy.value = null;
  }
}
</script>

<template>
  <div style="max-width:560px">
    <h1 style="margin:0 0 1.5rem;font-size:1.3rem">Settings</h1>

    <div v-if="loading" style="color:var(--muted);padding:2rem;text-align:center">Loading…</div>
    <div v-else-if="loadError" role="alert"
         style="background:var(--danger-bg);border-radius:4px;padding:0.75rem;margin-bottom:1rem">
      {{ loadError }}
    </div>

    <form v-else @submit.prevent="save" style="display:grid;gap:1.25rem">
      <!-- Leaderboard enabled -->
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:1rem">
        <legend style="font-size:0.9rem;font-weight:600;padding:0 0.4rem">Leaderboard</legend>
        <label style="display:flex;align-items:center;gap:0.75rem;font-size:0.9rem;cursor:pointer">
          <input v-model="form.leaderboardEnabled" type="checkbox" style="width:16px;height:16px" />
          <span>
            <strong>Leaderboard enabled</strong>
            <span style="display:block;font-size:0.75rem;color:var(--muted)">
              When off, the public leaderboard shows a "currently unavailable" message.
              Admins still see a preview.
            </span>
          </span>
        </label>

        <div style="margin-top:1rem">
          <label style="font-size:0.85rem">
            Refresh interval (minutes)
            <span style="font-size:0.75rem;color:var(--muted);margin-left:0.25rem">(minimum 30 — informational for cron config)</span>
            <input v-model.number="form.leaderboardRefreshMinutes"
                   type="number" min="30" max="1440"
                   style="display:block;width:120px;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.3rem" />
          </label>
        </div>
      </fieldset>

      <!-- Announcement banner -->
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:1rem">
        <legend style="font-size:0.9rem;font-weight:600;padding:0 0.4rem">Announcement Banner</legend>
        <label style="font-size:0.85rem">
          Banner text
          <span style="font-size:0.75rem;color:var(--muted);margin-left:0.25rem">(leave empty to hide)</span>
          <textarea v-model="form.announcement" rows="3" maxlength="500"
                    placeholder="e.g. Registration closes Oct 31."
                    style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.3rem;font-size:0.85rem;resize:vertical;box-sizing:border-box"></textarea>
        </label>
        <div v-if="form.announcement"
             style="margin-top:0.5rem;background:var(--warn-bg);border:1px solid var(--warn);border-radius:4px;padding:0.5rem 0.75rem;font-size:0.85rem">
          <strong>Preview:</strong> {{ form.announcement }}
        </div>
      </fieldset>

      <!-- Save -->
      <div style="display:flex;align-items:center;gap:1rem">
        <button type="submit" :disabled="saving"
                style="padding:0.4rem 1.2rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer;font-size:0.9rem">
          {{ saving ? 'Saving…' : 'Save settings' }}
        </button>
        <span v-if="saveSuccess" role="status" style="color:var(--ok);font-size:0.85rem">Saved.</span>
        <span v-if="saveError" role="alert" style="color:var(--danger);font-size:0.85rem">{{ saveError }}</span>
      </div>
    </form>

    <section v-if="!loading && !loadError" class="course-codes" aria-labelledby="course-codes-title">
      <div class="course-heading">
        <div>
          <h2 id="course-codes-title">Course Codes</h2>
          <p>Roll-number course codes used to assign branches during registration.</p>
        </div>
        <button v-if="courseError && courseCodes.length === 0" type="button" @click="loadCourseCodes">Retry</button>
      </div>

      <div v-if="courseError" class="course-error" role="alert">{{ courseError }}</div>

      <div class="course-table-wrap">
        <table v-if="courseCodes.length" aria-label="Configured course codes">
          <thead><tr><th>Code</th><th>Branch</th><th>Name</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="course in courseCodes" :key="course.code">
              <td><code>{{ course.code }}</code></td>
              <template v-if="editingCode === course.code">
                <td><input v-model="editCourse.branch" maxlength="16" aria-label="Branch abbreviation" /></td>
                <td><input v-model="editCourse.name" maxlength="100" aria-label="Course name" /></td>
                <td class="actions">
                  <button type="button" :disabled="courseBusy === course.code" @click="saveCourseEdit(course.code)">Save</button>
                  <button type="button" @click="editingCode = null">Cancel</button>
                </td>
              </template>
              <template v-else>
                <td>{{ course.branch }}</td>
                <td>{{ course.name }}</td>
                <td class="actions">
                  <button type="button" @click="startCourseEdit(course)">Edit</button>
                  <button type="button" class="danger" :disabled="courseBusy === course.code" @click="removeCourse(course.code)">Delete</button>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <form class="course-add" @submit.prevent="addCourse">
        <label>Code<input v-model="newCourse.code" required pattern="\d{2}" maxlength="2" placeholder="15" /></label>
        <label>Branch<input v-model="newCourse.branch" required maxlength="16" placeholder="CSE" /></label>
        <label class="course-name">Name<input v-model="newCourse.name" required maxlength="100" placeholder="Computer Science and Engineering" /></label>
        <button type="submit" :disabled="courseBusy === 'new'">{{ courseBusy === 'new' ? 'Adding...' : 'Add course' }}</button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.course-codes {
  border-top: 1px solid var(--line);
  margin-top: 2rem;
  padding-top: 1.25rem;
}

.course-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.course-heading h2 {
  font-size: 1rem;
  margin: 0;
}

.course-heading p {
  color: var(--muted);
  font-size: 0.75rem;
  margin: 0.25rem 0 0;
}

.course-error {
  color: var(--danger);
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}

.course-table-wrap {
  overflow-x: auto;
}

.course-table-wrap input {
  width: 100%;
  min-width: 9rem;
}

.actions {
  white-space: nowrap;
}

.actions button {
  margin-right: 0.35rem;
  padding: 0.25rem 0.5rem;
}

.actions .danger {
  color: var(--danger);
}

.course-add {
  display: grid;
  grid-template-columns: 5rem 7rem minmax(12rem, 1fr) auto;
  align-items: end;
  gap: 0.6rem;
  margin-top: 1rem;
}

.course-add label {
  color: var(--muted);
  font-size: 0.7rem;
}

.course-add input {
  display: block;
  margin-top: 0.2rem;
  width: 100%;
}

@media (max-width: 680px) {
  .course-add {
    grid-template-columns: 1fr 1fr;
  }

  .course-name {
    grid-column: 1 / -1;
  }
}
</style>
