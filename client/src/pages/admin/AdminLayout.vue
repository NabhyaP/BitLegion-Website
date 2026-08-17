<script setup lang="ts">
import { useSessionStore } from '@/stores/session.ts';
const session = useSessionStore();
</script>

<template>
  <div style="min-height:100vh;display:grid;grid-template-rows:auto 1fr">
    <!-- Top nav -->
    <nav style="background:var(--text);color:var(--line);padding:0.6rem 1.5rem;display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap">
      <span style="font-weight:700;color:var(--surface);margin-right:0.5rem">Admin</span>
      <RouterLink to="/admin/settings"
        style="color:var(--line);text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Settings</RouterLink>
      <RouterLink to="/admin/members"
        style="color:var(--line);text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Members</RouterLink>
      <RouterLink to="/admin/teams"
        style="color:var(--line);text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Teams</RouterLink>
      <RouterLink to="/admin/ops"
        style="color:var(--line);text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Operations</RouterLink>
      <RouterLink to="/admin/audit"
        style="color:var(--line);text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Audit</RouterLink>
      <span style="flex:1"></span>
      <RouterLink to="/dashboard" style="color:var(--muted);text-decoration:none;font-size:0.8rem">← Site</RouterLink>
    </nav>

    <!-- Page content -->
    <div style="padding:2rem;max-width:80rem;margin:0 auto;width:100%;box-sizing:border-box">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.admin-nav-active {
  color: var(--surface) !important;
  text-decoration: underline !important;
}
</style>
