import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: 'main/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: (id) => {
                if (id === 'electron') return true;
                if (id.startsWith('node:')) return true;
                const builtins = ['path', 'fs', 'url', 'module', 'child_process', 'os', 'crypto', 'stream', 'util', 'events', 'http', 'https', 'net', 'tls', 'zlib', 'buffer', 'querystring', 'assert', 'tty', 'readline', 'worker_threads', 'perf_hooks', 'async_hooks', 'dns', 'dgram'];
                if (builtins.includes(id)) return true;
                return false;
              },
            },
          },
        },
      },
      {
        // Preload 脚本入口
        entry: 'main/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './renderer'),
      '@main': path.resolve(__dirname, './main'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 9100,
  },
});
