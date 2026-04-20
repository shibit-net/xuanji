import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSON5 from 'json5';
import type { ConfigurableAgentConfig } from './types';
import { logger } from '@/core/logger';
import { getUserRoot } from '@/core/config/PathManager';

const log = logger.child({ module: 'AgentConfigManager' });

export interface AgentOverrideConfig {
  id: string;
  provider?: {
    adapter?: string;
    apiKey?: string;
    baseURL?: string;
    model?: string;
  };
  model?: {
    primary?: string;
  };
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
    log.info('初始化 Agent Config Manager (user: ' + this.userId + ')...');
    await fs.mkdir(this.overrideConfigDir, { recursive: true });
    const files = await fs.readdir(this.overrideConfigDir).catch(() => []);
    for (const file of files) {
      if (file.endsWith('.json5')) {
        await this.loadOverrideConfig(path.join(this.overrideConfigDir, file));
      }
    }
    log.info('Agent Config Manager 初始化完成，已加载 ' + this.overrideConfigs.size + ' 个配置覆盖');
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

  isBuiltinAgent(agent: ConfigurableAgentConfig): boolean {
    return agent.metadata?.builtin === true;
  }

  getEditableFieldsForBuiltin(): string[] {
    return [
      'provider.adapter',
      'provider.apiKey',
      'provider.baseURL',
      'provider.model',
      'model.primary'
    ];
  }

  validateEditPermission(agent: ConfigurableAgentConfig, updates: Partial<ConfigurableAgentConfig>): boolean {
    const isBuiltin = this.isBuiltinAgent(agent);
    if (!isBuiltin) {
      return true;
    }
    const editableFields = this.getEditableFieldsForBuiltin();
    const updatePaths = this.getAllUpdatePaths(updates, '');
    for (const updatePath of updatePaths) {
      if (!editableFields.some(editable => updatePath.startsWith(editable))) {
        throw new Error('内置 Agent "' + agent.name + '" 不允许修改字段: ' + updatePath);
      }
    }
    return true;
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
    const isBuiltin = this.isBuiltinAgent(agent);
    this.validateEditPermission(agent, updates);
    
    if (isBuiltin) {
      const override: AgentOverrideConfig = { id: agent.id };
      if (updates.provider) {
        override.provider = {
          adapter: updates.provider.adapter,
          apiKey: updates.provider.apiKey,
          baseURL: updates.provider.baseURL,
          model: updates.provider.model
        };
      }
      if (updates.model?.primary) {
        override.model = { primary: updates.model.primary };
      }
      await this.saveOverrideConfig(override);
      return this.applyOverride(agent, override);
    } else {
      const updatedAgent = { ...agent, ...updates };
      return updatedAgent;
    }
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
    if (!actualOverride) {
      return agent;
    }
    const result = { ...agent };
    if (actualOverride.provider) {
      result.provider = { ...result.provider, ...actualOverride.provider };
    }
    if (actualOverride.model?.primary) {
      result.model = { ...result.model, primary: actualOverride.model.primary };
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
