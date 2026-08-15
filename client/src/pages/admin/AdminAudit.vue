<script setup lang="ts">
/**
 * Admin Audit — Phase 7.
 * Newest-first audit log. Filter by actor ID or action keyword. Paginated.
 */
import { ref, reactive, watch } from 'vue';
import { fetchAuditEvents, type AuditParams } from '@/api/index.ts';
import type { AuditEventResponse } from '@contracts';

// ── State ──────────────────────────────────────────────────────────────────
const events = ref<AuditEventResponse[]>([]);
const total = ref(0);
const pages = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);

const filters = reactive<AuditParams & { page: number; pageSize: number }>({
  page: 1, pageSize: 25, actor: undefined, action: '',
});

let _debounce: ReturnType<typeof setTimeout> | null = null;

// ── Fetch ──────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true; error.value = null;
  try {
    const params: AuditParams = { page: filters.page, pageSize: filters.pageSize };
    if (filters.actor) params.actor = filters.actor;
    if (filters.action) params.action = filters.action;
    const res = await fetchAuditEvents(params);
    events.value = res.data;
    total.value = res.meta.total;
    pages.value = res.meta.pages;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load audit events.';
  } finally {
    loading.value = false;
  }
}

watch(() => filters.action, () => {
  if (_debounce) clearTimeout(_debounce);
  _debounce = setTimeout(() => { filters.page = 1; load(); }, 300);
});

load();

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function shortJson(v: unknown): string {
  if (!v) return '—';
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

// Expand a row to show full before/after JSON
const expanded = ref<number | null>(null);
function toggleExpand(id: number) {
  expanded.value = expanded.value === id ? null : id;
}
</script>

<template>
  <div>
    <h1 style="margin:0 0 1.25rem;font-size:1.3rem">Audit Log</h1>

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-bottom:1rem;align-items:flex-end">
      <div>
        <label for="a-action" style="display:block;font-size:0.75rem;color:#475569;margin-bottom:0.2rem">Action keyword</label>
        <input id="a-action" v-model="filters.action" type="search" placeholder="e.g. member.edit"
               style="padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;width:200px" />
      </div>
      <div>
        <label for="a-actor" style="display:block;font-size:0.75rem;color:#475569;margin-bottom:0.2rem">Actor user ID</label>
        <input id="a-actor" v-model.number="filters.actor" type="number" min="1" placeholder="user ID"
               style="padding:0.35rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;width:100px"
               @change="filters.page=1;load()" />
      </div>
      <button style="padding:0.35rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;font-size:0.85rem"
              @click="filters.page=1;load()">Filter</button>
    </div>

    <!-- Error / loading -->
    <div v-if="error" role="alert" style="background:#fee2e2;border-radius:4px;padding:0.75rem;margin-bottom:1rem;font-size:0.9rem">{{ error }}</div>
    <div v-if="loading && !events.length" role="status" style="padding:2rem;text-align:center;color:#94a3b8">Loading…</div>
    <div v-else-if="!events.length && !loading" style="padding:2rem;text-align:center;color:#94a3b8">No audit events found.</div>

    <!-- Table -->
    <div v-else style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem" aria-label="Audit events">
        <thead>
          <tr style="border-bottom:2px solid #e2e8f0;text-align:left;background:#f8fafc">
            <th style="padding:0.5rem" scope="col">Time</th>
            <th style="padding:0.5rem" scope="col">Actor</th>
            <th style="padding:0.5rem" scope="col">Action</th>
            <th style="padding:0.5rem" scope="col">Target</th>
            <th style="padding:0.5rem" scope="col">Before</th>
            <th style="padding:0.5rem" scope="col">After</th>
            <th style="padding:0.5rem" scope="col">Req ID</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="e in events" :key="e.id">
            <tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" @click="toggleExpand(e.id)">
              <td style="padding:0.5rem;color:#64748b;white-space:nowrap">{{ fmtTime(e.createdAt) }}</td>
              <td style="padding:0.5rem">
                <span style="font-weight:500">{{ e.actorName ?? '—' }}</span>
                <span style="font-size:0.7rem;color:#94a3b8;margin-left:0.25rem">#{{ e.actorUserId }}</span>
              </td>
              <td style="padding:0.5rem;font-family:monospace;color:#4f46e5;font-size:0.75rem">{{ e.action }}</td>
              <td style="padding:0.5rem;color:#475569;font-size:0.75rem">
                {{ e.targetType ?? '' }}<span v-if="e.targetId" style="color:#94a3b8"> #{{ e.targetId }}</span>
              </td>
              <td style="padding:0.5rem;color:#64748b;font-size:0.7rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                {{ shortJson(e.beforeJson) }}
              </td>
              <td style="padding:0.5rem;color:#64748b;font-size:0.7rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                {{ shortJson(e.afterJson) }}
              </td>
              <td style="padding:0.5rem;font-size:0.65rem;color:#94a3b8;font-family:monospace">
                {{ e.requestId ? e.requestId.slice(0, 10) + '…' : '—' }}
              </td>
            </tr>
            <!-- Expanded row -->
            <tr v-if="expanded===e.id" style="background:#f8fafc">
              <td colspan="7" style="padding:0.75rem 1rem;font-size:0.8rem">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
                  <div>
                    <div style="font-weight:600;margin-bottom:0.25rem;color:#475569">Before</div>
                    <pre style="margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:0.5rem;font-size:0.75rem;overflow-x:auto;white-space:pre-wrap">{{ JSON.stringify(e.beforeJson, null, 2) }}</pre>
                  </div>
                  <div>
                    <div style="font-weight:600;margin-bottom:0.25rem;color:#475569">After</div>
                    <pre style="margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:0.5rem;font-size:0.75rem;overflow-x:auto;white-space:pre-wrap">{{ JSON.stringify(e.afterJson, null, 2) }}</pre>
                  </div>
                </div>
                <div style="margin-top:0.5rem;font-size:0.75rem;color:#94a3b8">
                  Full Request ID: {{ e.requestId ?? '—' }}
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;font-size:0.8rem;color:#64748b">
      <span>{{ total }} events total</span>
      <div style="display:flex;gap:0.5rem">
        <button :disabled="filters.page <= 1"
                style="padding:0.25rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer"
                @click="filters.page--;load()">← Prev</button>
        <span style="align-self:center">Page {{ filters.page }} / {{ pages }}</span>
        <button :disabled="filters.page >= pages"
                style="padding:0.25rem 0.6rem;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer"
                @click="filters.page++;load()">Next →</button>
      </div>
    </div>
  </div>
</template>
