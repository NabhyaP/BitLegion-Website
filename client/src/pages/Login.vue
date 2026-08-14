<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const MESSAGES: Record<string, string> = {
  'not-college-email': 'Use your college Google account (an @iiitp.ac.in address).',
  'account-suspended': 'This account is suspended. Contact a club admin.',
  'oauth-failure': 'Sign-in could not be completed. Please try again.',
};

const error = computed(() => {
  const code = route.query.error;
  return typeof code === 'string' ? (MESSAGES[code] ?? MESSAGES['oauth-failure']) : null;
});
</script>

<template>
  <h2>Sign in</h2>
  <p v-if="error" role="alert" style="border: 1px solid #b00; padding: 0.5rem">{{ error }}</p>
  <p>BitLegion is open to IIIT Pune students. Sign in with your college Google account.</p>
  <a href="/api/v1/auth/google/start">Sign in with Google</a>
</template>
