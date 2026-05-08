import { defineConfig } from 'tsup';
import path from 'path';
import { buildAliases } from '../tsup-aliases';

export default defineConfig({
  entry: ['main/agent-bridge.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist-electron',
  clean: false,
  dts: false,
  sourcemap: false,
  minify: true,
  external: [
    'electron',
    'better-sqlite3',
    'sqlite-vec',
    '@xenova/transformers',
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-python',
    'tree-sitter-java',
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
  ],
  esbuildOptions: (options) => {
    options.alias = buildAliases(path.resolve(__dirname, '..'));
  },
});
