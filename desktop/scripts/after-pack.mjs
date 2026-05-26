/**
 * after-pack.mjs — electron-builder afterPack hook
 *
 * electron-builder 的 npmRebuild 会将项目根 node_modules 的 native 模块
 * 重新编译为 Electron 的 NODE_MODULE_VERSION。
 *
 * 此 hook 在 electron-builder 打包完成后，将 Electron 版本的 native 二进制
 * 覆盖到 Resources/dist-electron/node_modules/ 中，确保 agent-bridge
 * 子进程 (ELECTRON_RUN_AS_NODE=1) 能正确加载 better-sqlite3 等模块。
 */

import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;

  // 确定 Resources 路径
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

  const distModules = join(resourcesDir, 'dist-electron', 'node_modules');
  if (!existsSync(distModules)) {
    console.log('[afterPack] dist-electron/node_modules not found at', distModules);
    return;
  }

  // 从项目根 node_modules 复制 Electron 编译的 native 模块
  const projectNodeModules = join(packager.projectDir, 'node_modules');
  const nativeModules = ['better-sqlite3', 'node-pty', 'sharp', 'sqlite-vec', 'onnxruntime-node'];

  for (const mod of nativeModules) {
    const srcBuild = join(projectNodeModules, mod, 'build');
    const destMod = join(distModules, mod);

    if (!existsSync(srcBuild) || !existsSync(destMod)) continue;

    try {
      cpSync(srcBuild, join(destMod, 'build'), { recursive: true, force: true });
      console.log(`[afterPack] Replaced build/ for ${mod}`);
    } catch (err) {
      console.warn(`[afterPack] Failed to replace build/ for ${mod}:`, err.message);
    }

    // sharp 还需要 vendor/ (libvips)
    if (mod === 'sharp') {
      const srcVendor = join(projectNodeModules, mod, 'vendor');
      if (existsSync(srcVendor)) {
        try {
          cpSync(srcVendor, join(destMod, 'vendor'), { recursive: true, force: true });
          console.log('[afterPack] Replaced vendor/ for sharp');
        } catch {}
      }
    }
  }

  console.log('[afterPack] Native module replacement done');
}
