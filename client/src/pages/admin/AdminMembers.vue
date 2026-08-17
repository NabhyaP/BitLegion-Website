<script setup lang="ts">
/**
 * Admin Members — Phase 7.
 * Features: list with filter/search/pagination, edit modal, add single,
 * CSV import with per-row error report, role management, CF link clear.
 * All mutations are server-audited. §0.3: no logic in template.
 */
import { ref, reactive, watch } from 'vue';
import {
  fetchAdminMembers, updateAdminMember, createAdminMember,
  clearAdminCfLink, patchAdminRoles, importMembersCSV,
  type AdminMemberResponse, type AdminMembersParams, type CsvImportResult,
} from '@/api/index.ts';
import { ApiError } from '@/api/index.ts';

// ── State ──────────────────────────────────────────────────────────────────
const members = ref<AdminMemberResponse[]>([]);
const total = ref(0);
const pages = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);

const filters = reactive<Omit<AdminMembersParams, 'page' | 'pageSize'> & { page: number; pageSize: number }>({ page: 1, pageSize: 25, q: '', status: '', branch: '', year: undefined });

let _debounce: ReturnType<typeof setTimeout> | null = null;

const STATUSES = ['ACTIVE', 'PENDING', 'SUSPENDED', 'ALUMNI'];
const BRANCHES = ['CSE', 'ECE'];
const currentYear = new Date().getFullYear();
const batchYears = Array.from({ length: currentYear - 2019 + 2 }, (_, i) => 2019 + i);

// ── Fetch ──────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params: AdminMembersParams = { page: filters.page, pageSize: filters.pageSize };
    if (filters.q) params.q = filters.q;
    if (filters.status) params.status = filters.status;
    if (filters.branch) params.branch = filters.branch;
    if (filters.year) params.year = filters.year;
    const res = await fetchAdminMembers(params);
    members.value = res.data;
    total.value = res.meta.total;
    pages.value = res.meta.pages;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load members.';
  } finally {
    loading.value = false;
  }
}

watch([() => filters.status, () => filters.branch, () => filters.year], () => {
  filters.page = 1; load();
});
watch(() => filters.q, () => {
  if (_debounce) clearTimeout(_debounce);
  _debounce = setTimeout(() => { filters.page = 1; load(); }, 300);
});

load();

// ── Edit modal ─────────────────────────────────────────────────────────────
const editing = ref<AdminMemberResponse | null>(null);
const editForm = reactive({ displayName: '', rollNo: '', batchYear: '', branch: '', status: '', showInLeaderboard: true });
const editSaving = ref(false);
const editError = ref<string | null>(null);

function openEdit(m: AdminMemberResponse) {
  editing.value = m;
  editForm.displayName = m.displayName;
  editForm.rollNo = m.rollNo ?? '';
  editForm.batchYear = m.batchYear ? String(m.batchYear) : '';
  editForm.branch = m.branch ?? '';
  editForm.status = m.status;
  editForm.showInLeaderboard = m.showInLeaderboard;
  editError.value = null;
}

async function saveEdit() {
  if (!editing.value) return;
  editSaving.value = true; editError.value = null;
  try {
    await updateAdminMember(editing.value.id, {
      displayName: editForm.displayName || undefined,
      rollNo: editForm.rollNo || null,
      batchYear: editForm.batchYear ? Number(editForm.batchYear) : null,
      branch: editForm.branch || null,
      status: editForm.status || undefined,
      showInLeaderboard: editForm.showInLeaderboard,
    });
    editing.value = null;
    load();
  } catch (e) {
    editError.value = e instanceof ApiError ? e.message : 'Save failed.';
  } finally {
    editSaving.value = false;
  }
}

// ── CF link clear ──────────────────────────────────────────────────────────
const clearingLink = ref<number | null>(null);
async function doClearLink(userId: number) {
  if (!confirm('Remove this user\'s Codeforces link? This cannot be undone without re-linking.')) return;
  clearingLink.value = userId;
  try { await clearAdminCfLink(userId); load(); }
  catch (e) { alert(e instanceof Error ? e.message : 'Failed.'); }
  finally { clearingLink.value = null; }
}

// ── Role modal ─────────────────────────────────────────────────────────────
const rolesTarget = ref<AdminMemberResponse | null>(null);
const rolesForm = reactive<Record<string, boolean>>({});
const rolesSaving = ref(false);
const rolesError = ref<string | null>(null);
const ALL_ROLES = ['MEMBER', 'MENTOR', 'EDITOR', 'MODERATOR', 'ADMIN', 'SUPERADMIN'];

function openRoles(m: AdminMemberResponse) {
  rolesTarget.value = m;
  for (const r of ALL_ROLES) rolesForm[r] = m.roles.includes(r);
  rolesError.value = null;
}

