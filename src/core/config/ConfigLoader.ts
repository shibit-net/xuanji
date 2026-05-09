// ============================================================
// M9 配置管理 — 配置加载器
// ============================================================

import type { AppConfig, IConfigLoader } from '@/core/types';
import type { MCPConfig } from '@/mcp/types';
import { getConfigManager } from './ConfigManager';
import { getUserConfigPath } from './PathManager';
import { deepMergeConfig, getByPath, setByPath } from './ProjectConfig';
import { ConfigValidator } from './ConfigValidator';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';
import JSON5 from 'json5';
import { parse as parseYAML } from 'yaml';

const log = logger.child({ module: 'ConfigLoader' });

/**
 * 配置加载器
 *
 * 配置加载流程:
 * 1. 首次登录：UserConfigInitializer 从模板复制配置到 .xuanji/users/{userId}/
 * 2. 后续启动：ConfigLoader 从本地加载用户配置
 * 3. 加载 Agent 配置（.xuanji/users/{userId}/agents/{agentId}.json5）
 * 4. Agent 配置的 provider 字段覆盖用户配置
 *
 * 配置来源：
 * - 模板（src/core/templates/）：提供初始配置值（首次使用）
 * - 用户配置（.xuanji/users/{userId}/config.json）：本地存储，用户可修改
 * - Agent 配置（.xuanji/users/{userId}/agents/{agentId}.json5）：本地存储，控制 provider
 */
export class ConfigLoader implements IConfigLoader {
  private config: AppConfig | null = null;
  private loaded = false;
  private userId: string;
  private agentId: string;

  constructor(userId: string, agentId: string = 'xuanji') {
    this.userId = userId;
    this.agentId = agentId;
  }

