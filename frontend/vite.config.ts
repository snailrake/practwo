import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: mode === 'pages' ? 'public-pages' : 'public',
  define: { __BROWSER_PYTHON__: JSON.stringify(mode === 'pages') },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { outDir: mode === 'pages' ? 'pages-dist' : 'dist', chunkSizeWarningLimit: 1200 },
}));