async function saveRoles() {
  if (!rolesTarget.value) return;
  rolesSaving.value = true; rolesError.value = null;
  const before = rolesTarget.value.roles;
  const grant = ALL_ROLES.filter((r) => rolesForm[r] && !before.includes(r));
  const revoke = ALL_ROLES.filter((r) => !rolesForm[r] && before.includes(r));
  try {
    await patchAdminRoles(rolesTarget.value.id, { grant, revoke });
    rolesTarget.value = null;
    load();
  } catch (e) {
    rolesError.value = e instanceof ApiError ? e.message : 'Save failed.';
  } finally {
    rolesSaving.value = false;
  }
}

// ── Add single member modal ────────────────────────────────────────────────
const addOpen = ref(false);
const addForm = reactive({ collegeEmail: '', displayName: '', batchYear: '', branch: '' });
const addSaving = ref(false);
const addError = ref<string | null>(null);

async function doAdd() {
  addSaving.value = true; addError.value = null;
  try {
    await createAdminMember({
      collegeEmail: addForm.collegeEmail.trim(),
      displayName: addForm.displayName.trim(),
      batchYear: addForm.batchYear ? Number(addForm.batchYear) : null,
      branch: addForm.branch || null,
    });
    addOpen.value = false;
    addForm.collegeEmail = addForm.displayName = addForm.batchYear = addForm.branch = '';
    load();
  } catch (e) {
    addError.value = e instanceof ApiError ? e.message : 'Create failed.';
  } finally {
    addSaving.value = false;
  }
}

// ── CSV import ─────────────────────────────────────────────────────────────
const csvOpen = ref(false);
const csvText = ref('');
const csvResult = ref<CsvImportResult | null>(null);
const csvSaving = ref(false);
const csvError = ref<string | null>(null);

