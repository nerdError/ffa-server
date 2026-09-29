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
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000', // Порт вашего Express-сервера
                changeOrigin: true,
            },
        },
    },
});