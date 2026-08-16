<script setup lang="ts">
/**
 * Admin Teams — full CRUD for teams and members.
 *
 * Member modal has two modes toggled by a tab:
 *   "From account" — search registered users; selecting one pre-fills name / CF handle / photo.
 *   "Manual"       — free-form fields, no account link.
 *
 * Selecting a registered user sets userId on the member row so future profile
 * updates (avatar etc.) can be reflected automatically.
 */
import { ref, reactive, watch } from 'vue';
import { fetchTeams, apiFetch, ApiError } from '@/api/index.ts';
import type { TeamResponse, TeamMemberResponse } from '@contracts';

// ── Types ──────────────────────────────────────────────────────────────────
type UserResult = {
  id: number;
  displayName: string;
  collegeEmail: string;
  avatarUrl: string | null;
  cfHandle: string | null;
};

// ── State ──────────────────────────────────────────────────────────────────
const teams = ref<TeamResponse[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

async function load() {
  loading.value = true; loadError.value = null;
  try { teams.value = await fetchTeams(); }
  catch (e) { loadError.value = e instanceof Error ? e.message : 'Load failed.'; }
  finally { loading.value = false; }
}
load();

// ── Add team ───────────────────────────────────────────────────────────────
const addTeamOpen = ref(false);
const addTeamForm = reactive({ name: '', displayOrder: '0' });
const addTeamSaving = ref(false);
const addTeamError = ref<string | null>(null);

async function doAddTeam() {
  addTeamSaving.value = true; addTeamError.value = null;
  try {
    await apiFetch('/api/v1/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name: addTeamForm.name.trim(), displayOrder: Number(addTeamForm.displayOrder) }),
    });
    addTeamOpen.value = false;
    addTeamForm.name = ''; addTeamForm.displayOrder = '0';
    load();
  } catch (e) { addTeamError.value = e instanceof Error ? e.message : 'Failed.'; }
  finally { addTeamSaving.value = false; }
}

// ── Edit team ──────────────────────────────────────────────────────────────
const editTeam = ref<TeamResponse | null>(null);
const editTeamForm = reactive({ name: '', displayOrder: '0' });
const editTeamSaving = ref(false);
const editTeamError = ref<string | null>(null);

function openEditTeam(t: TeamResponse) {
  editTeam.value = t;
  editTeamForm.name = t.name;
  editTeamForm.displayOrder = String(t.displayOrder);
  editTeamError.value = null;
}

