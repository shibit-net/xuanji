/**
 * after-pack.mjs — electron-builder afterPack hook
 *
 * electron-builder 的 npmRebuild 会将项目根 node_modules 的 native 模块
 * 重新编译为 Electron 的 NODE_MODULE_VERSION，但 install-dist-deps.mjs
 * 在 build:pre 阶段下载的是系统 Node.js 版本的 prebuilt 二进制。
 *
 * 此 hook 在 electron-builder 打包完成后，将 Electron 版本的 native 二进制
 * 覆盖到 Resources/dist-electron/node_modules/ 中，确保 agent-bridge
 * 子进程 (ELECTRON_RUN_AS_NODE=1) 能正确加载 better-sqlite3 等模块。
 *
 * 对于跨平台构建（如 macOS → Windows），还会从 npm 下载目标平台的
 * 预编译二进制包：
 *   - @img/sharp-{platform}-{arch} — sharp 图像处理
 *   - @node-llama-cpp/{platform}-{arch} — 本地 LLM (llama.cpp)
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { platform, tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

/** Electron 41.5.0 内嵌的 Node.js 版本，用于下载匹配的独立 Node.js 二进制和 native 预编译包 */
const NODE_VERSION = '24.15.0';

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
    // linux
    resourcesDir = join(appOutDir, 'resources');
  }

  const distModules = join(resourcesDir, 'dist-electron', 'node_modules');
  if (!existsSync(distModules)) {
    console.log('[afterPack] dist-electron/node_modules not found at', distModules);
    return;
  }

  // ── 项目根 node_modules — electron-builder 已将其 native 模块编译为 Electron 版本
  // 注意：跨平台构建时（如 macOS→Windows），项目根编译的是 macOS arm64 的 native 模块，
  // 复制到 Windows 包中完全无效。跨平台构建完全依赖下方的 download* 函数从网络下载。
  const projectNodeModules = join(packager.projectDir, 'node_modules');
  const isCrossBuild = electronPlatformName !== platform();

  // 非跨平台构建（macOS→macOS 或 Windows→Windows）：从项目根复制 Electron 编译的 native 模块
  if (!isCrossBuild) {
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
  } else {
    console.log(`[afterPack] Cross-platform build (${platform()} → ${electronPlatformName}): skipping local native module copy`);
  }

  // ── 跨平台预编译包下载 ────────────────────────────────────────
  // 当构建平台 != 目标平台时（如 macOS → Windows），
  // npm 只会下载构建平台的 optionalDependencies。
  // 需要从 npm 额外下载目标平台的预编译二进制包。
  //
  // electron-builder 的 context.arch 是枚举值 (x64=1, arm64=2, ia32=0)
  const pkgArch = mapElectronBuilderArch(context.arch);

  if (isCrossBuild) {
    console.log(`[afterPack] Cross-platform detected: building for ${electronPlatformName} on ${platform()}`);

    // dist-electron/node_modules 中有 install-dist-deps 安装的完整依赖树,
    // 可作为读取 optionalDependencies 的备选路径。
    // 项目根 node_modules 可能不包含 node-llama-cpp 等间接依赖。

    // sharp: 使用 process.platform 原生值 (win32/darwin/linux)
    // 包名格式: @img/sharp-{platform}-{arch}, @img/sharp-libvips-{platform}-{arch}
    await downloadCrossPlatformNativePackages({
      parentModule: 'sharp',
      scope: '@img',
      pkgPrefix: 'sharp',
      pkgPlatform: electronPlatformName,
      arch: pkgArch,
      exactMatch: false,
      projectNodeModules,
      distModules,
      resourcesDir,
    });

    // node-llama-cpp: 平台名映射为 win/mac/linux
    // 包名格式: @node-llama-cpp/{platform}-{arch}
    await downloadCrossPlatformNativePackages({
      parentModule: 'node-llama-cpp',
      scope: '@node-llama-cpp',
      pkgPrefix: null,
      pkgPlatform: mapElectronPlatformToLlamaPlatform(electronPlatformName),
      arch: pkgArch,
      exactMatch: true, // 只匹配 CPU 包，排除 cuda/vulkan 等 GPU 变体
      projectNodeModules,
      distModules,
      resourcesDir,
    });

    // better-sqlite3: electron-builder 的 npmRebuild 编译的是 Electron NODE_MODULE_VERSION，
    // 独立 Node.js 子进程需要 NODE_MODULE_VERSION 145 (Node.js v24) 的二进制。
    // 直接从 GitHub Releases 下载目标平台的预编译包。
    await downloadBetterSqlite3ForNode({
      targetPlatform: electronPlatformName,
      arch: pkgArch,
      distModules,
    });

    // sqlite-vec: 通过 optionalDependencies 安装平台特定包
    // (sqlite-vec-windows-x64 等)，npm 只安装当前平台。
    // 需要额外下载目标平台的包。
    await downloadSqliteVecPackage({
      targetPlatform: electronPlatformName,
      arch: pkgArch,
      distModules,
    });
  }

  // ── 跨平台 Node.js 二进制下载 ─────────────────────────────────
  // 下载目标平台的独立 Node.js 二进制，避免 ELECTRON_RUN_AS_NODE=1
  // 在 Windows 上创建控制台窗口。
  if (isCrossBuild) {
    await downloadNodeBinary(electronPlatformName, pkgArch, resourcesDir);
  }

  console.log('[afterPack] Native module replacement done');
}

