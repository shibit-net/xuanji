import { defineConfig } from 'tsup';
import path from 'path';
import fs from 'fs';
import { buildAliases } from '../tsup-aliases';

export default defineConfig({
  entry: ['main/agent-bridge.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist-electron',
  clean: true,
  dts: false,
  sourcemap: false,
  minify: true,
  // 禁用代码分割，避免拆成独立 chunk（打包后 node_modules 不可用）
  splitting: false,
  // 内联所有非 native 的 npm 包（pino, yaml, json5, axios 等），native 包保持 external
  noExternal: [/^(?!(@node-llama-cpp|node-llama-cpp|@reflink|better-sqlite3|sqlite-vec|@xenova|tree-sitter|ssh2|cpu-features|node-pty))/],
  external: [
    'better-sqlite3',
    'sqlite-vec',
    '@xenova/transformers',
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-python',
    'tree-sitter-java',
    'node-llama-cpp',
    '@node-llama-cpp/darwin-arm64',
    '@node-llama-cpp/darwin-x64',
    '@node-llama-cpp/linux-x64-cuda',
    '@node-llama-cpp/linux-x64-cuda-ext',
    '@node-llama-cpp/linux-x64-vulkan',
    '@node-llama-cpp/linux-x64',
    '@node-llama-cpp/linux-arm64',
    '@node-llama-cpp/linux-armv7l',
    '@node-llama-cpp/win-x64-cuda',
    '@node-llama-cpp/win-x64-cuda-ext',
    '@node-llama-cpp/win-x64-vulkan',
    '@node-llama-cpp/win-x64',
    '@node-llama-cpp/win-arm64',
    '@reflink',
    'ssh2',
    'cpu-features',
    'node-pty',
  ],
  esbuildOptions: (options) => {
    const aliases = buildAliases(path.resolve(__dirname, '..'));
    // 子进程（纯 Node.js）中 electron 不可用，用 stub 替代
    aliases['electron'] = path.resolve(__dirname, 'main', 'electron-stub.ts');
    options.alias = aliases;
    options.banner = {
      js: `import{createRequire}from'module';import{fileURLToPath}from'url';import{dirname}from'path';const __filename=fileURLToPath(import.meta.url);const __dirname=dirname(__filename);const require=createRequire(import.meta.url);`,
    };
  },
  async onSuccess() {
    const src = path.resolve(__dirname, '..', 'src', 'skills', 'skill-worker.js');
    const dest = path.resolve(__dirname, 'dist-electron', 'skill-worker.js');
    fs.copyFileSync(src, dest);
    console.log('[agent-bridge] skill-worker.js copied to dist-electron/');
  },
});
