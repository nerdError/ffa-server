import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        overlay: resolve(__dirname, 'web/overlay.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'web/src'),
    },
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
});