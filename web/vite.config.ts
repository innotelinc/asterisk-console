import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  }
});
