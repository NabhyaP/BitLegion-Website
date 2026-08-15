import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@contracts': fileURLToPath(new URL('../shared/contracts/index.ts', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '0.0.0.0',   // expose on LAN
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Lazy vendor chunks so the login path stays small (§B4)
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-query': ['@tanstack/vue-query'],
          'vendor-dexie': ['dexie'],
        },
      },
    },
  },
});
