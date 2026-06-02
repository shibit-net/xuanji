/**
 * ============================================================
 * MCPInstaller — MCP 包安装器
 * ============================================================
 * 从 Tiangong 市场下载并安装 MCP 服务器。
 *
 * 安装流程:
 *   1. 获取安装配置 (getInstallConfig)
 *   2. 下载 tar.gz 到临时目录 (download)
 *   3. 解压到 ~/.xuanji/mcp/{packageId}/
 *   4. 执行 npm install
 *   5. 解析 configTemplate → MCPServerConfig
 *   6. 调用 MCPManager.addServer() 注册
 *
 * 零外部依赖 — 使用 Node.js 内置模块。
 */

import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec as execCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '@/core/logger';
import { findNpmCliPath } from '@/shared/utils/crossPlatform';
import type { MCPServerConfig } from '../types';
import type { TiangongMarket, InstallConfig, MarketPackage } from './TiangongMarket';
import { MCPManager } from '../MCPManager';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

const exec = promisify(execCb);
const log = logger.child({ module: 'MCPInstaller' });

// ============================================================
// Types
// ============================================================

export interface InstallOptions {
  /** 指定版本（不传则安装最新） */
  version?: string;
  /** 是否在安装后自动启动（默认 true） */
  autoStart?: boolean;
  /** 超时时间 ms（默认 120000） */
  timeout?: number;
}

export interface InstallResult {
  /** 是否成功 */
  success: boolean;
  /** 包 ID */
  packageId: string;
  /** 安装版本 */
  version: string;
  /** 安装路径 (绝对路径) */
  installPath: string;
  /** MCP 配置（已注册的完整配置） */
  config: MCPServerConfig;
  /** 错误信息 */
  error?: string;
}

export interface InstallerSearchOptions {
  query?: string;
  categoryId?: number;
  tags?: string;
  sort?: 'downloads' | 'rating' | 'updated_at' | 'created_at';
  page?: number;
  pageSize?: number;
}

export interface InstallerSearchResult {
  items: MarketPackage[];
  total: number;
}

// ============================================================
// MCPInstaller
// ============================================================

export class MCPInstaller {
  private readonly installBase: string;

  constructor(
    private readonly market: TiangongMarket,
    private readonly mcpManager: MCPManager,
    installBase?: string,
  ) {
    this.installBase = installBase ?? path.join(os.homedir(), '.xuanji', 'mcp');
  }