/**
 * 通用跨平台预编译包下载
 *
 * 从 npm 下载目标平台的 native 预编译包并复制到打包产物中。
 *
 * @param {string} opts.parentModule - 父模块名
 * @param {string} opts.scope - npm scope
 * @param {string|null} opts.pkgPrefix - 包名前缀
 * @param {string} opts.pkgPlatform - 目标平台的包名表示
 * @param {string} opts.arch - 目标架构
 * @param {boolean} opts.exactMatch - 精确匹配 platform-arch
 * @param {string} opts.projectNodeModules - 项目根 node_modules
 * @param {string} opts.distModules - dist-electron/node_modules
 * @param {string} opts.resourcesDir - Resources 路径
 */
async function downloadCrossPlatformNativePackages({
  parentModule,
  scope,
  pkgPrefix,
  pkgPlatform,
  arch,
  exactMatch,
  projectNodeModules,
  distModules,
  resourcesDir,
}) {
  // 1. 读取父模块的 optionalDependencies。
  // 尝试多个路径：项目 node_modules → dist-electron/node_modules
  let parentPkgJson;
  const searchPaths = [projectNodeModules, distModules];
  for (const basePath of searchPaths) {
    try {
      parentPkgJson = JSON.parse(readFileSync(join(basePath, parentModule, 'package.json'), 'utf-8'));
      if (parentPkgJson.optionalDependencies) break;
    } catch { /* 继续尝试下一个路径 */ }
  }

  if (!parentPkgJson?.optionalDependencies) {
    console.warn(`[afterPack] Cannot read ${parentModule}/package.json optionalDependencies, skipping cross-platform ${scope} download`);
    return;
  }

  const optionalDeps = parentPkgJson.optionalDependencies || {};

  // 2. 筛选目标平台的包
  const deps = {};
  for (const [pkgName, version] of Object.entries(optionalDeps)) {
    // 只匹配特定 scope 的包（如 @img/xxx, @node-llama-cpp/xxx）
    if (!pkgName.startsWith(scope + '/')) continue;

    // nameWithoutScope = 去掉 scope/ 前缀后的包名
    // 如 @img/sharp-win32-x64 → "sharp-win32-x64"
    // 如 @node-llama-cpp/win-x64 → "win-x64"
    const nameWithoutScope = pkgName.slice(scope.length + 1);

    // 检查是否匹配目标平台和架构
    if (!nameWithoutScope.includes(pkgPlatform) || !nameWithoutScope.includes(arch)) continue;

    if (exactMatch) {
      // 精确匹配：如 node-llama-cpp 只匹配 "win-x64"，排除 "win-x64-cuda" 等 GPU 变体
      if (nameWithoutScope !== `${pkgPlatform}-${arch}`) continue;
    } else if (pkgPrefix) {
      // 前缀匹配：如 sharp 的 "sharp-win32-x64" 和 "sharp-libvips-win32-x64"
      if (!nameWithoutScope.startsWith(pkgPrefix + '-')) continue;
    }

    deps[pkgName] = version;
  }

  if (Object.keys(deps).length === 0) {
    console.log(`[afterPack] No ${scope} packages for ${pkgPlatform}-${arch}, skipping`);
    return;
  }

  // 3. 创建临时目录并安装
  const tmpDir = join(tmpdir(), `${scope.slice(1)}-cross-${pkgPlatform}-${arch}-${Date.now()}`);
  console.log(`[afterPack] Downloading target platform ${scope} packages: ${Object.keys(deps).join(', ')}`);

  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ private: true, dependencies: deps }, null, 2));

    execSync('npm install --force --no-audit --no-fund --ignore-scripts --loglevel=warn', {
      cwd: tmpDir,
      stdio: 'inherit',
      timeout: 120000,
    });
  } catch (err) {
    console.warn(`[afterPack] Failed to download target platform ${scope} packages:`, err.message);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return;
  }

  // 4. 复制到目标位置
  const srcScopeDir = join(tmpDir, 'node_modules', scope);
  if (!existsSync(srcScopeDir)) {
    console.warn(`[afterPack] ${scope} packages not found after npm install`);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return;
  }

  // 复制到 dist-electron/node_modules/{scope}/
  const destScopeDir = join(distModules, scope);
  mkdirSync(destScopeDir, { recursive: true });
  copyScopePackages(srcScopeDir, destScopeDir, scope);

  // 也复制到 extraResources/node/node_modules/{scope}/（如果该路径存在）
  const extraNodeModules = join(resourcesDir, 'node', 'node_modules');
  if (existsSync(extraNodeModules)) {
    const extraScopeDir = join(extraNodeModules, scope);
    mkdirSync(extraScopeDir, { recursive: true });
    copyScopePackages(srcScopeDir, extraScopeDir, scope);
  }

  // 5. 清理临时目录
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

