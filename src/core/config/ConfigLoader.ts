// ============================================================
// M9 配置管理 — 配置加载器
// ============================================================

import type { AppConfig, IConfigLoader } from '@/core/types';
import type { MCPConfig } from '@/mcp/types';
import { DEFAULT_CONFIG } from './defaults';
import { UserConfigInitializer, getUserConfigPath } from './UserConfigInitializer';
import { deepMergeConfig, getByPath, setByPath } from './GlobalConfig';
import { ConfigValidator } from './ConfigValidator';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfigLoader' });

/**
 * 配置加载器
 *
 * 配置优先级 (从低到高):
 * 1. 默认配置（代码中的 DEFAULT_CONFIG）
 * 2. 用户配置（.xuanji/users/{userId}/config.json）
 * 3. 运行时配置（通过 set 方法动态修改）
 */
export class ConfigLoader implements IConfigLoader {
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private loaded = false;
  private userId: string;

  constructor(userId: string = 'default') {
    this.userId = userId;
  }

  async load(): Promise<AppConfig> {
    // 1. 从默认配置开始
    let config: AppConfig = { ...DEFAULT_CONFIG };

    // 2. 初始化用户配置（如果不存在）
    const initializer = new UserConfigInitializer(this.userId);
    await initializer.initialize();

    // 3. 加载用户配置
    const userConfig = await this.loadUserConfig();
    if (userConfig && Object.keys(userConfig).length > 0) {
      config = deepMergeConfig(config as unknown as Record<string, unknown>, userConfig) as unknown as AppConfig;
    }

    // 4. 加载 MCP 配置（独立文件 .xuanji/users/{userId}/mcp.json）
    const mcpConfig = await this.loadMCPConfig();
    if (mcpConfig) {
      config.mcp = mcpConfig;
    }

    // 5. 校验配置（打印警告，不阻塞启动）
    this.validateConfig(config);

    this.config = config;
    this.loaded = true;
    return config;
  }

  /**
   * 加载用户配置
   */
  private async loadUserConfig(): Promise<Record<string, any>> {
    const configPath = getUserConfigPath(this.userId);

    if (!existsSync(configPath)) {
      log.debug(`用户配置文件不存在: ${configPath}`);
      return {};
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      // 支持两种格式：
      // 1. { version, userId, config: {...} }
      // 2. 直接的配置对象 {...}
      if (parsed.version && parsed.config) {
        log.debug(`加载用户配置 (版本 ${parsed.version}): ${this.userId}`);
        return parsed.config;
      } else {
        log.debug(`加载用户配置: ${this.userId}`);
        return parsed;
      }
    } catch (error) {
      log.warn(`加载用户配置失败 (${this.userId}):`, error);
      return {};
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return getByPath(this.config as unknown as Record<string, unknown>, key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    setByPath(this.config as unknown as Record<string, unknown>, key, value);
  }

  validate(): boolean {
    // 基础校验：必须有模型
    if (!this.config.provider.model) return false;
    // API Key 可以在用户配置中设置，不强制要求
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

  /** 获取用户 ID */
  getUserId(): string {
    return this.userId;
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
   * 从 .xuanji/users/{userId}/mcp.json 加载 MCP 服务器配置
   * 如果文件不存在，尝试从模板生成
   */
  async loadMCPConfig(): Promise<MCPConfig | undefined> {
    const userConfigRoot = dirname(getUserConfigPath(this.userId));
    const mcpConfigPath = join(userConfigRoot, 'mcp.json');

    if (!existsSync(mcpConfigPath)) {
      log.debug(`MCP 配置文件不存在，尝试从模板生成: ${mcpConfigPath}`);
      await this.createMCPConfigFromTemplate(mcpConfigPath);

      // 如果生成失败，返回 undefined
      if (!existsSync(mcpConfigPath)) {
        return undefined;
      }
    }

    try {
      const text = await readFile(mcpConfigPath, 'utf-8');
      const parsed = JSON.parse(text);

      // 基础校验
      if (!parsed.servers || !Array.isArray(parsed.servers)) {
        log.warn('Invalid mcp.json: "servers" must be an array');
        return undefined;
      }

      log.debug(`加载 MCP 配置: ${parsed.servers.length} 个服务器`);
      return parsed as MCPConfig;
    } catch (error) {
      log.warn('Failed to load mcp.json:', error);
      return undefined;
    }
  }

  /**
   * 从模板创建 MCP 配置文件
   */
  private async createMCPConfigFromTemplate(destPath: string): Promise<void> {
    try {
      // MCP 配置模板
      const template: MCPConfig = {
        servers: [],
        // 可以添加一些示例配置
        _examples: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
            description: 'File system access server'
          },
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: {
              GITHUB_TOKEN: 'your-github-token'
            },
            description: 'GitHub API server'
          }
        }
      };

      await writeFile(destPath, JSON.stringify(template, null, 2), 'utf-8');
      log.info(`创建 MCP 配置模板: ${destPath}`);
    } catch (error) {
      log.error(`创建 MCP 配置模板失败: ${destPath}`, error);
    }
  }
}
