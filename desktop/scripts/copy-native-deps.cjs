#!/usr/bin/env node
/**
 * 复制子进程所需的 native 依赖到 dist-electron/node_modules/
 *
 * agent-bridge 子进程通过 NODE_PATH 从 dist-electron/node_modules/ 加载模块。
 * 只复制那些在根 node_modules 中但不在对应包 nested node_modules 中的顶层依赖。
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist-electron', 'node_modules');
const SRC = path.join(__dirname, '..', '..', 'node_modules');

// ─── 需要复制的包（只包含缺失的）────────────────────────
const PACKAGES = [
  // agent-bridge 直接 import 的
  'better-sqlite3',
  'node-pty',
  'sharp',
  'sqlite-vec',
  'node-llama-cpp',
  '@node-llama-cpp',
  '@xenova/transformers',

  // onnx 及其依赖
  'onnxruntime-node',
  'onnxruntime-web',
  'onnxruntime-common',
  'onnx-proto',
  'flatbuffers',
  'long',
  'platform',
  'guid-typescript',

  // node-llama-cpp hoist 到顶层、不在 nested 中的依赖
  'lifecycle-utils',
  '@huggingface/jinja',

  // sharp hoist 到顶层、不在 nested 中的依赖
  'got',
  'tunnel-agent',

  // node-llama-cpp 的 @scope 子包
  '@kwsites/file-exists',
  '@kwsites/promise-deferred',
  '@simple-git/args-pathspec',
  '@simple-git/argv-parser',
  '@isaacs/fs-minipass',
  '@tinyhttp/content-disposition',
];

function copyPackage(pkgName) {
  const parts = pkgName.split('/');
  if (parts.length < 1 || parts.length > 2) {
    console.log(`  [SKIP] ${pkgName} — invalid name`);
    return false;
  }
  const srcPath = parts.length === 2
    ? path.join(SRC, parts[0], parts[1])
    : path.join(SRC, pkgName);

  if (!fs.existsSync(srcPath)) {
    console.log(`  [SKIP] ${pkgName} — not found`);
    return false;
  }

  const destPath = parts.length === 2
    ? path.join(DIST, parts[0], parts[1])
    : path.join(DIST, pkgName);

  if (fs.existsSync(destPath)) {
    console.log(`  [OK]   ${pkgName}`);
    return true;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.cpSync(srcPath, destPath, { recursive: true, force: true });
  console.log(`  [COPY] ${pkgName}`);
  return true;
}

console.log('\n=== Copying dependencies to dist-electron/node_modules/ ===\n');

PACKAGES.sort().forEach(copyPackage);

// 统计
let totalSize = 0, totalDirs = 0;
function countDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir)) {
    const f = path.join(dir, e);
    if (fs.statSync(f).isDirectory()) { countDir(f); totalDirs++; }
    else { totalSize += fs.statSync(f).size; }
  }
}
countDir(DIST);
console.log(`\n=== Done: ${totalDirs} dirs, ${(totalSize / 1024 / 1024).toFixed(1)} MB ===`);