/**
 * electron-builder 的 Arch 枚举 → 字符串
 *   x64=1, arm64=2, ia32=0, armv7l=3
 */
function mapElectronBuilderArch(arch) {
  if (typeof arch === 'string') return arch;
  const map = { 0: 'ia32', 1: 'x64', 2: 'arm64', 3: 'armv7l' };
  return map[arch] || String(arch);
}

/**
 * node-llama-cpp 的 getPlatform() 映射：
 *   win32 → win, darwin → mac, linux → linux
 */
function mapElectronPlatformToLlamaPlatform(platformName) {
  const map = {
    darwin: 'mac',
    win32: 'win',
    linux: 'linux',
  };
  return map[platformName] || platformName;
}

/**
 * 复制 scoped 包目录到目标位置
 */
function copyScopePackages(srcDir, destDir, scope) {
  const packages = readdirSync(srcDir);
  for (const pkg of packages) {
    const srcPath = join(srcDir, pkg);
    const destPath = join(destDir, pkg);
    try {
      cpSync(srcPath, destPath, { recursive: true, force: true });
      console.log(`[afterPack] Installed cross-platform package: ${scope}/${pkg}`);
    } catch (err) {
      console.warn(`[afterPack] Failed to copy ${scope}/${pkg}:`, err.message);
    }
  }
}

/**
 * 下载 sqlite-vec 目标平台的 SQLite 可加载扩展
 *
 * sqlite-vec 通过 optionalDependencies 安装平台特定包
 * (sqlite-vec-windows-x64 等)，npm install 只安装当前平台的包。
 * 跨平台构建时需要手动下载目标平台的包。
 *
 * @param {string} opts.targetPlatform - 目标平台 (win32/darwin/linux)
 * @param {string} opts.arch - 目标架构 (x64/arm64)
 * @param {string} opts.distModules - dist-electron/node_modules 路径
 */