  /**
   * 将 packageId 转为安全的文件系统路径
   * @scope/name → @scope-name（避免 npm 将目录名误解析为 scoped package 路径）
   */
  private getInstallPath(packageId: string): string {
    return path.join(this.installBase, packageId.replace(/\//g, '-'));
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * 搜索 MCP 包
   */
  async search(options: InstallerSearchOptions = {}): Promise<InstallerSearchResult> {
    const result = await this.market.search({ ...options, type: 'mcp' });
    return { items: result.mcp?.items ?? [], total: result.mcp?.total ?? 0 };
  }

  /**
   * 搜索并安装第一个匹配的 MCP 包
   *
   * 便捷方法：search → pick best → install
   */
  async installFromSearch(goal: string, options: InstallOptions = {}): Promise<InstallResult> {
    const { items } = await this.search({ query: goal, pageSize: 5 });

    if (items.length === 0) {
      return {
        success: false,
        packageId: '',
        version: '',
        installPath: '',
        config: {} as MCPServerConfig,
        error: `未找到与 "${goal}" 匹配的 MCP 包`,
      };
    }

    const best = items[0];
    return this.install(best.packageId, options);
  }

  /**
   * 直接从 npm registry 安装 MCP 包（绕过 marketplace API）
   *
   * 流程:
   *   1. npm install {packageName}
   *   2. 检测 package.json 中的 bin / mcp 字段确定入口命令
   *   3. 构建 MCPServerConfig (source=npm)
   *   4. mcpManager.addServer() 注册
   */
  async installFromNpm(packageName: string, options: InstallOptions = {}): Promise<InstallResult> {
    const timeout = options.timeout ?? 120000;
    const installPath = this.getInstallPath(packageName);

    try {
      log.info(`Installing MCP from npm: ${packageName}`);
      await fs.mkdir(installPath, { recursive: true });

      // npm install
      const appDir = path.join(installPath, 'app');
      await this.npmInitAndInstall(installPath, packageName, timeout);

      // 在 node_modules 中找到已安装的包目录
      const pkgDir = path.join(appDir, 'node_modules', ...packageName.split('/'));
      let pkgJson: any = {};
      try {
        pkgJson = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf-8'));
      } catch {
        log.warn(`Cannot read package.json for ${packageName}, using defaults`);
      }

      // 检测入口命令
      let command = 'npx';
      let args: string[] = [packageName];
      let cwd = appDir;
      let detectedEntry: string | undefined;

      // 1. 检查 package.json 的 bin 字段
      if (pkgJson.bin) {
        if (typeof pkgJson.bin === 'string') {
          detectedEntry = pkgJson.bin;
        } else if (typeof pkgJson.bin === 'object') {
          const firstBin = Object.values(pkgJson.bin)[0] as string;
          if (firstBin) detectedEntry = firstBin;
        }
      }

      // 2. 检查 mcp 相关字段 (自定义约定)
      if (!detectedEntry) {
        const mcpEntry = pkgJson.mcp || pkgJson['mcp-server'] || pkgJson.main;
        if (typeof mcpEntry === 'string' && mcpEntry) {
          detectedEntry = mcpEntry;
        }
      }

      if (detectedEntry) {
        // 检测入口文件类型
        const entryPath = path.resolve(pkgDir, detectedEntry);
        if (detectedEntry.endsWith('.js') || detectedEntry.endsWith('.mjs')) {
          command = 'node';
          args = [entryPath];
          cwd = pkgDir;
        } else if (detectedEntry.endsWith('.py')) {
          command = process.platform === 'win32' ? 'python' : 'python3';
          args = [entryPath];
          cwd = pkgDir;
        } else {
          // bin 指向的可能是命令行工具，用 node 执行
          command = 'node';
          args = [entryPath];
          cwd = pkgDir;
        }
      }

      const now = new Date().toISOString();
      const config: MCPServerConfig = {
        name: packageName,
        transport: 'stdio',
        command,
        args,
        env: {},
        cwd,
        disabled: false,
        source: 'npm' as const,
        packageId: packageName,
        installedVersion: pkgJson.version || 'unknown',
        installPath,
        installedAt: now,
      };

      await this.mcpManager.addServer(config);
      eventBus.emit(XuanjiEvent.MCP_INSTALLED, { serverName: config.name, packageId: packageName });

      log.info(`MCP from npm installed: ${packageName} v${config.installedVersion}`);
      return {
        success: true,
        packageId: packageName,
        version: config.installedVersion || 'unknown',
        installPath,
        config,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`MCP npm install failed for ${packageName}: ${msg}`);
      return {
        success: false,
        packageId: packageName,
        version: 'unknown',
        installPath: '',
        config: {} as MCPServerConfig,
        error: `npm 安装失败: ${msg}`,
      };
    }
  }

  /**
   * 安装指定 packageId 的 MCP 包
   *
   * 完整安装流程:
   *   1. 获取安装配置
   *   2. 下载 → 解压 → npm install
   *   3. 构建配置并注册
   */
  async install(packageId: string, options: InstallOptions = {}): Promise<InstallResult> {
    const timeout = options.timeout ?? 120000;
    const version: string = options.version || '';

    try {
      // ── Step 1: 获取安装配置 ────────────────────────────
      log.info(`Getting install config for ${packageId}${version ? `@${version}` : ''}`);
      const installConfig = await this.market.getInstallConfig(packageId, options.version);
      const effectiveVersion = installConfig.version || 'unknown';

      // ── Step 2: 解析 configTemplate 判断 transport ──────
      let parsedTemplate: Partial<MCPServerConfig> = {};
      if (installConfig.configTemplate) {
        try {
          parsedTemplate = JSON.parse(installConfig.configTemplate);
        } catch { /* ignore parse errors */ }
      }
      const transport = parsedTemplate.transport as MCPServerConfig['transport'] | 'bundle' | undefined;

      const installPath = this.getInstallPath(packageId);
      await fs.mkdir(installPath, { recursive: true });

      // ── Step 3: 根据 transport 类型分流安装 ──────────────
      if (installConfig.configTemplate && (transport === 'stdio' || transport === 'sse' || transport === 'http')) {
        // 基于 configTemplate 直接注册（stdio/sse/http 不需要下载文件）
        log.info(`Registering ${transport} MCP ${packageId}@${effectiveVersion} from configTemplate`);
        await fs.writeFile(
          path.join(installPath, '.xuanji-mcp.json'),
          JSON.stringify({
            packageId, version: effectiveVersion,
            type: transport, installedAt: new Date().toISOString(),
          }, null, 2),
          'utf-8',
        );
      } else if (transport === 'bundle') {
        // bundle transport: 下载 ZIP → 解压 → npm install
        log.info(`Installing bundle MCP ${packageId}@${effectiveVersion} from ZIP`);
        const downloadInfo = await this.market.getDownloadInfo(packageId, options.version);
        if (!downloadInfo.downloadUrl) {
          return {
            success: false, packageId, version: effectiveVersion,
            installPath: '', config: {} as MCPServerConfig,
            error: `包 "${packageId}" (bundle) 缺少文件下载地址`,
          };
        }
        const { tempPath } = await this.market.download(packageId, options.version, '.zip');
        await this.extractZipAndInstall(tempPath, installPath, timeout);
        await fs.writeFile(
          path.join(installPath, '.xuanji-mcp.json'),
          JSON.stringify({
            packageId, version: effectiveVersion,
            type: 'bundle', installedAt: new Date().toISOString(),
          }, null, 2),
          'utf-8',
        );
      } else {
        // 非标准 transport 或旧格式 → 尝试下载安装
        log.info(`Attempting download-based install for ${packageId}@${effectiveVersion}`);
        try {
          const downloadInfo = await this.market.getDownloadInfo(packageId, options.version);
          if (downloadInfo.downloadUrl) {
            const { tempPath } = await this.market.download(packageId, options.version);
            await this.extractAndInstall(tempPath, installPath, installConfig, timeout);
          } else if (installConfig.configTemplate) {
            await this.npmInitAndInstall(installPath, packageId, timeout);
          } else {
            return {
              success: false, packageId, version: effectiveVersion,
              installPath: '', config: {} as MCPServerConfig,
              error: `包 "${packageId}" 不可安装：缺少文件下载地址和配置模板`,
            };
          }
          await fs.writeFile(
            path.join(installPath, '.xuanji-mcp.json'),
            JSON.stringify({
              packageId, version: effectiveVersion,
              type: transport || 'legacy', installedAt: new Date().toISOString(),
            }, null, 2),
            'utf-8',
          );
        } catch (downloadErr) {
          // 下载失败时，如果 configTemplate 存在则回退到直接注册
          if (installConfig.configTemplate) {
            log.warn(`Download failed for ${packageId}, falling back to configTemplate direct registration`);
          } else {
            throw downloadErr;
          }
        }
      }

      // ── Step 4: 构建配置并注册 ──────────────────────────
      const config = this.buildServerConfig(packageId, effectiveVersion, installPath, installConfig);
      await this.mcpManager.addServer(config);
      log.info(`Installed MCP server: ${config.name} (${packageId}@${effectiveVersion})`);

      eventBus.emit(XuanjiEvent.MCP_INSTALLED, { packageId, version: effectiveVersion, serverName: config.name });
      return { success: true, packageId, version: effectiveVersion, installPath, config };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to install ${packageId}:`, err);

      const targetPath = this.getInstallPath(packageId);
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
        log.debug(`Cleaned up failed install directory: ${targetPath}`);
      } catch {
        // 清理失败不阻塞错误返回
      }

      return { success: false, packageId, version: '', installPath: '',
               config: {} as MCPServerConfig, error: message };
    }
  }

  /**
   * 卸载指定 packageId 的 MCP 包
   *
   * 从 MCPManager 移除并删除安装目录。
   */
  async uninstall(packageId: string, serverName?: string): Promise<boolean> {
    // 查找对应的 serverName
    let targetName = serverName;
    if (!targetName) {
      // 遍历运行时查找匹配 packageId 的 server
      for (const runtime of this.mcpManager.getServerRuntimes()) {
        if (runtime.config.packageId === packageId) {
          targetName = runtime.config.name;
          break;
        }
      }
    }

    if (!targetName) {
      log.warn(`No running server found for packageId=${packageId}`);
      // 仍然尝试清理文件
      await this.cleanupInstall(packageId);
      return false;
    }

    // 移除 server
    const removed = await this.mcpManager.removeServer(targetName);
    if (removed) {
      await this.cleanupInstall(packageId);
      eventBus.emit(XuanjiEvent.MCP_UNINSTALLED, { packageId, serverName: targetName });
    }
    return removed;
  }

  // ============================================================
  // Private: Install Pipeline
  // ============================================================

  /**
   * 解压 ZIP 并执行 npm install（bundle transport）
   */
  private async extractZipAndInstall(
    tempPath: string,
    installPath: string,
    timeout: number,
  ): Promise<void> {
    await fs.mkdir(installPath, { recursive: true });

    log.debug(`Extracting ZIP ${tempPath} → ${installPath}`);
    if (process.platform === 'win32') {
      await exec(
        `powershell -Command "Expand-Archive -Path '${tempPath}' -DestinationPath '${installPath}' -Force"`,
        { timeout },
      );
    } else {
      await exec(`unzip -o "${tempPath}" -d "${installPath}"`, { timeout });
    }

    // 检查是否有 package.json，有则执行 npm install
    const hasPackageJson = await fs.access(path.join(installPath, 'package.json'))
      .then(() => true).catch(() => false);
    if (hasPackageJson) {
      log.debug(`Running npm install --production in ${installPath}`);
      await this.npmInstall(installPath, timeout);
    }
  }

  /**
   * 解压 tar.gz 并执行 npm install
   */
  private async extractAndInstall(
    tempPath: string,
    installPath: string,
    installConfig: InstallConfig,
    timeout: number,
  ): Promise<void> {
    // 确保安装目录存在
    await fs.mkdir(installPath, { recursive: true });

    // 解压 tar.gz
    log.debug(`Extracting ${tempPath} → ${installPath}`);
    await exec(`tar -xzf "${tempPath}" -C "${installPath}" --strip-components=1`, {
      timeout,
    });

    // 如果有 installScript，执行它
    if (installConfig.installScript && installConfig.installScript.trim()) {
      log.debug(`Running install script: ${installConfig.installScript}`);
      await exec(installConfig.installScript, {
        cwd: installPath,
        timeout: timeout * 2, // install script 可能更慢
        env: { ...process.env },
      });
    } else {
      // 默认: 执行 npm install --production
      log.debug(`Running npm install --production in ${installPath}`);
      await this.npmInstall(installPath, timeout);
    }
  }

  /**
   * 将 npm stderr 输出转为可读的错误信息
   */
  private formatNpmError(stderr: string, code: number, packageId?: string): string {
    const output = stderr.trim();

    // 404: 包不存在
    if (/E404|404 Not Found/i.test(output)) {
      const pkg = packageId || '该包';
      return `npm 包 "${pkg}" 在 registry 中不存在 (404)`;
    }

    // EACCES / permission
    if (/EACCES|permission denied/i.test(output)) {
      return 'npm install 权限不足，请检查文件目录权限';
    }

    // ENOTFOUND / network
    if (/ENOTFOUND|getaddrinfo/i.test(output)) {
      return '无法连接 npm registry，请检查网络连接';
    }

    // ETIMEDOUT
    if (/ETIMEDOUT|timed out/i.test(output)) {
      return `npm install 超时 (${code})，请检查网络或重试`;
    }

    // 提取最后一行有效错误
    const lines = output.split('\n').filter(l => l.trim());
    const lastLine = lines.pop() || '';
    // 过滤掉 npm 的 verbose 前缀（如 "npm error"）
    const cleanLast = lastLine.replace(/^npm\s+(error|ERR!)\s*/i, '').trim();
    return `npm install 失败 (exit code ${code})${cleanLast ? ': ' + cleanLast : ''}`;
  }

  /**
   * 查找 npm 可执行文件路径
   *
   * 优先使用 Electron 内置 Node 运行打包的 npm-cli.js，
   * 避免依赖系统安装的 Node.js 或平台特定的 npm 脚本。
   */
  private findNpmCommand(): { command: string; args: string[] } {
    const { nodePath, npmCliPath } = findNpmCliPath();
    if (npmCliPath) {
      log.debug(`npm using ${nodePath} + ${npmCliPath}`);
      return { command: nodePath, args: [npmCliPath] };
    }
    // 终极回退
    const npmName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return { command: npmName, args: [] };
  }

  /**
   * 执行 npm install
   */
  private npmInstall(cwd: string, timeout: number): Promise<void> {
    const { command, args: npmArgs } = this.findNpmCommand();
    return new Promise((resolve, reject) => {
      const spawnEnv = {
        ...process.env,
        ...((process as any).resourcesPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        PATH: [
          process.env.PATH,
          '/usr/local/bin',
          '/opt/homebrew/bin',
          '/usr/bin',
          '/bin',
        ].filter(Boolean).join(path.delimiter),
      };
      const child = spawn(command, [...npmArgs, 'install', '--production', '--no-audit', '--no-fund'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env: spawnEnv,
        windowsHide: true,
      });

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`npm install failed to start: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(this.formatNpmError(stderr, code ?? 1)));
        }
      });

      child.on('timeout', () => {
        child.kill('SIGTERM');
        reject(new Error(`npm install timed out after ${timeout}ms`));
      });
    });
  }

  /**
   * 初始化 package.json 并安装 npm 包
   *
   * 用于 Type B（外部包）：在 installPath/app 子目录下创建 package.json
   * 并执行 npm install {packageId}。使用 app 子目录避免 cwd 路径中的
   * scoped package 名（如 @playwright/mcp）被 npm 误解析为本地路径。
   */
  private async npmInitAndInstall(
    installPath: string,
    packageId: string,
    timeout: number,
  ): Promise<void> {
    // 使用 app 子目录避免 npm 路径歧义
    const appDir = path.join(installPath, 'app');
    await fs.mkdir(appDir, { recursive: true });

    const pkgJsonPath = path.join(appDir, 'package.json');
    try {
      await fs.access(pkgJsonPath);
    } catch {
      await fs.writeFile(
        pkgJsonPath,
        JSON.stringify({ private: true, name: packageId.replace('/', '-') }, null, 2),
        'utf-8',
      );
    }

    return new Promise((resolve, reject) => {
      log.debug(`npm install ${packageId} in ${appDir}`);
      const { command: npmCommand, args: npmArgs } = this.findNpmCommand();
      log.debug(`npm install using: ${npmCommand}${npmArgs.length ? ' ' + npmArgs.join(' ') : ''}`);
      // 确保 PATH 包含常见的 npm 安装路径（打包后 Electron 的 PATH 可能不完整）
      const spawnEnv = {
        ...process.env,
        ...((process as any).resourcesPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        PATH: [
          process.env.PATH,
          '/usr/local/bin',
          '/opt/homebrew/bin',
          '/usr/bin',
          '/bin',
        ].filter(Boolean).join(path.delimiter),
      };
      const child = spawn(npmCommand, [...npmArgs, 'install', packageId, '--no-audit', '--no-fund'], {
        cwd: appDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env: spawnEnv,
        windowsHide: true,
      });

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`npm install ${packageId} failed to start: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(this.formatNpmError(stderr, code ?? 1, packageId)));
        }
      });

      child.on('timeout', () => {
        child.kill('SIGTERM');
        reject(new Error(`npm install ${packageId} timed out after ${timeout}ms`));
      });
    });
  }

  /**
   * 清理安装目录
   */
  private async cleanupInstall(packageId: string): Promise<void> {
    // 兼容新旧两种路径格式（/ → - 迁移）
    const oldPath = path.join(this.installBase, packageId);
    const newPath = this.getInstallPath(packageId);
    for (const installPath of [oldPath, newPath]) {
      try {
        await fs.rm(installPath, { recursive: true, force: true });
        log.info(`Removed install directory: ${installPath}`);
      } catch { /* 目录不存在则跳过 */ }
    }
  }

  // ============================================================
  // Private: Config Building
  // ============================================================

  /**
   * 从 InstallConfig 构建 MCPServerConfig
   *
   * configTemplate 预期格式:
   * {
   *   "name": "server-name",
   *   "transport": "stdio",
   *   "command": "node",
   *   "args": ["build/index.js"],
   *   "env": { "KEY": "VALUE" },
   *   "cwd": "./subdir"
   * }
   *
   * 所有相对路径会被解析为相对于 installPath 的绝对路径。
   */
  private buildServerConfig(
    packageId: string,
    version: string,
    installPath: string,
    installConfig: InstallConfig,
  ): MCPServerConfig {
    let template: Partial<MCPServerConfig> = {};

    // 尝试解析 configTemplate
    if (installConfig.configTemplate) {
      try {
        template = JSON.parse(installConfig.configTemplate) as Partial<MCPServerConfig>;
      } catch (err) {
        log.warn(`Failed to parse configTemplate for ${packageId}, using defaults:`, err);
      }
    }

    // 解析相对路径
    const resolvePath = (p?: string): string => {
      if (!p) return '';
      if (path.isAbsolute(p)) return p;
      return path.resolve(installPath, p);
    };

    const now = new Date().toISOString();

    return {
      name: template.name ?? packageId,
      transport: template.transport ?? 'stdio',
      command: template.command ?? 'node',
      args: (template.args ?? []).filter(arg => arg != null).map(arg => {
        if (arg === '{{installPath}}') return installPath;
        // 只解析明确是文件路径的 arg：
        //   - 以 / ~ ./ ../ 开头 → 绝对/显式相对路径
        //   - 以 .js/.mjs/.py 结尾 → 脚本文件
        // 注意：scoped npm 包名（如 @playwright/mcp）含 / 但不是文件路径，不应解析
        if (arg.startsWith('/') || arg.startsWith('~') || arg.startsWith('./') || arg.startsWith('../')) return resolvePath(arg);
        if (arg.endsWith('.js') || arg.endsWith('.mjs') || arg.endsWith('.py')) return resolvePath(arg);
        return arg;
      }),
      env: template.env ?? {},
      cwd: template.cwd ? resolvePath(template.cwd)
          : (() => {
              // Type B 包使用 app/ 子目录避免 scoped package 路径冲突
              try { const appDir = path.join(installPath, 'app'); if (existsSync(appDir)) return appDir; } catch {}
              return installPath;
            })(),
      sseUrl: template.sseUrl,
      httpUrl: template.httpUrl,
      url: template.url,
      headers: template.headers,
      timeout: template.timeout,
      disabled: false,

      // Marketplace metadata
      source: 'marketplace',
      packageId,
      installedVersion: version,
      installPath,
      installedAt: now,
    };
  }
}
