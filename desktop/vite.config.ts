import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

// 构建别名配置函数
function buildAliases() {
  const rootSrc = path.resolve(__dirname, '../src');
  const renderer = path.resolve(__dirname, './renderer');
  
  return {
    // 核心模块指向根目录 src（按字母顺序排列）
    '@/adapters': path.join(rootSrc, 'adapters'),
    '@/auth': path.join(rootSrc, 'auth'),
    '@/butler': path.join(rootSrc, 'butler'),
    '@/context': path.join(rootSrc, 'context'),
    '@/core': path.join(rootSrc, 'core'),
    '@/embedding': path.join(rootSrc, 'embedding'),
    '@/hooks': path.join(rootSrc, 'hooks'),
    '@/infrastructure': path.join(rootSrc, 'infrastructure'),
    '@/mcp': path.join(rootSrc, 'mcp'),
    '@/memory': path.join(rootSrc, 'memory'),
    '@/permission': path.join(rootSrc, 'permission'),
    '@/reminder': path.join(rootSrc, 'reminder'),
    '@/session': path.join(rootSrc, 'session'),
    '@/shared/utils': path.join(rootSrc, 'shared/utils'),
    '@/shared': path.join(rootSrc, 'shared'),
    '@/tiangong': path.join(rootSrc, 'tiangong'),
    '@/types': path.join(rootSrc, 'types'),

    // 原来的别名（desktop 内部使用）
    '@': renderer,
    '@main': path.resolve(__dirname, './main'),
    '@root': path.resolve(__dirname, '..'),
    '@root/src': rootSrc,
  };
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Preload 脚本入口（放在前面，先编译完成，不触发 startup）
        entry: 'main/preload.ts',
        onstart(options) {
          // preload 编译完成后不启动 Electron，等主进程编译完再启动
        },
        vite: {
          resolve: { alias: buildAliases() },
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
      {
        // 主进程入口（后编译，编译完成后启动 Electron）
        entry: 'main/index.ts',
        onstart(options) { options.startup(); },
        vite: {
          resolve: { alias: buildAliases() },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: (id) => {
                if (id === 'electron') return true;
                if (id.startsWith('node:')) return true;
                if (id.startsWith('node-llama-cpp')) return true;
                if (id.startsWith('@node-llama-cpp/')) return true;
                // pino 相关包需要 external，因为它们的 worker 文件需要从 node_modules 加载
                if (['pino', 'thread-stream', 'sonic-boom', 'pino-pretty', 'pino-std-serializers', 'fast-redact', 'process-warning', 'on-exit-leak-free', 'atomic-sleep', 'colorette', 'dateformat', 'joycon', 'strip-json-comments'].includes(id)) return true;
                const builtins = ['path', 'fs', 'url', 'module', 'child_process', 'os', 'crypto', 'stream', 'util', 'events', 'http', 'https', 'net', 'tls', 'zlib', 'buffer', 'querystring', 'assert', 'tty', 'readline', 'worker_threads', 'perf_hooks', 'async_hooks', 'dns', 'dgram'];
                if (builtins.includes(id)) return true;
                return false;
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: { alias: buildAliases() },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 9100,
    fs: {
      allow: ['.', '../'],
    },
  },
});
