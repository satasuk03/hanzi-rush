import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', assetsInlineLimit: 0 },
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version) },
  // `npm run dev:api` serves the Pages Functions on :8788
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
});