async function downloadSqliteVecPackage({ targetPlatform, arch, distModules }) {
  const modDir = join(distModules, 'sqlite-vec');
  if (!existsSync(modDir)) {
    console.log('[afterPack] sqlite-vec not found in distModules, skipping');
    return;
  }

  const osName = targetPlatform === 'win32' ? 'windows' : targetPlatform;
  const pkgName = `sqlite-vec-${osName}-${arch}`;

  // 检查是否已存在（同平台构建时已安装）
  const existingDir = join(distModules, pkgName);
  if (existsSync(existingDir)) {
    console.log(`[afterPack] ${pkgName} already exists, skipping`);
    return;
  }

  let version;
  try {
    version = JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf-8')).version;
  } catch {
    console.warn('[afterPack] Cannot read sqlite-vec version, skipping cross-platform download');
    return;
  }

  const tmpDir = join(tmpdir(), `sqlite-vec-cross-${targetPlatform}-${Date.now()}`);
  console.log(`[afterPack] Downloading ${pkgName}@${version} for cross-platform`);

  try {
    mkdirSync(tmpDir, { recursive: true });

    // npm install 会因平台不匹配拒绝安装（EBADPLATFORM），
    // 改用 npm pack 下载 tarball 后直接解压，绕过平台检查。
    execSync(`npm pack "${pkgName}@${version}" --pack-destination "${tmpDir}" --loglevel=warn`, {
      cwd: tmpDir,
      stdio: 'inherit',
      timeout: 120000,
    });

    // 找到下载的 tgz 文件并解压
    const tgzFiles = readdirSync(tmpDir).filter(f => f.endsWith('.tgz'));
    if (tgzFiles.length === 0) {
      console.warn(`[afterPack] ${pkgName} tgz not found after npm pack`);
      return;
    }

    // 解压到临时目录
    const extractDir = join(tmpDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${join(tmpDir, tgzFiles[0])}" -C "${extractDir}"`, {
      stdio: 'inherit',
      timeout: 30000,
    });

    // npm pack 产物中 package/ 目录包含包内容
    const srcDir = join(extractDir, 'package');
    if (!existsSync(srcDir)) {
      console.warn(`[afterPack] ${pkgName} package/ not found after extraction`);
      return;
    }

    // 复制到 dist-electron/node_modules/ 中
    const destDir = join(distModules, pkgName);
    cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log(`[afterPack] Installed ${pkgName} for cross-platform`);
  } catch (err) {
    console.warn(`[afterPack] Failed to download ${pkgName}: ${err.message}`);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * 下载 better-sqlite3 目标平台的预编译二进制（用于独立 Node.js 子进程）
 *
 * electron-builder 的 npmRebuild 编译的 .node 是 Electron 专用 NODE_MODULE_VERSION，
 * 独立 Node.js v24.15.0（NODE_MODULE_VERSION 145）无法加载。
 * 此函数从 GitHub Releases 下载匹配的预编译包。
 */
async function downloadBetterSqlite3ForNode({ targetPlatform, arch, distModules }) {
  const modDir = join(distModules, 'better-sqlite3');
  if (!existsSync(modDir)) {
    console.log('[afterPack] better-sqlite3 not found in distModules, skipping');
    return;
  }

  let version;
  try {
    version = JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf-8')).version;
  } catch {
    console.warn('[afterPack] Cannot read better-sqlite3 version, skipping');
    return;
  }

  // Node.js v24.15.0 NODE_MODULE_VERSION = 145
  const moduleVersion = '145';
  const fileName = `better-sqlite3-v${version}-node-v${moduleVersion}-${targetPlatform}-${arch}.tar.gz`;

  // GitHub Releases + 国内镜像（多个代理逐一尝试）
  const baseUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${fileName}`;
  const urls = [
    baseUrl,
    `https://ghproxy.com/${baseUrl}`,
    `https://ghproxy.net/${baseUrl}`,
    `https://mirror.ghproxy.com/${baseUrl}`,
    `https://gh.con.sh/${baseUrl}`,
    `https://gh.ddlc.top/${baseUrl}`,
    `https://hub.fgit.ml/${baseUrl}`,
    `https://gh.api.99988866.xyz/${baseUrl}`,
    `https://gh.llkk.cc/${baseUrl}`,
  ];

  console.log(`[afterPack] Downloading better-sqlite3 for ${targetPlatform}-${arch} (v${version}, node-v${moduleVersion})`);

  const tmpDir = join(tmpdir(), `bs3-${targetPlatform}-${Date.now()}`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    const archivePath = join(tmpDir, fileName);

    // 依次尝试各 URL
    let downloaded = false;
    for (const url of urls) {
      console.log(`[afterPack] Trying: ${url}`);
      try {
        execSync(`curl -fsSL -v --connect-timeout 15 --retry 2 -o "${archivePath}" "${url}"`, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120000,
        });
        if (existsSync(archivePath) && statSync(archivePath).size > 1024) {
          downloaded = true;
          console.log(`[afterPack] Downloaded ${(statSync(archivePath).size / 1024).toFixed(1)}KB`);
          break;
        }
        console.warn(`[afterPack] Downloaded file too small: ${statSync(archivePath).size} bytes`);
        try { rmSync(archivePath, { force: true }); } catch {}
      } catch (err) {
        const stderr = err.stderr?.toString() || '';
        const stdout = err.stdout?.toString() || '';
        const detail = stderr.trim() || stdout.trim() || err.message;
        console.warn(`[afterPack] URL failed: ${detail}`);
        try { rmSync(archivePath, { force: true }); } catch {}
      }
    }

    if (!downloaded) {
      console.warn('[afterPack] All better-sqlite3 download URLs failed');
      // 删除可能残留的无效 native 二进制（install-dist-deps 留下的错误平台的 .node 文件）
      const destBuild = join(modDir, 'build');
      if (existsSync(destBuild)) {
        rmSync(destBuild, { recursive: true, force: true });
        console.warn('[afterPack] Removed invalid better-sqlite3 build/ (wrong platform/arch)');
      }
      // 如果也没有 bundled Node.js，agent-bridge 回退到 ELECTRON_RUN_AS_NODE=1
      // 用 Electron 内置的预编译 native 模块（electron-builder install-app-deps 编译的）
      console.warn('[afterPack] better-sqlite3 native binary will be missing — agent-bridge will fall back to Electron-compiled version');
      return;
    }

    // 解压 tar.gz
    execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit', timeout: 30000 });

    // tar 包内结构: build/Release/better_sqlite3.node
    const srcBuild = join(tmpDir, 'build');
    if (!existsSync(srcBuild)) {
      console.warn('[afterPack] better-sqlite3 build/ not found in archive');
      return;
    }

    // 替换目标 build/ 目录
    const destBuild = join(modDir, 'build');
    if (existsSync(destBuild)) rmSync(destBuild, { recursive: true, force: true });
    cpSync(srcBuild, destBuild, { recursive: true, force: true });
    console.log(`[afterPack] Installed better-sqlite3 for Node.js v24 (NODE_MODULE_VERSION ${moduleVersion})`);
  } catch (err) {
    console.warn(`[afterPack] Failed to download better-sqlite3: ${err.message}`);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * 下载目标平台的独立 Node.js 二进制
 *
 * 避免使用 ELECTRON_RUN_AS_NODE=1（会在 Windows 上创建控制台窗口）。
 */
async function downloadNodeBinary(targetPlatform, arch, resourcesDir) {
  let nodeOs, nodeArch, ext;
  if (targetPlatform === 'win32') {
    nodeOs = 'win';
    ext = 'zip';
  } else if (targetPlatform === 'darwin') {
    nodeOs = 'darwin';
    ext = 'tar.gz';
  } else {
    nodeOs = 'linux';
    ext = 'tar.xz';
  }
  nodeArch = arch === 'x64' ? 'x64' : arch;

  const fileName = `node-v${NODE_VERSION}-${nodeOs}-${nodeArch}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${fileName}`;
  const binDir = join(resourcesDir, 'node', 'bin');
  const binName = targetPlatform === 'win32' ? 'node.exe' : 'node';

  // 如果已存在则跳过
  if (existsSync(join(binDir, binName))) {
    console.log(`[afterPack] Node.js binary already exists for ${targetPlatform}-${arch}, skipping`);
    return;
  }

  // 多个镜像源，优先国内镜像（解决 nodejs.org 超时问题）
  const mirrors = [
    `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${fileName}`,
    `https://mirrors.aliyun.com/nodejs-release/v${NODE_VERSION}/${fileName}`,
    `https://nodejs.org/dist/v${NODE_VERSION}/${fileName}`,
  ];

  console.log(`[afterPack] Downloading Node.js binary for ${targetPlatform}-${arch}`);

  const tmpDir = join(tmpdir(), `node-download-${targetPlatform}-${Date.now()}`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    const archivePath = join(tmpDir, fileName);

    // 依次尝试各个镜像源
    let lastError;
    for (const mirrorUrl of mirrors) {
      console.log(`[afterPack] Trying: ${mirrorUrl}`);
      try {
        execSync(`curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 -o "${archivePath}" "${mirrorUrl}"`, {
          stdio: 'inherit',
          timeout: 180000,
        });
        // 验证下载的文件大小 > 1MB
        const stat = statSync(archivePath);
        if (stat.size > 1024 * 1024) {
          lastError = null;
          console.log(`[afterPack] Downloaded ${(stat.size / 1024 / 1024).toFixed(1)}MB from mirror`);
          break;
        }
        console.warn(`[afterPack] Downloaded file too small (${stat.size} bytes), trying next mirror...`);
        try { rmSync(archivePath, { force: true }); } catch {}
      } catch (err) {
        lastError = err;
        console.warn(`[afterPack] Mirror failed: ${err.message}`);
        try { rmSync(archivePath, { force: true }); } catch {}
      }
    }
    if (lastError) throw lastError;

    // 解压
    if (ext === 'zip') {
      execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, { stdio: 'inherit', timeout: 30000 });
    } else if (ext === 'tar.gz') {
      execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit', timeout: 30000 });
    } else {
      execSync(`tar -xJf "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit', timeout: 30000 });
    }

    // 复制 node 二进制到 Resources/node/bin/
    const extractedDir = join(tmpDir, `node-v${NODE_VERSION}-${nodeOs}-${nodeArch}`);
    // Windows Node.js 分发包中 node.exe 在根目录；Unix 在 bin/ 子目录
    const srcBin = targetPlatform === 'win32'
      ? join(extractedDir, binName)
      : join(extractedDir, 'bin', binName);
    if (!existsSync(srcBin)) {
      console.warn(`[afterPack] Node.js binary not found at ${srcBin}`);
      return;
    }
    mkdirSync(binDir, { recursive: true });
    cpSync(srcBin, join(binDir, binName), { force: true });
    // 确保可执行
    try { execSync(`chmod +x "${join(binDir, binName)}"`, { stdio: 'ignore' }); } catch {}

    console.log(`[afterPack] Installed Node.js ${NODE_VERSION} for ${targetPlatform}-${arch}`);
  } catch (err) {
    console.warn(`[afterPack] Failed to download Node.js binary: ${err.message}`);
    // 写入标志文件，告诉 agent-bridge 不要尝试使用 bundled Node.js
    const nodeDir = join(resourcesDir, 'node');
    mkdirSync(join(nodeDir, 'bin'), { recursive: true });
    writeFileSync(join(resourcesDir, 'dist-electron', '.no-bundled-node'), '', 'utf-8');
    console.warn('[afterPack] Wrote .no-bundled-node flag — agent-bridge will use ELECTRON_RUN_AS_NODE=1 fallback');
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
