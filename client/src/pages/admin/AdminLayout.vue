<script setup lang="ts">
import { useSessionStore } from '@/stores/session.ts';
const session = useSessionStore();
</script>

<template>
  <div style="min-height:100vh;display:grid;grid-template-rows:auto 1fr">
    <!-- Top nav -->
    <nav style="background:#1e293b;color:#e2e8f0;padding:0.6rem 1.5rem;display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap">
      <span style="font-weight:700;color:#fff;margin-right:0.5rem">Admin</span>
      <RouterLink to="/admin/settings"
        style="color:#cbd5e1;text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Settings</RouterLink>
      <RouterLink to="/admin/members"
        style="color:#cbd5e1;text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Members</RouterLink>
      <RouterLink to="/admin/teams"
        style="color:#cbd5e1;text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Teams</RouterLink>
      <RouterLink to="/admin/ops"
        style="color:#cbd5e1;text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Operations</RouterLink>
      <RouterLink to="/admin/audit"
        style="color:#cbd5e1;text-decoration:none;font-size:0.875rem"
        active-class="admin-nav-active">Audit</RouterLink>
      <span style="flex:1"></span>
      <RouterLink to="/dashboard" style="color:#94a3b8;text-decoration:none;font-size:0.8rem">← Site</RouterLink>
    </nav>

    <!-- Page content -->
    <div style="padding:2rem;max-width:80rem;margin:0 auto;width:100%;box-sizing:border-box">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.admin-nav-active {
  color: #fff !important;
  text-decoration: underline !important;
}
</style>
