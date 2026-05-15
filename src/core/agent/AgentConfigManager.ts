import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSON5 from 'json5';
import { stringify as stringifyYAML } from 'yaml';
import type { AgentCategory, ConfigurableAgentConfig } from './types';
import { logger } from '@/core/logger';
import { getUserRoot, getUserAgentsDir } from '@/core/config/PathManager';

const log = logger.child({ module: 'AgentConfigManager' });

export interface AgentOverrideConfig {
  id: string;
  enabled?: boolean;
  provider?: {
    adapter?: string;
    apiKey?: string;
    baseURL?: string;
    model?: string;
  };
  model?: {
    primary?: string;
    maxTokens?: number;
    temperature?: number;
    contextSize?: number;
    thinking?: any;
  };
  systemPrompt?: string | null;
  tools?: Array<{ name: string; description?: string; config?: Record<string, any>; enabled?: boolean }>;
}

export class AgentConfigManager {
  private userId: string;
  private overrideConfigDir: string;
  private overrideConfigs = new Map<string, AgentOverrideConfig>();

  constructor(userId: string) {
    this.userId = userId;
    this.overrideConfigDir = path.join(getUserRoot(userId), 'agent-overrides');
  }

  async init(): Promise<void> {
    log.debug('初始化 Agent Config Manager (user: ' + this.userId + ')...');
    await fs.mkdir(this.overrideConfigDir, { recursive: true });
    const files = await fs.readdir(this.overrideConfigDir).catch(() => []);
    for (const file of files) {
      if (file.endsWith('.json5')) {
        await this.loadOverrideConfig(path.join(this.overrideConfigDir, file));
      }
    }
    log.debug('Agent Config Manager 初始化完成，已加载 ' + this.overrideConfigs.size + ' 个配置覆盖');
  }

