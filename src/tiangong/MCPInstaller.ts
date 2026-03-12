// ============================================================
// MCP Server 安装器
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { logger } from '@/core/logger';
import type { MCPServerConfig, InstalledPackage } from './types';
import { RegistryClient } from './RegistryClient';
import { ConfigLoader } from '@/core/config/ConfigLoader';

const log = logger.child({ module: 'MCPInstaller' });

export class MCPInstaller {
  private registryClient: RegistryClient;
  private mcpConfigPath: string;
  private installedPath: string;

  constructor(registryClient: RegistryClient) {
    this.registryClient = registryClient;
    this.mcpConfigPath = path.join(os.homedir(), '.xuanji', 'mcp.json');
    this.installedPath = path.join(os.homedir(), '.xuanji', 'tiangong-installed.json');
  }

  /** 安装 MCP Server */
  async install(packageId: string, version?: string): Promise<string> {
    const config = await this.registryClient.getInstallConfig(packageId, version);

    if (config.type !== 'mcp') {
      throw new Error(`"${packageId}" 不是 MCP Server 类型`);
    }

    // 执行安装脚本
    if (config.installScript) {
      log.info(`执行安装脚本: ${config.installScript}`);
      execSync(config.installScript, { stdio: 'inherit' });
    }

    // 写入 mcp.json
    const serverConfig: MCPServerConfig = JSON.parse(config.configTemplate);
    const mcpConfig = this.loadMCPConfig();

    // 检查是否是平台代理端点（付费 MCP），自动注入平台 API Key
    if (this.isPlatformProxyEndpoint(serverConfig)) {
      const tiangongApiKey = this.getTiangongApiKey();
      if (!tiangongApiKey) {
        log.warn('平台代理 MCP 需要设置 tiangong.apiKey，请在 ~/.xuanji/config.json 中配置');
      } else {
        serverConfig.env = serverConfig.env || {};
        serverConfig.env.SHIBIT_API_KEY = tiangongApiKey;
        log.info(`已注入平台 API Key 到 MCP Server "${serverConfig.name}"`);
      }
    }

    if (!mcpConfig.servers) {
      mcpConfig.servers = [];
    }

    const existingIndex = mcpConfig.servers.findIndex(
      (s: MCPServerConfig) => s.name === serverConfig.name
    );
    if (existingIndex !== -1) {
      log.warn(`MCP Server "${serverConfig.name}" 已存在，将覆盖`);
      mcpConfig.servers[existingIndex] = serverConfig;
    } else {
      mcpConfig.servers.push(serverConfig);
    }

    this.saveMCPConfig(mcpConfig);

    // 记录安装信息
    this.recordInstalled({
      packageId,
      name: serverConfig.name,
      type: 'mcp',
      version: config.version,
      installedAt: new Date().toISOString(),
      installPath: this.mcpConfigPath,
    });

    // 记录下载统计
    await this.registryClient.recordDownload(0, config.versionId);

    const msg = `MCP Server "${packageId}" 安装成功\n  配置: ${this.mcpConfigPath} (server: ${serverConfig.name})\n  重启 xuanji 以加载新服务`;
    log.info(msg);
    return msg;
  }

  /** 卸载 MCP Server */
  uninstall(packageId: string): string {
    const mcpConfig = this.loadMCPConfig();
    if (!mcpConfig.servers) {
      throw new Error(`未找到已安装的 MCP Server`);
    }

    const installed = this.getInstalledList();
    const record = installed.find(p => p.packageId === packageId && p.type === 'mcp');
    if (!record) {
      throw new Error(`"${packageId}" 未通过天工坊安装`);
    }

    mcpConfig.servers = mcpConfig.servers.filter(
      (s: MCPServerConfig) => s.name !== record.name
    );
    this.saveMCPConfig(mcpConfig);
    this.removeInstalled(packageId);

    return `MCP Server "${packageId}" 已卸载`;
  }

  private loadMCPConfig(): any {
    if (!fs.existsSync(this.mcpConfigPath)) {
      return { servers: [] };
    }
    return JSON.parse(fs.readFileSync(this.mcpConfigPath, 'utf-8'));
  }

  private saveMCPConfig(config: any): void {
    fs.mkdirSync(path.dirname(this.mcpConfigPath), { recursive: true });
    fs.writeFileSync(this.mcpConfigPath, JSON.stringify(config, null, 2));
  }

  private recordInstalled(record: InstalledPackage): void {
    const list = this.getInstalledList();
    const idx = list.findIndex(p => p.packageId === record.packageId);
    if (idx !== -1) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    fs.mkdirSync(path.dirname(this.installedPath), { recursive: true });
    fs.writeFileSync(this.installedPath, JSON.stringify(list, null, 2));
  }

  private removeInstalled(packageId: string): void {
    const list = this.getInstalledList().filter(p => p.packageId !== packageId);
    fs.writeFileSync(this.installedPath, JSON.stringify(list, null, 2));
  }

  getInstalledList(): InstalledPackage[] {
    if (!fs.existsSync(this.installedPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(this.installedPath, 'utf-8'));
  }

  /**
   * 检查 MCP 配置是否指向平台代理端点
   */
  private isPlatformProxyEndpoint(config: Record<string, any>): boolean {
    const proxyPattern = '/api/tiangong/proxy/mcp/';
    if (typeof config.sseUrl === 'string' && config.sseUrl.includes(proxyPattern)) return true;
    if (typeof config.httpUrl === 'string' && config.httpUrl.includes(proxyPattern)) return true;
    return false;
  }

  /**
   * 获取天工坊平台 API Key
   */
  private getTiangongApiKey(): string | undefined {
    try {
      const configPath = path.join(os.homedir(), '.xuanji', 'config.json');
      if (fs.existsSync(configPath)) {
        const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return appConfig?.tiangong?.apiKey;
      }
    } catch (e) {
      // ignore
    }
    return undefined;
  }
}
