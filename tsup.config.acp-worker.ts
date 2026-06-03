import { defineConfig } from 'tsup';
import path from 'path';
import { buildAliases } from './tsup-aliases';

export default defineConfig({
  entry: ['src/infrastructure/acp/acp-worker.ts'],
  format: ['esm'],
  target: 'esnext',
  outDir: 'desktop/build-resources',
  clean: false,
  dts: false,
  sourcemap: false,
  minify: true,
  external: [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-python',
    'tree-sitter-java',
  ],
  esbuildOptions: (options) => {
    options.alias = buildAliases(__dirname);
  },
});