function parseCsv(raw: string): unknown[] {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = (lines[0] as string).split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

async function doImport() {
  csvSaving.value = true; csvError.value = null; csvResult.value = null;
  try {
    const rows = parseCsv(csvText.value);
    if (rows.length === 0) { csvError.value = 'No data rows found. Check CSV format.'; csvSaving.value = false; return; }
    if (rows.length > 2000) { csvError.value = 'Maximum 2,000 rows per import.'; csvSaving.value = false; return; }
    const res = await importMembersCSV(rows);
    csvResult.value = res.data;
    load();
  } catch (e) {
    csvError.value = e instanceof ApiError ? e.message : 'Import failed.';
  } finally {
    csvSaving.value = false;
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;gap:0.5rem">
      <h1 style="margin:0;font-size:1.3rem">Members</h1>
      <div style="display:flex;gap:0.5rem">
        <button style="padding:0.35rem 0.8rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer"
                @click="addOpen=true">+ Add member</button>
        <button style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                @click="csvOpen=true">CSV import</button>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-bottom:1rem;align-items:flex-end">
      <div>
        <label for="m-q" style="display:block;font-size:0.75rem;color:var(--muted);margin-bottom:0.2rem">Search</label>
        <input id="m-q" v-model="filters.q" type="search" placeholder="Name / email / handle"
               style="padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.85rem;width:200px" />
      </div>
      <div>
        <label for="m-status" style="display:block;font-size:0.75rem;color:var(--muted);margin-bottom:0.2rem">Status</label>
        <select id="m-status" v-model="filters.status"
                style="padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.85rem">
          <option value="">All</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div>
        <label for="m-branch" style="display:block;font-size:0.75rem;color:var(--muted);margin-bottom:0.2rem">Branch</label>
        <select id="m-branch" v-model="filters.branch"
                style="padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.85rem">
          <option value="">All</option>
          <option v-for="b in BRANCHES" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>
      <div>
        <label for="m-year" style="display:block;font-size:0.75rem;color:var(--muted);margin-bottom:0.2rem">Batch</label>
        <select id="m-year" v-model="filters.year"
                style="padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;font-size:0.85rem">
          <option :value="undefined">All</option>
          <option v-for="y in batchYears" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
    </div>

    <!-- Error / loading -->
    <div v-if="error" role="alert" style="background:var(--danger-bg);border-radius:4px;padding:0.75rem;margin-bottom:1rem;font-size:0.9rem">{{ error }}</div>
    <div v-if="loading && !members.length" role="status" style="padding:2rem;text-align:center;color:var(--muted)">Loading…</div>

    <!-- Table -->
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem" aria-label="Members">
        <thead>
          <tr style="border-bottom:2px solid var(--line);text-align:left;background:var(--surface)">
            <th style="padding:0.5rem" scope="col">Name</th>
            <th style="padding:0.5rem" scope="col">Email</th>
            <th style="padding:0.5rem" scope="col">Batch</th>
            <th style="padding:0.5rem" scope="col">Branch</th>
            <th style="padding:0.5rem" scope="col">Status</th>
            <th style="padding:0.5rem" scope="col">CF</th>
            <th style="padding:0.5rem" scope="col">Roles</th>
            <th style="padding:0.5rem" scope="col">LB</th>
            <th style="padding:0.5rem" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id" style="border-bottom:1px solid var(--surface)">
            <td style="padding:0.5rem;font-weight:500">{{ m.displayName }}</td>
            <td style="padding:0.5rem;color:var(--muted);font-size:0.75rem">{{ m.collegeEmail }}</td>
            <td style="padding:0.5rem;color:var(--muted)">{{ m.batchYear ?? '—' }}</td>
            <td style="padding:0.5rem;color:var(--muted)">{{ m.branch ?? '—' }}</td>
            <td style="padding:0.5rem">
              <span :style="{
                padding:'0.15rem 0.5rem',borderRadius:'10px',fontSize:'0.7rem',fontWeight:600,
                background: m.status==='ACTIVE'?'var(--ok-bg)':m.status==='PENDING'?'var(--warn-bg)':m.status==='SUSPENDED'?'var(--danger-bg)':'var(--surface)',
                color: m.status==='ACTIVE'?'var(--ok)':m.status==='PENDING'?'var(--warn)':m.status==='SUSPENDED'?'var(--danger)':'var(--muted)'
              }">{{ m.status }}</span>
            </td>
            <td style="padding:0.5rem">
              <span v-if="m.cfHandle" style="font-size:0.75rem">
                {{ m.cfHandle }}
                <button style="font-size:0.7rem;color:var(--danger);cursor:pointer;background:none;border:none;padding:0 0.2rem"
                        :disabled="clearingLink===m.id"
                        @click="doClearLink(m.id)">✕</button>
              </span>
              <span v-else style="color:var(--muted);font-size:0.75rem">—</span>
            </td>
            <td style="padding:0.5rem;font-size:0.7rem;color:var(--muted)">
              {{ m.roles.filter(r=>r!=='MEMBER').join(', ') || 'MEMBER' }}
            </td>
            <td style="padding:0.5rem;text-align:center">
              <span v-if="m.showInLeaderboard" style="color:var(--ok)" title="Shown in leaderboard">✓</span>
              <span v-else style="color:var(--danger)" title="Hidden from leaderboard">✕</span>
            </td>
            <td style="padding:0.5rem;white-space:nowrap">
              <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid var(--line);border-radius:3px;margin-right:0.25rem"
                      @click="openEdit(m)">Edit</button>
              <button style="font-size:0.75rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid var(--line);border-radius:3px"
                      @click="openRoles(m)">Roles</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;font-size:0.8rem;color:var(--muted)">
      <span>{{ total }} members total</span>
      <div style="display:flex;gap:0.5rem">
        <button :disabled="filters.page <= 1" style="padding:0.25rem 0.6rem;border:1px solid var(--line);border-radius:4px;cursor:pointer;disabled:opacity-50"
                @click="filters.page--;load()">← Prev</button>
        <span style="align-self:center">Page {{ filters.page }} / {{ pages }}</span>
        <button :disabled="filters.page >= pages" style="padding:0.25rem 0.6rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                @click="filters.page++;load()">Next →</button>
      </div>
    </div>

    <!-- ── Edit modal ── -->
    <div v-if="editing" role="dialog" aria-modal="true" aria-label="Edit member"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:var(--surface);border-radius:8px;padding:1.5rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto">
        <h2 style="font-size:1rem;margin:0 0 1rem">Edit: {{ editing.displayName }}</h2>
        <form @submit.prevent="saveEdit" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">Display name
            <input v-model="editForm.displayName" maxlength="100" required
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Roll no
            <input v-model="editForm.rollNo" maxlength="20"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Batch year
            <input v-model="editForm.batchYear" type="number" min="2000" max="2100"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Branch
            <select v-model="editForm.branch" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem">
              <option value="">—</option>
              <option v-for="b in BRANCHES" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <label style="font-size:0.85rem">Status
            <select v-model="editForm.status" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem">
              <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label style="font-size:0.85rem;display:flex;align-items:center;gap:0.5rem">
            <input v-model="editForm.showInLeaderboard" type="checkbox" />
            Show in leaderboard
          </label>
          <div v-if="editError" role="alert" style="color:var(--danger);font-size:0.8rem">{{ editError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                    @click="editing=null">Cancel</button>
            <button type="submit" :disabled="editSaving"
                    style="padding:0.35rem 0.8rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer">
              {{ editSaving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Roles modal ── -->
    <div v-if="rolesTarget" role="dialog" aria-modal="true" aria-label="Manage roles"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:var(--surface);border-radius:8px;padding:1.5rem;width:100%;max-width:360px">
        <h2 style="font-size:1rem;margin:0 0 1rem">Roles: {{ rolesTarget.displayName }}</h2>
        <div style="display:grid;gap:0.5rem;margin-bottom:1rem">
          <label v-for="r in ALL_ROLES" :key="r" style="display:flex;align-items:center;gap:0.6rem;font-size:0.875rem">
            <input v-model="rolesForm[r]" type="checkbox" />
            {{ r }}
          </label>
        </div>
        <div v-if="rolesError" role="alert" style="color:var(--danger);font-size:0.8rem;margin-bottom:0.75rem">{{ rolesError }}</div>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end">
          <button style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                  @click="rolesTarget=null">Cancel</button>
          <button :disabled="rolesSaving"
                  style="padding:0.35rem 0.8rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer"
                  @click="saveRoles">
            {{ rolesSaving ? 'Saving…' : 'Save roles' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Add member modal ── -->
    <div v-if="addOpen" role="dialog" aria-modal="true" aria-label="Add member"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:var(--surface);border-radius:8px;padding:1.5rem;width:100%;max-width:400px">
        <h2 style="font-size:1rem;margin:0 0 1rem">Add pre-provisioned member</h2>
        <form @submit.prevent="doAdd" style="display:grid;gap:0.75rem">
          <label style="font-size:0.85rem">College email *
            <input v-model="addForm.collegeEmail" type="email" required
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Display name *
            <input v-model="addForm.displayName" required maxlength="100"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Batch year
            <input v-model="addForm.batchYear" type="number" min="2000" max="2100"
                   style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem;box-sizing:border-box" />
          </label>
          <label style="font-size:0.85rem">Branch
            <select v-model="addForm.branch" style="display:block;width:100%;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:4px;margin-top:0.2rem">
              <option value="">—</option>
              <option v-for="b in BRANCHES" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <div v-if="addError" role="alert" style="color:var(--danger);font-size:0.8rem">{{ addError }}</div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                    @click="addOpen=false">Cancel</button>
            <button type="submit" :disabled="addSaving"
                    style="padding:0.35rem 0.8rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer">
              {{ addSaving ? 'Adding…' : 'Add member' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── CSV import modal ── -->
    <div v-if="csvOpen" role="dialog" aria-modal="true" aria-label="CSV import"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:var(--surface);border-radius:8px;padding:1.5rem;width:100%;max-width:560px;max-height:90vh;overflow-y:auto">
        <h2 style="font-size:1rem;margin:0 0 0.75rem">CSV Import</h2>
        <p style="font-size:0.8rem;color:var(--muted);margin:0 0 0.75rem">
          CSV format: <code>display_name,college_email,batch_year,branch</code><br/>
          First row is the header. Max 2,000 rows. Existing emails are skipped.
        </p>
        <textarea v-model="csvText" rows="8"
                  placeholder="display_name,college_email,batch_year,branch&#10;Alice,alice@cse.iiitp.ac.in,2024,CSE"
                  style="width:100%;padding:0.5rem;border:1px solid var(--line);border-radius:4px;font-size:0.8rem;font-family:monospace;box-sizing:border-box"></textarea>
        <div v-if="csvError" role="alert" style="color:var(--danger);font-size:0.8rem;margin-top:0.5rem">{{ csvError }}</div>

        <!-- Result report -->
        <div v-if="csvResult" style="margin-top:0.75rem;font-size:0.85rem">
          <div style="color:var(--ok)">✓ Imported: {{ csvResult.imported }}</div>
          <div style="color:var(--warn)">Skipped (duplicate): {{ csvResult.skipped }}</div>
          <div v-if="csvResult.errors.length" style="margin-top:0.5rem">
            <div style="color:var(--danger);font-weight:600">Errors ({{ csvResult.errors.length }}):</div>
            <ul style="margin:0.25rem 0 0;padding-left:1.25rem;font-size:0.75rem;max-height:8rem;overflow-y:auto">
              <li v-for="e in csvResult.errors" :key="e.row">Row {{ e.row }} ({{ e.email }}): {{ e.reason }}</li>
            </ul>
          </div>
        </div>

        <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem">
          <button style="padding:0.35rem 0.8rem;border:1px solid var(--line);border-radius:4px;cursor:pointer"
                  @click="csvOpen=false;csvResult=null;csvText=''">Close</button>
          <button :disabled="csvSaving || !csvText.trim()"
                  style="padding:0.35rem 0.8rem;background:var(--accent);color:var(--surface);border:none;border-radius:4px;cursor:pointer"
                  @click="doImport">
            {{ csvSaving ? 'Importing…' : 'Import' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