async function doEditTeam() {
  if (!editTeam.value) return;
  editTeamSaving.value = true; editTeamError.value = null;
  try {
    await apiFetch(`/api/v1/admin/teams/${editTeam.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editTeamForm.name.trim(), displayOrder: Number(editTeamForm.displayOrder) }),
    });
    editTeam.value = null;
    load();
  } catch (e) { editTeamError.value = e instanceof Error ? e.message : 'Failed.'; }
  finally { editTeamSaving.value = false; }
}

async function doDeleteTeam(t: TeamResponse) {
  if (!confirm(`Delete team "${t.name}" and all its members?`)) return;
  try { await apiFetch(`/api/v1/admin/teams/${t.id}`, { method: 'DELETE' }); load(); }
  catch (e) { alert(e instanceof Error ? e.message : 'Delete failed.'); }
}

// ── User search (shared between add + edit member modals) ──────────────────
const userSearch = ref('');
const userResults = ref<UserResult[]>([]);
const userSearching = ref(false);
let _searchTimer: ReturnType<typeof setTimeout> | null = null;

async function runUserSearch(q: string) {
  if (!q.trim()) { userResults.value = []; return; }
  userSearching.value = true;
  try {
    const res = await apiFetch<{ data: UserResult[] }>(
      `/api/v1/admin/users/search?q=${encodeURIComponent(q.trim())}`,
    );
    userResults.value = res.data;
  } catch { userResults.value = []; }
  finally { userSearching.value = false; }
}

watch(userSearch, (q) => {
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => runUserSearch(q), 250);
});

function clearUserSearch() {
  userSearch.value = '';
  userResults.value = [];
}

// ── Member modal (shared for add + edit) ───────────────────────────────────
// mode: 'add' | 'edit'
// tab: 'account' | 'manual'
const memberModal = ref<{
  mode: 'add' | 'edit';
  teamId: number;
  teamName: string;
  memberId?: number;        // edit only
} | null>(null);

const memberTab = ref<'account' | 'manual'>('account');

// Linked account (account tab)
const linkedUser = ref<UserResult | null>(null);

// Form fields (manual tab, or overridable after picking account)
const memberForm = reactive({
  name: '',
  roleTitle: '',
  cfHandle: '',
  photoUrl: '',
  displayOrder: '0',
});

const memberSaving = ref(false);
const memberError = ref<string | null>(null);

function openAddMember(t: TeamResponse) {
  memberModal.value = { mode: 'add', teamId: t.id, teamName: t.name };
  memberTab.value = 'account';
  linkedUser.value = null;
  clearUserSearch();
  memberForm.name = memberForm.roleTitle = memberForm.cfHandle = memberForm.photoUrl = '';
  memberForm.displayOrder = '0';
  memberError.value = null;
}

function openEditMember(team: TeamResponse, m: TeamMemberResponse) {
  memberModal.value = { mode: 'edit', teamId: team.id, teamName: team.name, memberId: m.id };
  // If member is linked to a user account, default to account tab showing link info;
  // otherwise default to manual.
  memberTab.value = m.userId ? 'account' : 'manual';
  linkedUser.value = null;
  clearUserSearch();
  memberForm.name = m.name;
  memberForm.roleTitle = m.roleTitle;
  memberForm.cfHandle = m.cfHandle ?? '';
  memberForm.photoUrl = m.photoUrl ?? '';
  memberForm.displayOrder = String(m.displayOrder);
  memberError.value = null;
}

/** Pick a registered user — auto-fill form fields from their profile. */
function selectUser(u: UserResult) {
  linkedUser.value = u;
  memberForm.name = u.displayName;
  memberForm.cfHandle = u.cfHandle ?? '';
  memberForm.photoUrl = u.avatarUrl ?? '';
  clearUserSearch();
}

function clearLinkedUser() {
  linkedUser.value = null;
  memberForm.name = '';
  memberForm.cfHandle = '';
  memberForm.photoUrl = '';
}

async function doSaveMember() {
  if (!memberModal.value) return;
  const { mode, teamId, memberId } = memberModal.value;

  // Validate
  if (!memberForm.name.trim()) { memberError.value = 'Name is required.'; return; }
  if (!memberForm.roleTitle.trim()) { memberError.value = 'Role title is required.'; return; }

  memberSaving.value = true; memberError.value = null;

  const payload: Record<string, unknown> = {
    name: memberForm.name.trim(),
    roleTitle: memberForm.roleTitle.trim(),
    cfHandle: memberForm.cfHandle.trim() || null,
    photoUrl: memberForm.photoUrl.trim() || null,
    displayOrder: Number(memberForm.displayOrder),
    userId: memberTab.value === 'account' && linkedUser.value ? linkedUser.value.id : null,
  };

  try {
    if (mode === 'add') {
      await apiFetch(`/api/v1/admin/teams/${teamId}/members`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch(`/api/v1/admin/teams/${teamId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    }
    memberModal.value = null;
    load();
  } catch (e) {
    memberError.value = e instanceof Error ? e.message : 'Failed.';
  } finally {
    memberSaving.value = false;
  }
}

async function doDeleteMember(teamId: number, m: TeamMemberResponse) {
  if (!confirm(`Remove "${m.name}" from team?`)) return;
  try { await apiFetch(`/api/v1/admin/teams/${teamId}/members/${m.id}`, { method: 'DELETE' }); load(); }
  catch (e) { alert(e instanceof Error ? e.message : 'Delete failed.'); }
}
</script>

<template>
  <div>
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem">
      <h1 style="margin:0;font-size:1.3rem">Teams</h1>
      <button
        style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer"
        @click="addTeamOpen = true"
      >+ Add team</button>
    </div>

    <div v-if="loading && !teams.length" style="padding:2rem;text-align:center;color:#94a3b8">Loading…</div>
    <div v-if="loadError" role="alert" style="background:#fee2e2;border-radius:4px;padding:0.75rem;margin-bottom:1rem">{{ loadError }}</div>
    <div v-if="!loading && !teams.length" style="color:#94a3b8;padding:2rem;text-align:center">No teams yet.</div>

    <!-- Teams list -->
    <div
      v-for="team in teams" :key="team.id"
      style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:1rem;margin-bottom:1.25rem"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.4rem">
        <div>
          <span style="font-weight:600;font-size:0.95rem">{{ team.name }}</span>
          <span style="font-size:0.75rem;color:#94a3b8;margin-left:0.5rem">order={{ team.displayOrder }}</span>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid #cbd5e1;border-radius:3px" @click="openEditTeam(team)">Edit team</button>
          <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid #6366f1;border-radius:3px;color:#4f46e5" @click="openAddMember(team)">+ Member</button>
          <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid #fca5a5;border-radius:3px;color:#dc2626" @click="doDeleteTeam(team)">Delete</button>
        </div>
      </div>

      <table v-if="team.members.length" style="width:100%;border-collapse:collapse;font-size:0.8rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #e2e8f0">
            <th style="padding:0.4rem" scope="col">Name</th>
            <th style="padding:0.4rem" scope="col">Role</th>
            <th style="padding:0.4rem" scope="col">CF Handle</th>
            <th style="padding:0.4rem" scope="col">Linked</th>
            <th style="padding:0.4rem" scope="col">Order</th>
            <th style="padding:0.4rem" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in team.members" :key="m.id" style="border-bottom:1px solid #f1f5f9">
            <td style="padding:0.4rem">
              <span style="display:flex;align-items:center;gap:0.4rem">
                <img v-if="m.photoUrl" :src="m.photoUrl" :alt="m.name" width="20" height="20"
                     style="border-radius:50%;object-fit:cover;flex-shrink:0" loading="lazy" />
                {{ m.name }}
              </span>
            </td>
            <td style="padding:0.4rem;color:#475569">{{ m.roleTitle }}</td>
            <td style="padding:0.4rem;color:#475569">{{ m.cfHandle ?? '—' }}</td>
            <td style="padding:0.4rem">
              <span v-if="m.userId" title="Linked to a registered account"
                    style="font-size:0.7rem;background:#dcfce7;color:#166534;padding:0.1rem 0.4rem;border-radius:9999px">✓ account</span>
              <span v-else style="font-size:0.7rem;color:#94a3b8">manual</span>
            </td>
            <td style="padding:0.4rem;color:#94a3b8">{{ m.displayOrder }}</td>
            <td style="padding:0.4rem;white-space:nowrap">
              <button style="font-size:0.7rem;cursor:pointer;padding:0.15rem 0.4rem;border:1px solid #cbd5e1;border-radius:3px;margin-right:0.2rem"
                      @click="openEditMember(team, m)">Edit</button>
              <button style="font-size:0.7rem;cursor:pointer;padding:0.15rem 0.4rem;border:1px solid #fca5a5;border-radius:3px;color:#dc2626"
                      @click="doDeleteMember(team.id, m)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else style="font-size:0.8rem;color:#94a3b8;margin:0">No members yet.</p>
    </div>

    <!-- ── Add team modal ───────────────────────────────────────────────── -->
    <div v-if="addTeamOpen" role="dialog" aria-modal="true" aria-labelledby="add-team-title"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:360px">
        <h2 id="add-team-title" style="font-size:1rem;margin:0 0 1rem">Add Team</h2>
        <form @submit.prevent="doAddTeam" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Team name *
            <input v-model="addTeamForm.name" required
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="addTeamForm.displayOrder" type="number"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <div v-if="addTeamError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ addTeamError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="addTeamOpen=false">Cancel</button>
            <button type="submit" :disabled="addTeamSaving"
                    style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">
              {{ addTeamSaving ? 'Adding…' : 'Add' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Edit team modal ──────────────────────────────────────────────── -->
    <div v-if="editTeam" role="dialog" aria-modal="true" aria-labelledby="edit-team-title"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:360px">
        <h2 id="edit-team-title" style="font-size:1rem;margin:0 0 1rem">Edit Team</h2>
        <form @submit.prevent="doEditTeam" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Team name *
            <input v-model="editTeamForm.name" required
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="editTeamForm.displayOrder" type="number"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <div v-if="editTeamError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ editTeamError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="editTeam=null">Cancel</button>
            <button type="submit" :disabled="editTeamSaving"
                    style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">
              {{ editTeamSaving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Add / Edit member modal ──────────────────────────────────────── -->
    <div v-if="memberModal" role="dialog" aria-modal="true" aria-labelledby="member-modal-title"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:440px;max-height:90vh;overflow-y:auto">

        <h2 id="member-modal-title" style="font-size:1rem;margin:0 0 1rem">
          {{ memberModal.mode === 'add' ? `Add Member — ${memberModal.teamName}` : 'Edit Member' }}
        </h2>

        <!-- Tab bar -->
        <div style="display:flex;border-bottom:2px solid #e2e8f0;margin-bottom:1rem">
          <button
            type="button"
            :style="{
              padding: '0.4rem 0.9rem',
              fontWeight: memberTab === 'account' ? '600' : '400',
              borderBottom: memberTab === 'account' ? '2px solid #4f46e5' : '2px solid transparent',
              marginBottom: '-2px',
              background: 'none',
              border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: memberTab === 'account' ? '#4f46e5' : 'transparent',
              cursor: 'pointer',
              color: memberTab === 'account' ? '#4f46e5' : '#64748b',
              fontSize: '0.85rem',
            }"
            @click="memberTab = 'account'"
          >From account</button>
          <button
            type="button"
            :style="{
              padding: '0.4rem 0.9rem',
              fontWeight: memberTab === 'manual' ? '600' : '400',
              background: 'none',
              border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: memberTab === 'manual' ? '#4f46e5' : 'transparent',
              marginBottom: '-2px',
              cursor: 'pointer',
              color: memberTab === 'manual' ? '#4f46e5' : '#64748b',
              fontSize: '0.85rem',
            }"
            @click="memberTab = 'manual'"
          >Manual</button>
        </div>

        <form @submit.prevent="doSaveMember" style="display:grid;gap:0.75rem">

          <!-- ── Account tab ─────────────────────────────────────────── -->
          <template v-if="memberTab === 'account'">
            <!-- Already picked a user -->
            <div v-if="linkedUser"
                 style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px">
              <img v-if="linkedUser.avatarUrl" :src="linkedUser.avatarUrl" :alt="linkedUser.displayName"
                   width="36" height="36" style="border-radius:50%;object-fit:cover;flex-shrink:0" />
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ linkedUser.displayName }}</div>
                <div style="font-size:0.75rem;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ linkedUser.collegeEmail }}</div>
                <div v-if="linkedUser.cfHandle" style="font-size:0.75rem;color:#6366f1">CF: {{ linkedUser.cfHandle }}</div>
              </div>
              <button type="button"
                      style="font-size:0.75rem;color:#dc2626;cursor:pointer;background:none;border:none;padding:0.2rem"
                      aria-label="Remove linked account"
                      @click="clearLinkedUser">✕</button>
            </div>

            <!-- Search box (shown until a user is picked) -->
            <template v-else>
              <label style="font-size:0.85rem">Search by name or email
                <div style="position:relative">
                  <input
                    v-model="userSearch"
                    type="search"
                    placeholder="Start typing…"
                    autocomplete="off"
                    style="display:block;width:100%;padding:0.4rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box;font-size:0.875rem"
                    aria-label="Search registered users"
                    aria-autocomplete="list"
                    :aria-expanded="userResults.length > 0"
                  />
                  <div v-if="userSearching" style="position:absolute;right:0.5rem;top:50%;transform:translateY(-25%);font-size:0.75rem;color:#94a3b8">
                    …
                  </div>
                </div>
              </label>

              <!-- Results dropdown -->
              <ul v-if="userResults.length"
                  style="list-style:none;margin:0;padding:0;border:1px solid #e2e8f0;border-radius:4px;max-height:180px;overflow-y:auto"
                  role="listbox">
                <li
                  v-for="u in userResults" :key="u.id"
                  role="option"
                  style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.75rem;cursor:pointer;border-bottom:1px solid #f1f5f9"
                  @click="selectUser(u)"
                  @keydown.enter="selectUser(u)"
                  tabindex="0"
                >
                  <img v-if="u.avatarUrl" :src="u.avatarUrl" :alt="u.displayName"
                       width="28" height="28" style="border-radius:50%;object-fit:cover;flex-shrink:0" loading="lazy" />
                  <div v-else style="width:28px;height:28px;border-radius:50%;background:#e2e8f0;flex-shrink:0"></div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:0.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ u.displayName }}</div>
                    <div style="font-size:0.7rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ u.collegeEmail }}</div>
                  </div>
                  <span v-if="u.cfHandle" style="font-size:0.7rem;color:#6366f1;white-space:nowrap">{{ u.cfHandle }}</span>
                </li>
              </ul>

              <p v-if="userSearch && !userSearching && userResults.length === 0"
                 style="font-size:0.8rem;color:#94a3b8;margin:0">
                No matching accounts found.
                <button type="button" style="font-size:0.8rem;color:#4f46e5;background:none;border:none;cursor:pointer;padding:0" @click="memberTab='manual'">Switch to manual entry →</button>
              </p>

              <p style="font-size:0.75rem;color:#94a3b8;margin:0">
                Can't find them? <button type="button" style="font-size:0.75rem;color:#4f46e5;background:none;border:none;cursor:pointer;padding:0" @click="memberTab='manual'">Enter details manually</button>
              </p>
            </template>
          </template>

          <!-- ── Manual tab ──────────────────────────────────────────── -->
          <template v-else>
            <p style="font-size:0.75rem;color:#64748b;margin:0;padding:0.4rem 0.6rem;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0">
              No account linked. Details won't auto-update if the user changes their profile.
            </p>
          </template>

          <!-- ── Shared fields ───────────────────────────────────────── -->
          <label style="font-size:0.85rem">Name *
            <input v-model="memberForm.name" required
                   :placeholder="memberTab === 'account' && linkedUser ? linkedUser.displayName : 'Full name'"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Role title *
            <input v-model="memberForm.roleTitle" required placeholder="e.g. President, Developer…"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">CF handle
            <input v-model="memberForm.cfHandle" placeholder="Codeforces username (optional)"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
            <span v-if="memberTab === 'account' && linkedUser?.cfHandle && !memberForm.cfHandle"
                  style="font-size:0.75rem;color:#f59e0b">
              Linked account has no CF handle linked yet.
            </span>
          </label>
          <label style="font-size:0.85rem">Photo URL
            <input v-model="memberForm.photoUrl" type="url" placeholder="https://… (optional)"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="memberForm.displayOrder" type="number"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>

          <div v-if="memberError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ memberError }}</div>

          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="memberModal=null">Cancel</button>
            <button
              type="submit"
              :disabled="memberSaving || (memberTab === 'account' && !linkedUser && !memberForm.name)"
              style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer;disabled:opacity-50"
            >
              {{ memberSaving ? 'Saving…' : memberModal.mode === 'add' ? 'Add' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>

  </div>
</template>
