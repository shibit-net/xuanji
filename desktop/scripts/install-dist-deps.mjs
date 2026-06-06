#!/usr/bin/env node
/**
 * install-dist-deps.mjs
 *
 * 在 vite 构建完成后，为 dist-electron/ 安装运行时依赖。
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distElectronDir = join(__dirname, '..', 'dist-electron');
const desktopDir = join(__dirname, '..');

// 1. 清理
const nmDir = join(distElectronDir, 'node_modules');
if (existsSync(nmDir)) {
  rmSync(nmDir, { recursive: true, force: true });
}

// 清理残留的 .bin 目录（符号链接是 npm 自动创建的，打包后的 app 不需要）
const cleanBinDirs = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name === '.bin') {
      rmSync(full, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      cleanBinDirs(full);
    }
  }
};

// 2. 创建 dist-electron/package.json（版本与项目 package.json 对齐）
const pkg = {
  name: 'xuanji-dist-electron',
  version: '0.1.0',
  private: true,
  dependencies: {
    '@anthropic-ai/sdk': '^0.60.0',
    '@xenova/transformers': '^2.17.2',
    'better-sqlite3': '^12.10.0',
    'consola': '^3.4.2',
    'debug': '^4.4.3',
    'docx': '^9.6.1',
    'fast-glob': '^3.3.3',
    'glob': '^10.3.10',
    'https-proxy-agent': '^7.0.4',
    'js-yaml': '^4.1.0',
    'json5': '^2.2.3',
    'jszip': '^3.10.1',
    'mammoth': '^1.12.0',
    'node-llama-cpp': '^3.0.0',
    'node-pty': '^1.1.0',
    'onnxruntime-node': '^1.14.0',
    'onnxruntime-web': '^1.14.0',
    'openai': '^6.22.0',
    'pdf-lib': '^1.17.1',
    'pdf-parse': '^2.4.5',
    'picomatch': '^4.0.2',
    'pino': '^10.3.1',
    'sharp': '^0.34.5',
    'ssh2': '^1.17.0',
    'sqlite-vec': '^0.1.7-alpha.2',
    'tree-sitter': '^0.21.0',
    'tree-sitter-typescript': '^0.21.0',
    'tree-sitter-python': '^0.21.0',
    'tree-sitter-java': '^0.21.0',
    'turndown': '^7.2.2',
    'xlsx': '^0.18.5',
    'yaml': '^2.8.2',
  },
};

writeFileSync(join(distElectronDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
console.log('[install-dist-deps] package.json created');

// 3. npm install
console.log('[install-dist-deps] Running npm install...');
execSync('npm install --no-audit --no-fund --ignore-scripts --loglevel=warn', {
  cwd: distElectronDir,
  stdio: 'inherit',
  env: { ...process.env },
  timeout: 300000,
});

// 3.5. 清理所有 .bin 目录中的绝对路径符号链接（npm --ignore-scripts 仍会生成 .bin，打包后无用且会导致 universal 合并失败）
console.log('[install-dist-deps] Cleaning .bin symlinks...');
cleanBinDirs(nmDir);
console.log('[install-dist-deps] .bin symlinks cleaned');

// 4. 复制 native 模块的预编译二进制（从 desktop/node_modules/ — 由 postinstall 的 electron-builder install-app-deps 针对 Electron ABI 编译）
const nativeModules = ['better-sqlite3', 'node-pty', 'sharp', 'sqlite-vec', 'onnxruntime-node'];
for (const mod of nativeModules) {
  const srcBuild = join(desktopDir, 'node_modules', mod, 'build');
  const destDir = join(distElectronDir, 'node_modules', mod);
  if (existsSync(srcBuild)) {
    cpSync(srcBuild, join(destDir, 'build'), { recursive: true, force: true });
    console.log(`[install-dist-deps] Copied build/ for ${mod} (from desktop/node_modules — Electron ABI)`);
  }
  if (mod === 'sharp') {
    for (const sub of ['vendor', 'install']) {
      const s = join(desktopDir, 'node_modules', mod, sub);
      if (existsSync(s)) cpSync(s, join(destDir, sub), { recursive: true, force: true });
    }
  }
}

// 5. 清理嵌套 sharp
const nestedSharpDir = join(nmDir, '@xenova', 'transformers', 'node_modules', 'sharp');
if (existsSync(nestedSharpDir)) {
  rmSync(nestedSharpDir, { recursive: true, force: true });
}

console.log('[install-dist-deps] Done');
