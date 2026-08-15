<script setup lang="ts">
/**
 * Admin Teams — Phase 7.
 * Full CRUD for teams and team members. Every mutation is server-audited.
 */
import { ref, reactive } from 'vue';
import { fetchTeams } from '@/api/index.ts';
import { ApiError } from '@/api/index.ts';
import type { TeamResponse, TeamMemberResponse } from '@contracts';

// ── Helpers ────────────────────────────────────────────────────────────────
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'ERR', body?.error?.message ?? res.statusText);
  return body as T;
}

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
    await api('/api/v1/admin/teams', {
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
    await api(`/api/v1/admin/teams/${editTeam.value.id}`, {
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
  try { await api(`/api/v1/admin/teams/${t.id}`, { method: 'DELETE' }); load(); }
  catch (e) { alert(e instanceof Error ? e.message : 'Delete failed.'); }
}

// ── Members ────────────────────────────────────────────────────────────────
const selectedTeam = ref<TeamResponse | null>(null);

const addMemberOpen = ref(false);
const addMemberForm = reactive({ name: '', roleTitle: '', cfHandle: '', photoUrl: '', displayOrder: '0' });
const addMemberSaving = ref(false);
const addMemberError = ref<string | null>(null);

function openAddMember(t: TeamResponse) {
  selectedTeam.value = t;
  addMemberForm.name = addMemberForm.roleTitle = addMemberForm.cfHandle = addMemberForm.photoUrl = '';
  addMemberForm.displayOrder = '0';
  addMemberError.value = null;
  addMemberOpen.value = true;
}

async function doAddMember() {
  if (!selectedTeam.value) return;
  addMemberSaving.value = true; addMemberError.value = null;
  try {
    await api(`/api/v1/admin/teams/${selectedTeam.value.id}/members`, {
      method: 'POST',
      body: JSON.stringify({
        name: addMemberForm.name.trim(),
        roleTitle: addMemberForm.roleTitle.trim(),
        cfHandle: addMemberForm.cfHandle.trim() || null,
        photoUrl: addMemberForm.photoUrl.trim() || null,
        displayOrder: Number(addMemberForm.displayOrder),
      }),
    });
    addMemberOpen.value = false;
    load();
  } catch (e) { addMemberError.value = e instanceof Error ? e.message : 'Failed.'; }
  finally { addMemberSaving.value = false; }
}

// Edit member
const editMember = ref<{ teamId: number; member: TeamMemberResponse } | null>(null);
const editMemberForm = reactive({ name: '', roleTitle: '', cfHandle: '', photoUrl: '', displayOrder: '0' });
const editMemberSaving = ref(false);
const editMemberError = ref<string | null>(null);

function openEditMember(teamId: number, m: TeamMemberResponse) {
  editMember.value = { teamId, member: m };
  editMemberForm.name = m.name;
  editMemberForm.roleTitle = m.roleTitle;
  editMemberForm.cfHandle = m.cfHandle ?? '';
  editMemberForm.photoUrl = m.photoUrl ?? '';
  editMemberForm.displayOrder = String(m.displayOrder);
  editMemberError.value = null;
}

async function doEditMember() {
  if (!editMember.value) return;
  editMemberSaving.value = true; editMemberError.value = null;
  const { teamId, member } = editMember.value;
  try {
    await api(`/api/v1/admin/teams/${teamId}/members/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editMemberForm.name.trim() || undefined,
        roleTitle: editMemberForm.roleTitle.trim() || undefined,
        cfHandle: editMemberForm.cfHandle.trim() || null,
        photoUrl: editMemberForm.photoUrl.trim() || null,
        displayOrder: Number(editMemberForm.displayOrder),
      }),
    });
    editMember.value = null;
    load();
  } catch (e) { editMemberError.value = e instanceof Error ? e.message : 'Failed.'; }
  finally { editMemberSaving.value = false; }
}

async function doDeleteMember(teamId: number, m: TeamMemberResponse) {
  if (!confirm(`Remove "${m.name}" from team?`)) return;
  try { await api(`/api/v1/admin/teams/${teamId}/members/${m.id}`, { method: 'DELETE' }); load(); }
  catch (e) { alert(e instanceof Error ? e.message : 'Delete failed.'); }
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem">
      <h1 style="margin:0;font-size:1.3rem">Teams</h1>
      <button style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer"
              @click="addTeamOpen=true">+ Add team</button>
    </div>

    <div v-if="loading && !teams.length" style="padding:2rem;text-align:center;color:#94a3b8">Loading…</div>
    <div v-if="loadError" role="alert" style="background:#fee2e2;border-radius:4px;padding:0.75rem;margin-bottom:1rem">{{ loadError }}</div>
    <div v-if="!loading && !teams.length" style="color:#94a3b8;padding:2rem;text-align:center">No teams yet.</div>

    <!-- Teams list -->
    <div v-for="team in teams" :key="team.id"
         style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:1rem;margin-bottom:1.25rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.4rem">
        <div>
          <span style="font-weight:600;font-size:0.95rem">{{ team.name }}</span>
          <span style="font-size:0.75rem;color:#94a3b8;margin-left:0.5rem">order={{ team.displayOrder }}</span>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid #cbd5e1;border-radius:3px"
                  @click="openEditTeam(team)">Edit team</button>
          <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid #cbd5e1;border-radius:3px"
                  @click="openAddMember(team)">+ Member</button>
          <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid #fca5a5;border-radius:3px;color:#dc2626"
                  @click="doDeleteTeam(team)">Delete</button>
        </div>
      </div>

      <table v-if="team.members.length" style="width:100%;border-collapse:collapse;font-size:0.8rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #e2e8f0">
            <th style="padding:0.4rem" scope="col">Name</th>
            <th style="padding:0.4rem" scope="col">Role</th>
            <th style="padding:0.4rem" scope="col">CF Handle</th>
            <th style="padding:0.4rem" scope="col">Order</th>
            <th style="padding:0.4rem" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in team.members" :key="m.id" style="border-bottom:1px solid #f1f5f9">
            <td style="padding:0.4rem">{{ m.name }}</td>
            <td style="padding:0.4rem;color:#475569">{{ m.roleTitle }}</td>
            <td style="padding:0.4rem;color:#475569">{{ m.cfHandle ?? '—' }}</td>
            <td style="padding:0.4rem;color:#94a3b8">{{ m.displayOrder }}</td>
            <td style="padding:0.4rem;white-space:nowrap">
              <button style="font-size:0.7rem;cursor:pointer;padding:0.15rem 0.4rem;border:1px solid #cbd5e1;border-radius:3px;margin-right:0.2rem"
                      @click="openEditMember(team.id, m)">Edit</button>
              <button style="font-size:0.7rem;cursor:pointer;padding:0.15rem 0.4rem;border:1px solid #fca5a5;border-radius:3px;color:#dc2626"
                      @click="doDeleteMember(team.id, m)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else style="font-size:0.8rem;color:#94a3b8;margin:0">No members yet.</p>
    </div>

    <!-- Add team modal -->
    <div v-if="addTeamOpen" role="dialog" aria-modal="true"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:360px">
        <h2 style="font-size:1rem;margin:0 0 1rem">Add Team</h2>
        <form @submit.prevent="doAddTeam" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Team name *
            <input v-model="addTeamForm.name" required style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="addTeamForm.displayOrder" type="number" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <div v-if="addTeamError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ addTeamError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="addTeamOpen=false">Cancel</button>
            <button type="submit" :disabled="addTeamSaving" style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">
              {{ addTeamSaving ? 'Adding…' : 'Add' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit team modal -->
    <div v-if="editTeam" role="dialog" aria-modal="true"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:360px">
        <h2 style="font-size:1rem;margin:0 0 1rem">Edit Team</h2>
        <form @submit.prevent="doEditTeam" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Team name *
            <input v-model="editTeamForm.name" required style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="editTeamForm.displayOrder" type="number" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <div v-if="editTeamError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ editTeamError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="editTeam=null">Cancel</button>
            <button type="submit" :disabled="editTeamSaving" style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">
              {{ editTeamSaving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Add member modal -->
    <div v-if="addMemberOpen" role="dialog" aria-modal="true"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:400px">
        <h2 style="font-size:1rem;margin:0 0 1rem">Add Member to {{ selectedTeam?.name }}</h2>
        <form @submit.prevent="doAddMember" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Name *
            <input v-model="addMemberForm.name" required style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Role title *
            <input v-model="addMemberForm.roleTitle" required style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">CF handle
            <input v-model="addMemberForm.cfHandle" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Photo URL
            <input v-model="addMemberForm.photoUrl" type="url" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="addMemberForm.displayOrder" type="number" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <div v-if="addMemberError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ addMemberError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="addMemberOpen=false">Cancel</button>
            <button type="submit" :disabled="addMemberSaving" style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">
              {{ addMemberSaving ? 'Adding…' : 'Add' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit member modal -->
    <div v-if="editMember" role="dialog" aria-modal="true"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:8px;padding:1.5rem;width:100%;max-width:400px">
        <h2 style="font-size:1rem;margin:0 0 1rem">Edit Member</h2>
        <form @submit.prevent="doEditMember" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Name
            <input v-model="editMemberForm.name" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Role title
            <input v-model="editMemberForm.roleTitle" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">CF handle
            <input v-model="editMemberForm.cfHandle" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Photo URL
            <input v-model="editMemberForm.photoUrl" type="url" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display order
            <input v-model="editMemberForm.displayOrder" type="number" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <div v-if="editMemberError" role="alert" style="color:#dc2626;font-size:0.8rem">{{ editMemberError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer" @click="editMember=null">Cancel</button>
            <button type="submit" :disabled="editMemberSaving" style="padding:0.35rem 0.8rem;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">
              {{ editMemberSaving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