  async load(): Promise<AppConfig> {
    // 1. 初始化用户配置（如果不存在，从模板复制）
    const cfgMgr = getConfigManager();
    await cfgMgr.initForUser(this.userId);

    // 2. 加载用户配置（必须存在，因为已经初始化）
    const userConfig = await this.loadUserConfig();
    if (!userConfig || Object.keys(userConfig).length === 0) {
      throw new Error(`用户配置加载失败: ${this.userId}`);
    }

    let config = userConfig as AppConfig;

    // 3. 加载指定 Agent 配置并覆盖 provider 配置
    const agentConfig = await this.loadAgentConfig(this.agentId);
    if (agentConfig) {
      config = deepMergeConfig(config as unknown as Record<string, unknown>, agentConfig) as unknown as AppConfig;
      log.info(`使用 Agent 配置: ${this.agentId}`);
    }

    // 3.1 加载 Agent 用户覆盖配置（agent-overrides/{agentId}.json5）
    const agentOverride = await this.loadAgentOverride(this.agentId);
    if (agentOverride) {
      config = deepMergeConfig(config as unknown as Record<string, unknown>, agentOverride) as unknown as AppConfig;
      log.info(`使用 Agent 覆盖配置: ${this.agentId}`);
    }

    // 3.5 记录最终 provider 配置
    log.info(`Provider 最终配置: adapter=${(config.provider as any)?.adapter}, model=${config.provider?.model}, baseURL=${(config.provider as any)?.baseURL}`);

    // 3.6 检查 provider 加载状态
    if (!config.provider?.apiKey) {
      log.warn(`[CONFIG_DEBUG] config.provider 为空！检查 agent 配置路径...`);
      const { getUserAgentsDir } = await import('./PathManager.js');
      const agentsDir = getUserAgentsDir(this.userId);
      log.warn(`[CONFIG_DEBUG] agentsDir=${agentsDir}`);
      const { existsSync } = await import('node:fs');
      const yamlPath = join(agentsDir, 'xuanji.yaml');
      log.warn(`[CONFIG_DEBUG] yamlPath=${yamlPath}, exists=${existsSync(yamlPath)}`);

      const retryConfig = await this.loadAgentConfig(this.agentId);
      log.warn(`[CONFIG_DEBUG] loadAgentConfig returned: ${JSON.stringify({
        hasProvider: !!retryConfig,
        hasApiKey: !!retryConfig?.provider?.apiKey,
        adapter: retryConfig?.provider?.adapter,
      })}`);

      if (retryConfig?.provider?.apiKey) {
        log.info(`发现 provider.apiKey 为空，从 Agent 配置补全`);
        config.provider = { ...config.provider, ...retryConfig.provider };
      }
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
      log.info(`用户配置文件不存在，创建默认配置: ${configPath}`);
      const defaultConfig: Record<string, any> = {
        provider: {},
        ui: { theme: 'dark', language: 'zh', showTokenUsage: true, showCost: true, showThinking: false },
        permission: { fileWrite: 'ask', fileRead: 'always', bashExec: 'ask' },
        tools: { enabled: [], permissions: { fileWrite: 'ask', fileRead: 'always', bashExec: 'ask' } },
        retry: { maxRetries: 3, initialDelay: 1000, maxDelay: 30000, backoffMultiplier: 2 },
        session: {
          autoResumeLastSession: false,
          showResumeNotification: true,
          archiveThresholds: { messageCount: 200, tokenCount: 100000, timeMinutes: 30 },
          archiveStrategy: { keepRecentMessages: 20, generateSummary: true, extractKeyPoints: true },
        },
      };
      try {
        await writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
        log.info(`默认配置已创建: ${configPath}`);
      } catch (writeErr) {
        log.warn('创建默认配置文件失败:', writeErr);
      }
      return defaultConfig;
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

  /**
   * 加载指定 Agent 配置
   *
   * 从 agents 目录加载指定 agentId 的配置
   * 将 agent 的 provider 配置转换为 AppConfig 的 provider 格式
   */
  async loadAgentConfig(agentId: string): Promise<Record<string, any> | null> {
    try {
      // 构建 agent 配置文件路径
      const { getUserAgentsDir } = await import('./PathManager.js');
      const agentsDir = getUserAgentsDir(this.userId);

      // 尝试多种文件扩展名
      const extensions = ['.json5', '.yaml', '.yml', '.json'];
      let agentConfigPath: string | null = null;

      for (const ext of extensions) {
        const path = join(agentsDir, `${agentId}${ext}`);
        if (existsSync(path)) {
          agentConfigPath = path;
          break;
        }
      }

      if (!agentConfigPath) {
        log.warn(`Agent 配置文件不存在: ${agentId}`);
        return null;
      }

      // 读取并解析 agent 配置
      const content = await readFile(agentConfigPath, 'utf-8');
      let agentConfig: any;

      if (agentConfigPath.endsWith('.json5')) {
        agentConfig = JSON5.parse(content);
      } else if (agentConfigPath.endsWith('.yaml') || agentConfigPath.endsWith('.yml')) {
        agentConfig = parseYAML(content);
      } else {
        agentConfig = JSON.parse(content);
      }

      // 转换 agent 配置为 AppConfig 格式
      const providerConfig: Record<string, any> = {};

      // 从 agent.provider 读取配置
      if (agentConfig.provider) {
        if (agentConfig.provider.adapter) {
          providerConfig.adapter = agentConfig.provider.adapter;
        }
        if (agentConfig.provider.apiKey) {
          providerConfig.apiKey = agentConfig.provider.apiKey;
        }
        if (agentConfig.provider.baseURL) {
          providerConfig.baseURL = agentConfig.provider.baseURL;
        }
      }

      // 从 agent.model 读取配置
      if (agentConfig.model) {
        if (agentConfig.model.primary) {
          providerConfig.model = agentConfig.model.primary;
        }
        if (agentConfig.model.maxTokens) {
          providerConfig.maxTokens = agentConfig.model.maxTokens;
        }
        if (agentConfig.model.temperature !== undefined) {
          providerConfig.temperature = agentConfig.model.temperature;
        }
        if (agentConfig.model.thinking) {
          providerConfig.thinking = agentConfig.model.thinking;
        }
      }

      // 从 agent.prompt 读取配置
      const promptConfig: Record<string, any> = {};
      if (agentConfig.prompt) {
        if (agentConfig.prompt.defaultScene) {
          promptConfig.defaultScene = agentConfig.prompt.defaultScene;
        }
        if (agentConfig.prompt.defaultComplexity) {
          promptConfig.defaultComplexity = agentConfig.prompt.defaultComplexity;
        }
      }

      log.debug(`加载 Agent 配置: ${agentId}`, {
        model: providerConfig.model,
        adapter: providerConfig.adapter,
        hasApiKey: !!providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        prompt: promptConfig,
      });

      const result: Record<string, any> = { provider: providerConfig };
      if (Object.keys(promptConfig).length > 0) {
        result.prompt = promptConfig;
      }
      return result;
    } catch (error) {
      log.error(`加载 Agent 配置失败:`, error);
      return null;
    }
  }

  /**
   * 加载 Agent 用户覆盖配置
   *
   * 从 agent-overrides/{agentId}.json5 读取用户保存的 Agent 修改
   * 转换为与 loadAgentConfig 相同的格式，用于 deepMerge
   */
  private async loadAgentOverride(agentId: string): Promise<Record<string, any> | null> {
    try {
      const { getUserRoot } = await import('./PathManager.js');
      const userRoot = getUserRoot(this.userId);
      const overridePath = join(userRoot, 'agent-overrides', `${agentId}.json5`);

      if (!existsSync(overridePath)) {
        return null;
      }

      const content = await readFile(overridePath, 'utf-8');
      const override = JSON5.parse(content) as any;

      const providerConfig: Record<string, any> = {};
      if (override.provider) {
        if (override.provider.adapter) providerConfig.adapter = override.provider.adapter;
        if (override.provider.apiKey) providerConfig.apiKey = override.provider.apiKey;
        if (override.provider.baseURL) providerConfig.baseURL = override.provider.baseURL;
        if (override.provider.model) providerConfig.model = override.provider.model;
      }
      if (override.model) {
        if (override.model.primary) providerConfig.model = override.model.primary;
        if (override.model.maxTokens) providerConfig.maxTokens = override.model.maxTokens;
        if (override.model.temperature !== undefined) providerConfig.temperature = override.model.temperature;
      }

      log.debug(`加载 Agent 覆盖配置: ${agentId}`, {
        adapter: providerConfig.adapter,
        hasApiKey: !!providerConfig.apiKey,
      });

      return { provider: providerConfig };
    } catch (error) {
      log.warn(`加载 Agent 覆盖配置失败: ${agentId}`, error);
      return null;
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return getByPath(this.config as unknown as Record<string, unknown>, key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    setByPath(this.config as unknown as Record<string, unknown>, key, value);
  }

  validate(): boolean {
    if (!this.config) {
      return false;
    }
    // 基础校验：必须有模型
    if (!this.config.provider?.model) return false;
    // API Key 可以在 Agent 配置中设置，不强制要求
    return true;
  }

  /** 获取完整配置 (只读) */
  getConfig(): Readonly<AppConfig> {
    if (!this.config) {
      throw new Error('配置未加载，请先调用 load()');
    }
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
      };

      await writeFile(destPath, JSON.stringify(template, null, 2), 'utf-8');
      log.info(`创建 MCP 配置模板: ${destPath}`);
    } catch (error) {
      log.error(`创建 MCP 配置模板失败: ${destPath}`, error);
    }
  }
}
