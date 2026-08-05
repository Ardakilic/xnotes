import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'wxt/browser': fileURLToPath(new URL('./shim.ts', import.meta.url)),
    },
  },
});
