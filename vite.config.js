import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const apiTarget = process.env.STL_API_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  // Same-origin /api in dev and preview keeps the admin session cookie first-party.
  server: { proxy: { '/api': apiTarget } },
  preview: { proxy: { '/api': apiTarget } },
  build: {
    rollupOptions: {
      input: {
        storefront: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
      },
    },
  },
});
