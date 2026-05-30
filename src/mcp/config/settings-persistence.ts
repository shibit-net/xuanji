import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MCPServerConfig } from '../types';

/**
 * ~/.xuanji/mcp.json  格式:
 * {
 *   "servers": [ MCPServerConfig, ... ],
 *   "marketplace": { "baseUrl": "...", "apiKey": "...", "enabled": true }
 * }
 */
interface MCPSettingsFile {
  servers: MCPServerConfig[];
  marketplace?: {
    baseUrl: string;
    apiKey?: string;
    enabled?: boolean;
  };
}

const CONFIG_DIR = path.join(os.homedir(), '.xuanji');
const CONFIG_FILE = path.join(CONFIG_DIR, 'mcp.json');

export class MCPSettingsPersistence {
  private readonly configDir: string;
  private readonly configFile: string;
  private cache: MCPSettingsFile | null = null;
  private dirReady = false;

  constructor(configFile?: string) {
    this.configFile = configFile ?? CONFIG_FILE;
    this.configDir = path.dirname(this.configFile);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await fs.mkdir(this.configDir, { recursive: true });
    this.dirReady = true;
  }

  async load(): Promise<MCPSettingsFile> {
    if (this.cache) return this.cache;

    await this.ensureDir();
    try {
      const raw = await fs.readFile(this.configFile, 'utf-8');
      const data = JSON.parse(raw);
      this.cache = { servers: data.servers ?? [] };
      console.debug(`Loaded ${this.cache.servers.length} MCP servers from ${this.configFile}`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.cache = { servers: [] };
        console.info('No existing mcp.json, starting fresh');
      } else {
        console.error(`Failed to load mcp.json (${err.message}), backing up and resetting`);
        // 备份损坏文件，避免数据丢失
        try {
          const backupPath = this.configFile + '.bak.' + Date.now();
          await fs.copyFile(this.configFile, backupPath);
          console.info(`Corrupted mcp.json backed up to ${backupPath}`);
        } catch {
          // 备份失败不阻塞
        }
        this.cache = { servers: [] };
        // 立即写入空配置
        try {
          await fs.writeFile(this.configFile, JSON.stringify(this.cache, null, 2), 'utf-8');
        } catch {
          // 写入失败不阻塞，下次 save() 会重试
        }
      }
    }
    return this.cache;
  }

  async save(): Promise<void> {
    await this.ensureDir();
    const data = this.cache ?? { servers: [] };
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(this.configFile, json, 'utf-8');
    console.debug(`Saved ${data.servers.length} MCP servers to ${this.configFile}`);
  }

  // --- convenience helpers ---

  async listServers(): Promise<MCPServerConfig[]> {
    const config = await this.load();
    return config.servers;
  }

  async addServer(server: MCPServerConfig): Promise<void> {
    const config = await this.load();
    const idx = config.servers.findIndex(s => s.name === server.name);
    if (idx !== -1) {
      // update existing
      config.servers[idx] = server;
    } else {
      config.servers.push(server);
    }
    await this.save();
  }

  async removeServer(name: string): Promise<boolean> {
    const config = await this.load();
    const len = config.servers.length;
    config.servers = config.servers.filter(s => s.name !== name);
    if (config.servers.length < len) {
      await this.save();
      return true;
    }
    return false;
  }

  async getServer(name: string): Promise<MCPServerConfig | undefined> {
    const config = await this.load();
    return config.servers.find(s => s.name === name);
  }

  // --- marketplace 配置 ---

  async getMarketplaceConfig(): Promise<MCPSettingsFile['marketplace'] | undefined> {
    const config = await this.load();
    return config.marketplace;
  }

  async setMarketplaceConfig(marketplace: MCPSettingsFile['marketplace']): Promise<void> {
    const config = await this.load();
    config.marketplace = marketplace;
    await this.save();
  }

  // for testing / debugging
  get configPath(): string {
    return this.configFile;
  }

  clearCache(): void {
    this.cache = null;
  }
}

// Singleton
export const mcpSettingsPersistence = new MCPSettingsPersistence();
