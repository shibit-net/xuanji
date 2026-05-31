/**
 * after-pack.mjs — electron-builder afterPack hook
 *
 * electron-builder 的默认排除规则 `!**\/node_modules/**` 会导致
 * dist-electron/node_modules 无法通过 extraResources 复制到打包产物中。
 *
 * 此 hook 在打包完成后，直接用 Node.js fs 将 dist-electron/node_modules
 * 完整复制到 Resources/dist-electron/，绕开 electron-builder 的文件过滤。
 *
 * 同时也将项目根 node_modules 中 electron-rebuild 编译好的 native 模块
 * 覆盖过去，确保与 Electron 的 NODE_MODULE_VERSION 匹配。
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;

  let resourcesDir;
  if (electronPlatformName === 'darwin') {
    if (appOutDir.endsWith('.app')) {
      resourcesDir = join(appOutDir, 'Contents', 'Resources');
    } else {
      resourcesDir = join(appOutDir, 'xuanji.app', 'Contents', 'Resources');
    }
  } else if (electronPlatformName === 'win32') {
    resourcesDir = join(appOutDir, 'resources');
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const resourcesDistDir = join(resourcesDir, 'dist-electron');
  const srcNodeModules = join(packager.projectDir, 'dist-electron', 'node_modules');
  const destNodeModules = join(resourcesDistDir, 'node_modules');

  if (!existsSync(srcNodeModules)) {
    console.log('[afterPack] dist-electron/node_modules not found at', srcNodeModules);
    return;
  }

  // 确保目标目录存在
  mkdirSync(destNodeModules, { recursive: true });

  // 完整复制 dist-electron/node_modules → resources/dist-electron/node_modules
  console.log('[afterPack] Copying dist-electron/node_modules to resources/dist-electron/node_modules...');
  try {
    cpSync(srcNodeModules, destNodeModules, { recursive: true, force: true });
    console.log('[afterPack] node_modules copy complete');
  } catch (err) {
    console.error('[afterPack] Failed to copy node_modules:', err.message);
    return;
  }

  // 覆盖 Electron 编译版本的 native 模块（由 postinstall 的 electron-builder install-app-deps 编译，位于 desktop/node_modules）
  const projectNodeModules = join(packager.projectDir, 'node_modules');
  const nativeModules = ['better-sqlite3', 'sharp', 'sqlite-vec', 'onnxruntime-node', 'node-pty'];

  for (const mod of nativeModules) {
    const srcBuild = join(projectNodeModules, mod, 'build');
    const destMod = join(destNodeModules, mod);

    if (!existsSync(srcBuild) || !existsSync(destMod)) continue;

    try {
      cpSync(srcBuild, join(destMod, 'build'), { recursive: true, force: true });
      console.log(`[afterPack] Replaced build/ for ${mod}`);
    } catch (err) {
      console.warn(`[afterPack] Failed to replace build/ for ${mod}:`, err.message);
    }

    if (mod === 'sharp') {
      const srcVendor = join(projectNodeModules, mod, 'vendor');
      if (existsSync(srcVendor)) {
        try {
          cpSync(srcVendor, join(destMod, 'vendor'), { recursive: true, force: true });
          console.log('[afterPack] Replaced vendor/ for sharp');
        } catch {}
      }
      const srcInstall = join(projectNodeModules, mod, 'install');
      if (existsSync(srcInstall)) {
        try {
          cpSync(srcInstall, join(destMod, 'install'), { recursive: true, force: true });
          console.log('[afterPack] Replaced install/ for sharp');
        } catch {}
      }
    }
  }

  console.log('[afterPack] Done');
}
