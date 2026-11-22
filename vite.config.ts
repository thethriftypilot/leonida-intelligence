import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.LI_DEV_API ?? 'http://localhost:5180';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/tiles': apiTarget,
    },
  },
});
