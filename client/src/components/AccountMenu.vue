<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session.ts';

const session = useSessionStore();
const router = useRouter();
const root = ref<HTMLElement | null>(null);
const open = ref(false);
const signingOut = ref(false);
const signOutError = ref(false);

const profilePath = computed(() => session.cfHandle
  ? `/profile/${encodeURIComponent(session.cfHandle.toLowerCase())}`
  : '/onboarding');
const initial = computed(() => session.me?.displayName.trim().charAt(0).toUpperCase() || '?');

function close() {
  open.value = false;
}

function onPointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

async function signOut() {
  signingOut.value = true;
  signOutError.value = false;
  try {
    await session.logout();
    close();
    await router.push('/');
  } catch {
    signOutError.value = true;
  } finally {
    signingOut.value = false;
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div v-if="session.me" ref="root" class="account-menu">
    <button
      type="button"
      class="account-trigger"
      aria-label="Open account menu"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <img v-if="session.me.avatarUrl" :src="session.me.avatarUrl" alt="" width="24" height="24" />
      <span v-else class="account-initial" aria-hidden="true">{{ initial }}</span>
      <span class="account-name">{{ session.me.displayName }}</span>
      <span class="account-caret" aria-hidden="true">v</span>
    </button>

    <div v-if="open" class="account-popover" role="menu">
      <RouterLink :to="profilePath" role="menuitem" @click="close">
        {{ session.cfHandle ? 'My profile' : 'Complete profile' }}
      </RouterLink>
      <RouterLink to="/dashboard" role="menuitem" @click="close">Dashboard</RouterLink>
      <RouterLink to="/settings" role="menuitem" @click="close">Settings</RouterLink>
      <RouterLink v-if="session.isAdmin" to="/admin" role="menuitem" @click="close">Admin</RouterLink>
      <button type="button" role="menuitem" :disabled="signingOut" @click="signOut">
        {{ signingOut ? 'Signing out...' : 'Sign out' }}
      </button>
      <p v-if="signOutError" role="alert">Sign out failed. Try again.</p>
    </div>
  </div>
</template>

<style scoped>
.account-menu {
  position: relative;
}

.account-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 32px;
  max-width: min(18rem, 65vw);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.2rem 0.45rem;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font: inherit;
}

.account-trigger img,
.account-initial {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex: 0 0 24px;
}

.account-trigger img {
  object-fit: cover;
}

.account-initial {
  display: grid;
  place-items: center;
  background: var(--line);
  color: var(--text);
  font-size: 0.75rem;
  font-weight: 700;
}

.account-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
}

.account-caret {
  color: var(--muted);
  font-size: 0.7rem;
}

.account-popover {
  position: absolute;
  z-index: 50;
  top: calc(100% + 0.35rem);
  right: 0;
  display: grid;
  width: 11rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.25rem;
  background: var(--surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
}

.account-popover a,
.account-popover button {
  width: 100%;
  border: 0;
  border-radius: 3px;
  padding: 0.5rem 0.6rem;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  text-align: left;
  text-decoration: none;
}

.account-popover a:hover,
.account-popover a:focus-visible,
.account-popover button:hover,
.account-popover button:focus-visible {
  background: var(--surface-2);
  outline: none;
}

.account-popover button:disabled {
  color: var(--muted);
  cursor: wait;
}

.account-popover p {
  margin: 0.25rem 0.5rem;
  color: var(--danger);
  font-size: 0.72rem;
}
</style>
