// ============================================================
// M9 配置管理 — 配置加载器
// ============================================================

import type { AppConfig, IConfigLoader } from '@/core/types';
import type { MCPConfig } from '@/mcp/types';
import { DEFAULT_CONFIG } from './defaults';
import { getEnvProviderConfig, getEnvUIConfig, getEnvMemoryConfig } from './EnvConfig';
import { loadGlobalConfig, GLOBAL_CONFIG_DIR, deepMergeConfig, getByPath, setByPath } from './GlobalConfig';
import { loadProjectConfig } from './ProjectConfig';
import { ConfigValidator } from './ConfigValidator';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfigLoader' });

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

    // 4. 合并环境变量（Provider + UI + Memory）
    const envConfig = getEnvProviderConfig();
    config.provider = { ...config.provider, ...envConfig };

    const envUIConfig = getEnvUIConfig();
    if (Object.keys(envUIConfig).length > 0) {
      config.ui = { ...config.ui, ...envUIConfig } as typeof config.ui;
    }

    const envMemoryConfig = getEnvMemoryConfig();
    if (Object.keys(envMemoryConfig).length > 0) {
      config.memory = { ...config.memory, ...envMemoryConfig } as typeof config.memory;
    }

    // 5. 加载 MCP 配置（独立文件 ~/.xuanji/mcp.json）
    const mcpConfig = await this.loadMCPConfig();
    if (mcpConfig) {
      config.mcp = mcpConfig;
    }

    // 6. 校验配置（打印警告，不阻塞启动）
    this.validateConfig(config);

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
   * 使用 ConfigValidator 校验配置
   *
   * 校验失败只打印警告，不阻塞启动。
   * 这样可以在用户配置不完整时仍能进入交互模式。
   */
  private validateConfig(config: AppConfig): void {
    try {
      const result = ConfigValidator.validate(config);
      if (!result.valid) {
        // 仅打印警告，不阻塞
        log.warn(`配置校验发现 ${result.errors.length} 个问题`);
        for (const error of result.errors) {
          log.warn(`  [${error.path}] ${error.message}`);
        }
      }
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          log.debug(`  [${warning.path}] ${warning.message}`);
        }
      }
    } catch (error) {
      // 校验器本身出错不应影响启动
      log.debug(`配置校验器异常: ${error instanceof Error ? error.message : String(error)}`);
    }
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
        log.warn('Invalid mcp.json: "servers" must be an array');
        return undefined;
      }

      return parsed as MCPConfig;
    } catch (error) {
      // 文件不存在时静默返回 undefined
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      log.warn('Failed to load mcp.json:', error);
      return undefined;
    }
  }
}
