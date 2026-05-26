#!/usr/bin/env node
/**
 * install-dist-deps.mjs
 *
 * 在 vite 构建完成后，为 dist-electron/ 安装运行时依赖。
 * 这样 agent-bridge 子进程、EmbeddingProvider worker 等都能通过
 * Resources/dist-electron/node_modules/ 找到完整的依赖树。
 *
 * 只在打包构建时运行，不影响开发环境。
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distElectronDir = join(__dirname, '..', 'dist-electron');
const projectRoot = join(__dirname, '..', '..');

// ── 1. 清理旧的 node_modules（如果有残余）
const nmDir = join(distElectronDir, 'node_modules');
if (existsSync(nmDir)) {
  rmSync(nmDir, { recursive: true, force: true });
}

// ── 2. 创建 dist-electron/package.json
// 只包含 agent-bridge 运行时真正需要的依赖
const pkg = {
  name: 'xuanji-dist-electron',
  version: '0.1.0',
  private: true,
  type: 'module',
  dependencies: {
    // 核心运行时
    '@xenova/transformers': '^2.17.2',
    'better-sqlite3': '^12.10.0',
    'node-llama-cpp': '^3.0.0',
    'node-pty': '^1.1.0',
    'onnxruntime-node': '^1.14.0',
    'onnxruntime-web': '^1.14.0',
    'sharp': '^0.34.5',
    'sqlite-vec': '^0.1.7-alpha.2',

    // tree-sitter（node-llama-cpp 通过 ESM import 使用）
    'tree-sitter': '^0.21.0',
    'tree-sitter-typescript': '^0.21.0',
    'tree-sitter-python': '^0.21.0',
    'tree-sitter-java': '^0.21.0',

    // 工具库（agent-bridge 直接 import）
    'consola': '^3.2.3',
    'debug': '^4.3.4',
    'fast-glob': '^3.3.2',
    'glob': '^10.3.10',
    'https-proxy-agent': '^7.0.4',
    'json5': '^2.2.3',
    'jszip': '^3.10.1',
    'mammoth': '^1.6.0',
    'openai': '^4.0.0',
    'pino': '^10.3.1',
    'ssh2': '^1.15.0',
    'xlsx': '^0.18.5',
    'yaml': '^2.3.4',
  },
};

writeFileSync(
  join(distElectronDir, 'package.json'),
  JSON.stringify(pkg, null, 2),
  'utf-8',
);

console.log('[install-dist-deps] package.json created');

// ── 3. 检测是否跨平台构建
// macOS 上跑 build:win 时 process.platform === 'darwin' 但目标是 win32
// 跨平台时 native 模块不能从本地复制（架构/平台不匹配），交给 after-pack.mjs 下载。
const isBuildPlatform = process.env.ELECTRON_BUILDER_PLATFORM || '';
const isCrossPlatform = isBuildPlatform &&
  isBuildPlatform !== process.platform;

console.log(`[install-dist-deps] Platform: ${process.platform}, build target: ${isBuildPlatform || '(auto)'}, cross-platform: ${isCrossPlatform}`);

// ── 4. npm install（跳过编译脚本，只下载 prebuilt 包）
console.log('[install-dist-deps] Running npm install...');
execSync('npm install --no-audit --no-fund --ignore-scripts --loglevel=warn', {
  cwd: distElectronDir,
  stdio: 'inherit',
  env: { ...process.env },
  timeout: 300000, // 5min
});

// ── 5. 复制 native 模块的 prebuilt .node 文件从项目根 node_modules
// npm install --ignore-scripts 不会编译 native 模块，
// 所以需要从项目根复制已经编译好的二进制。
// 跨平台构建时跳过——在项目根编译的是当前平台的架构，复制过去会破坏包。
const nativeModules = [
  'better-sqlite3',
  'node-pty',
  'sharp',
  'sqlite-vec',
  'onnxruntime-node',
];
for (const mod of nativeModules) {
  // 跨平台构建：跳过 native 二进制复制
  // macOS arm64 的 .node 文件放到 Windows x64 包里只会导致 ABI 崩溃。
  // after-pack.mjs 会从网络下载正确的目标平台预编译二进制。
  if (isCrossPlatform) {
    console.log(`[install-dist-deps] Cross-platform: skipping native binary copy for ${mod} (relies on afterPack)`);
    continue;
  }

  const srcBuild = join(projectRoot, 'node_modules', mod, 'build');
  const srcBuildRelease = join(projectRoot, 'node_modules', mod, 'build', 'Release');
  const destDir = join(distElectronDir, 'node_modules', mod);

  // 复制 build/（编译产物）
  if (existsSync(srcBuild)) {
    cpSync(srcBuild, join(destDir, 'build'), { recursive: true, force: true });
    console.log(`[install-dist-deps] Copied build/ for ${mod}`);
  } else if (existsSync(srcBuildRelease)) {
    mkdirSync(join(destDir, 'build', 'Release'), { recursive: true });
    cpSync(srcBuildRelease, join(destDir, 'build', 'Release'), { recursive: true, force: true });
    console.log(`[install-dist-deps] Copied build/Release for ${mod}`);
  }

  // 复制 sharp 的 vendor/（libvips 预编译二进制）
  if (mod === 'sharp') {
    const srcVendor = join(projectRoot, 'node_modules', mod, 'vendor');
    if (existsSync(srcVendor)) {
      cpSync(srcVendor, join(destDir, 'vendor'), { recursive: true, force: true });
      console.log('[install-dist-deps] Copied vendor/ for sharp');
    }
    // 复制 sharp 的 build 文件夹下的 install 脚本结果
    const srcInstall = join(projectRoot, 'node_modules', mod, 'install');
    if (existsSync(srcInstall)) {
      cpSync(srcInstall, join(destDir, 'install'), { recursive: true, force: true });
      console.log('[install-dist-deps] Copied install/ for sharp');
    }
  }
}

// ── 5. 处理 @xenova/transformers 内嵌的 sharp
// npm 可能因版本冲突在 transformers 下创建嵌套 node_modules/sharp，
// 但其 native 构建文件未被处理。删除嵌套目录使其回退到父级 sharp（有完整构建文件）。
const nestedSharpDir = join(distElectronDir, 'node_modules', '@xenova', 'transformers', 'node_modules', 'sharp');
if (existsSync(nestedSharpDir)) {
  rmSync(nestedSharpDir, { recursive: true, force: true });
  console.log('[install-dist-deps] Removed nested sharp in @xenova/transformers (falls back to parent)');
}

console.log('[install-dist-deps] Done');
