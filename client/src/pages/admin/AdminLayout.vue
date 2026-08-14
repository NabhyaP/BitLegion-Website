<script setup lang="ts">
// Phase 7: full admin layout
</script>
<template>
  <div>
    <nav style="padding:1rem;background:#f1f5f9;display:flex;gap:1rem">
      <RouterLink to="/admin/settings">Settings</RouterLink>
      <RouterLink to="/admin/members">Members</RouterLink>
      <RouterLink to="/admin/teams">Teams</RouterLink>
      <RouterLink to="/admin/ops">Operations</RouterLink>
      <RouterLink to="/admin/audit">Audit</RouterLink>
      <RouterLink to="/">← Site</RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
