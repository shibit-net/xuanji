#!/usr/bin/env node
/**
 * create-dmg.mjs
 *
 * 基于 create-dmg 构建标准 macOS DMG 安装盘。
 *
 * 解决 electron-builder 26.8.1 内建 dmg builder 丢失 Electron Framework
 * 的 bug。create-dmg 生成标准 APFS DMG，自带 Finder 布局、图标和背景。
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, '..');
const releaseDir = join(desktopDir, 'release');

function findApp() {
  const appPath = join(releaseDir, 'mac', 'xuanji.app');
  if (!existsSync(appPath)) {
    console.error('[create-dmg] xuanji.app not found at', appPath);
    process.exit(1);
  }
  return appPath;
}

function getConfig() {
  const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf-8'));
  const version = pkg.version || '0.0.0';
  const app = findApp();
  const archOutput = execSync(`file '${app}/Contents/MacOS/xuanji'`, { encoding: 'utf-8' });
  const arch = archOutput.includes('x86_64') ? 'x64' : archOutput.includes('arm64') ? 'arm64' : 'x64';
  return { version, arch };
}

const appPath = findApp();
const config = getConfig();
const { version, arch } = config;
const outputFilename = `xuanji-${version}-mac-${arch}.dmg`;
const outputDmg = join(releaseDir, outputFilename);

if (existsSync(outputDmg) && !process.env.FORCE_REBUILD) {
  console.log(`[create-dmg] DMG exists: ${outputDmg} (FORCE_REBUILD=1 to overwrite)`);
  process.exit(0);
}

// 清除之前失败的残余
rmSync(join(releaseDir, '.dmg-rw.dmg'), { force: true });
rmSync(join(releaseDir, '.dmg-installer-tmp'), { recursive: true, force: true });

console.log(`[create-dmg] Creating DMG from ${appPath}`);

execSync(
  `npx create-dmg '${appPath}' '${releaseDir}'` +
  ` --overwrite` +
  ` --dmg-title='xuanji'` +
  ` --no-code-sign`,
  { cwd: desktopDir, stdio: 'inherit', timeout: 600000 }
);

// 重命名
const createdDmg = join(releaseDir, `xuanji ${version}.dmg`);
rmSync(join(releaseDir, 'xuanji.dmg'), { force: true });
if (existsSync(createdDmg)) {
  rmSync(outputDmg, { force: true });
  execSync(`mv '${createdDmg}' '${outputDmg}'`, { timeout: 10000 });
  console.log(`[create-dmg] Renamed to: ${outputDmg}`);
}

console.log(`[create-dmg] Done: ${outputDmg}`);