  private async loadOverrideConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config = JSON5.parse(content) as AgentOverrideConfig;
      if (config.id) {
        this.overrideConfigs.set(config.id, config);
        log.debug('加载配置覆盖: ' + config.id);
      }
    } catch (error: any) {
      log.warn('加载配置覆盖失败: ' + filePath, error.message);
    }
  }

  /**
   * 创建新的自定义 Agent — 持久化到磁盘并返回完整配置
   */
  async createAgent(config: Partial<ConfigurableAgentConfig>): Promise<ConfigurableAgentConfig> {
    if (!config.id) {
      throw new Error('Agent ID 不能为空');
    }
    if (!config.name) {
      throw new Error('Agent 名称不能为空');
    }

    const { metadata, ...cleanConfig } = config as any;
    const agentConfig: ConfigurableAgentConfig = {
      ...cleanConfig,
      id: config.id,
      name: config.name || config.id,
      description: config.description || '',
      enabled: config.enabled !== false,
      capabilities: config.capabilities || [],
      systemPrompt: config.systemPrompt || null,
      model: config.model || { primary: 'claude-sonnet-4-6', maxTokens: 32000, temperature: 0.3 },
      tools: config.tools || [],
      execution: config.execution || { mode: 'react', maxIterations: 20, timeout: 300000 },
      permissions: config.permissions || { fileRead: 'always', fileWrite: 'ask', bashExec: 'ask', network: 'ask' },
      metadata: { category: 'custom' as AgentCategory },
    };

    const agentsDir = getUserAgentsDir(this.userId);
    await fs.mkdir(agentsDir, { recursive: true });
    const filePath = path.join(agentsDir, config.id + '.yaml');

    const toSave: any = { ...agentConfig };
    delete toSave.metadata;

    const yamlContent = stringifyYAML(toSave);
    await fs.writeFile(filePath, yamlContent, 'utf-8');
    log.info('创建 Agent 配置: ' + filePath);

    return agentConfig;
  }

  getCategory(agent: ConfigurableAgentConfig): AgentCategory {
    if (agent.metadata?.category) return agent.metadata.category;
    if (agent.metadata?.isSystemAgent) return 'system';
    return 'custom';
  }

  getEditableFields(category: AgentCategory): string[] {
    if (category === 'system') {
      return ['provider.adapter', 'provider.apiKey', 'provider.baseURL', 'provider.model', 'model.primary', 'model.maxTokens', 'model.temperature', 'model.contextSize', 'enabled'];
    }
    if (category === 'app') {
      return ['provider.adapter', 'provider.apiKey', 'provider.baseURL', 'provider.model', 'model.primary', 'model.maxTokens', 'model.temperature', 'model.contextSize', 'enabled', 'systemPrompt', 'tools'];
    }
    // custom: all fields except id
    return ['*'];
  }

  validateEditPermission(agent: ConfigurableAgentConfig, updates: Partial<ConfigurableAgentConfig>): boolean {
    const category = this.getCategory(agent);
    if (category === 'custom') return true;

    const editableFields = this.getEditableFields(category);
    const updatePaths = this.getAllUpdatePaths(updates, '');
    for (const updatePath of updatePaths) {
      if (updatePath === 'id') {
        if (updates.id !== agent.id) {
          throw new Error('不允许修改 Agent ID');
        }
        continue;
      }
      if (!editableFields.some(editable => updatePath.startsWith(editable))) {
        const currentValue = this.getValueAtPath(agent, updatePath);
        const newValue = this.getValueAtPath(updates, updatePath);
        if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
          throw new Error(category === 'system' ? '系统 Agent "' + agent.name + '" 不允许修改字段: ' + updatePath : 'App Agent "' + agent.name + '" 不允许修改字段: ' + updatePath);
        }
      }
    }
    return true;
  }

  private getValueAtPath(obj: any, path: string): any {
    return path.split('.').reduce((o, key) => o?.[key], obj);
  }

  private getAllUpdatePaths(obj: any, prefix: string): string[] {
    const paths: string[] = [];
    for (const key in obj) {
      const currentPath = prefix ? prefix + '.' + key : key;
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        paths.push(...this.getAllUpdatePaths(obj[key], currentPath));
      } else {
        paths.push(currentPath);
      }
    }
    return paths;
  }

  async updateAgent(agent: ConfigurableAgentConfig, updates: Partial<ConfigurableAgentConfig>): Promise<ConfigurableAgentConfig> {
    const category = this.getCategory(agent);
    this.validateEditPermission(agent, updates);

    if (category === 'custom') {
      return { ...agent, ...updates };
    }

    // system / app: store as override
    const override: AgentOverrideConfig = { id: agent.id };
    if (updates.enabled !== undefined) {
      override.enabled = updates.enabled;
    }
    if (updates.provider) {
      override.provider = {
        adapter: updates.provider.adapter,
        apiKey: updates.provider.apiKey,
        baseURL: updates.provider.baseURL,
        model: updates.provider.model
      };
    }
    if (updates.model) {
      override.model = {
        primary: updates.model.primary,
        maxTokens: updates.model.maxTokens,
        temperature: updates.model.temperature
      };
      if (updates.model.contextSize !== undefined) {
        override.model.contextSize = updates.model.contextSize;
      }
      if (updates.model.thinking) {
        override.model.thinking = updates.model.thinking;
      }
    }
    if (category === 'app') {
      if ('systemPrompt' in updates) override.systemPrompt = updates.systemPrompt ?? null;
      if (updates.tools) override.tools = updates.tools;
    }
    await this.saveOverrideConfig(override);
    return this.applyOverride(agent, override);
  }

  private async saveOverrideConfig(override: AgentOverrideConfig): Promise<void> {
    this.overrideConfigs.set(override.id, override);
    const filePath = path.join(this.overrideConfigDir, override.id + '.json5');
    const json5Content = JSON5.stringify(override, null, 2);
    await fs.writeFile(filePath, json5Content, 'utf-8');
    log.info('保存配置覆盖: ' + override.id);
  }

  applyOverride(agent: ConfigurableAgentConfig, override?: AgentOverrideConfig): ConfigurableAgentConfig {
    const actualOverride = override || this.overrideConfigs.get(agent.id);
    if (!actualOverride) return agent;

    const result = { ...agent };
    if (actualOverride.enabled !== undefined) {
      result.enabled = actualOverride.enabled;
    }
    if (actualOverride.provider) {
      result.provider = { ...result.provider, ...actualOverride.provider };
    }
    if (actualOverride.model) {
      result.model = { ...result.model, ...actualOverride.model };
    }
    if ('systemPrompt' in actualOverride) {
      result.systemPrompt = actualOverride.systemPrompt ?? null;
    }
    if (actualOverride.tools) {
      result.tools = actualOverride.tools;
    }
    return result;
  }

  getAgentWithOverride(agent: ConfigurableAgentConfig): ConfigurableAgentConfig {
    return this.applyOverride(agent);
  }

  getOverride(agentId: string): AgentOverrideConfig | undefined {
    return this.overrideConfigs.get(agentId);
  }

  async removeOverride(agentId: string): Promise<void> {
    const filePath = path.join(this.overrideConfigDir, agentId + '.json5');
    try {
      await fs.unlink(filePath);
      this.overrideConfigs.delete(agentId);
      log.info('删除配置覆盖: ' + agentId);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  getAllOverrides(): AgentOverrideConfig[] {
    return Array.from(this.overrideConfigs.values());
  }
}
