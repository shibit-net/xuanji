// ============================================================
// M9 配置管理 — 配置加载器
// ============================================================

import type { AppConfig, IConfigLoader } from '@/core/types';
import type { MCPConfig } from '@/mcp/types';
import { DEFAULT_CONFIG } from './defaults';
import { getEnvProviderConfig } from './EnvConfig';
import { loadGlobalConfig, GLOBAL_CONFIG_DIR, deepMergeConfig, getByPath, setByPath } from './GlobalConfig';
import { loadProjectConfig } from './ProjectConfig';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 配置加载器
 *
 * 配置优先级 (从低到高):
 * 1. 默认配置
 * 2. 全局配置 (~/.xuanji/config.json)
 * 3. 项目配置 (.xuanji/config.json)
 * 4. 环境变量
 * 5. CLI 参数 (通过 set 方法)
 */
export class ConfigLoader implements IConfigLoader {
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private loaded = false;

  async load(): Promise<AppConfig> {
    // 1. 从默认配置开始
    let config: AppConfig = { ...DEFAULT_CONFIG };

    // 2. 合并全局配置
    const globalConfig = await loadGlobalConfig();
    config = deepMergeConfig(config as unknown as Record<string, unknown>, globalConfig) as unknown as AppConfig;

    // 3. 合并项目配置
    const projectConfig = await loadProjectConfig();
    config = deepMergeConfig(config as unknown as Record<string, unknown>, projectConfig) as unknown as AppConfig;

    // 4. 合并环境变量
    const envConfig = getEnvProviderConfig();
    config.provider = { ...config.provider, ...envConfig };

    // 5. 加载 MCP 配置（独立文件 ~/.xuanji/mcp.json）
    const mcpConfig = await this.loadMCPConfig();
    if (mcpConfig) {
      config.mcp = mcpConfig;
    }

    this.config = config;
    this.loaded = true;
    return config;
  }

  get<T = unknown>(key: string): T | undefined {
    return getByPath(this.config as unknown as Record<string, unknown>, key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    setByPath(this.config as unknown as Record<string, unknown>, key, value);
  }

  validate(): boolean {
    // 基础校验：必须有模型和 API Key
    if (!this.config.provider.model) return false;
    if (!this.config.provider.apiKey) return false;
    return true;
  }

  /** 获取完整配置 (只读) */
  getConfig(): Readonly<AppConfig> {
    return this.config;
  }

  /** 是否已加载 */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 加载 MCP 配置
   * 从 ~/.xuanji/mcp.json 加载 MCP 服务器配置
   */
  async loadMCPConfig(): Promise<MCPConfig | undefined> {
    const mcpConfigPath = join(GLOBAL_CONFIG_DIR, 'mcp.json');

    try {
      const text = await readFile(mcpConfigPath, 'utf-8');
      const parsed = JSON.parse(text);

      // 基础校验
      if (!parsed.servers || !Array.isArray(parsed.servers)) {
        console.warn('[ConfigLoader] Invalid mcp.json: "servers" must be an array');
        return undefined;
      }

      return parsed as MCPConfig;
    } catch (error) {
      // 文件不存在时静默返回 undefined
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      console.warn('[ConfigLoader] Failed to load mcp.json:', error);
      return undefined;
    }
  }
}
