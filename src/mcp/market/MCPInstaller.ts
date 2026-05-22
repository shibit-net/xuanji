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
import type { MCPServerConfig } from '../types';
import type { TiangongMarket, InstallConfig, MarketPackage } from './TiangongMarket';
import { MCPManager } from '../MCPManager';

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
    return { items: result.items, total: result.total };
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

      // ── Step 2: 判断安装类型 ────────────────────────────
      const downloadInfo = await this.market.getDownloadInfo(packageId, options.version);
      let installPath: string;

      if (downloadInfo.downloadUrl) {
        // Type A: 自托管 — 下载 tar.gz → 解压 → npm install
        log.info(`Downloading ${packageId}@${effectiveVersion}`);
        const { tempPath } = await this.market.download(packageId, options.version);
        installPath = this.getInstallPath(packageId);
        await this.extractAndInstall(tempPath, installPath, installConfig, timeout);
      } else if (installConfig.configTemplate) {
        // Type B: 外部引用（npm/pip/等）— npm install + 注册
        log.info(`Installing external MCP ${packageId}@${effectiveVersion}`);
        installPath = this.getInstallPath(packageId);
        await fs.mkdir(installPath, { recursive: true });

        // 初始化 package.json 并安装 npm 包
        await this.npmInitAndInstall(installPath, packageId, timeout);

        await fs.writeFile(
          path.join(installPath, '.xuanji-mcp.json'),
          JSON.stringify({
            packageId, version: effectiveVersion,
            type: 'external', installedAt: new Date().toISOString(),
          }, null, 2),
          'utf-8',
        );
      } else {
        return {
          success: false, packageId, version: effectiveVersion,
          installPath: '', config: {} as MCPServerConfig,
          error: `包 "${packageId}" 不可安装：缺少文件下载地址和配置模板`,
        };
      }

      // ── Step 3: 构建配置并注册 ──────────────────────────
      const config = this.buildServerConfig(packageId, effectiveVersion, installPath, installConfig);
      await this.mcpManager.addServer(config);
      log.info(`Installed MCP server: ${config.name} (${packageId}@${effectiveVersion})`);

      return { success: true, packageId, version: effectiveVersion, installPath, config };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to install ${packageId}:`, err);

      // 清理残留的安装目录
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
    }
    return removed;
  }

  // ============================================================
  // Private: Install Pipeline
  // ============================================================

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
   * 执行 npm install
   */
  private npmInstall(cwd: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['install', '--production', '--no-audit', '--no-fund'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env: { ...process.env },
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
      const child = spawn('npm', ['install', packageId, '--no-audit', '--no-fund'], {
        cwd: appDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env: { ...process.env },
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
      args: (template.args ?? []).map(arg => {
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
