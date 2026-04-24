import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { promisify } from 'node:util';
import globCb from 'glob';
import type { AgentCategory, ConfigurableAgentConfig } from './types';
import { logger } from '@/core/logger';
import { AgentConfigManager } from './AgentConfigManager';
import { TemporaryAgentFactory } from './TemporaryAgentFactory';
import {
  getUserAgentsDir,
  getTemplateAgentsDir
} from '@/core/config/PathManager';

const glob = promisify(globCb);
const log = logger.child({ module: 'AgentRegistry' });
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

export class AgentRegistry {
  private agents = new Map<string, ConfigurableAgentConfig>();
  private watchers: FSWatcher[] = [];
  private configPaths: string[];
  private configManager: AgentConfigManager;
  private temporaryAgentFactory: TemporaryAgentFactory;
  private userAgentsDir: string;
  private templateAgentsDir: string;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
    this.userAgentsDir = getUserAgentsDir(userId);
    this.templateAgentsDir = getTemplateAgentsDir();
    this.configPaths = [this.userAgentsDir];
    this.configManager = new AgentConfigManager(userId);
    this.temporaryAgentFactory = new TemporaryAgentFactory();
  }

  async init(): Promise<void> {
    log.info('初始化 Agent Registry (user: ' + this.userId + ')...');
    await this.configManager.init();
    await this.initializeUserAgentsDir();
    
    for (const configPath of this.configPaths) {
      try {
        const stat = await fs.stat(configPath).catch(() => null);
        if (!stat?.isDirectory()) {
          log.warn('配置目录不存在，跳过: ' + configPath);
          continue;
        }
        const files = await glob(configPath + '/**/*.{yaml,yml}');
        log.info('扫描配置目录: ' + configPath);
        for (const file of files) {
          await this.loadAgentConfig(file);
        }
        this.watchDirectory(configPath);
      } catch (error: any) {
        log.error('扫描配置目录失败: ' + configPath, error.message);
      }
    }
    log.info('Agent Registry 初始化完成，已加载 ' + this.agents.size + ' 个 Agent');
  }

  private async initializeUserAgentsDir(): Promise<void> {
    await fs.mkdir(this.userAgentsDir, { recursive: true });
    const userFiles = await fs.readdir(this.userAgentsDir).catch(() => []);
    const hasConfigFiles = userFiles.some(file =>
      file.endsWith('.yaml') || file.endsWith('.yml')
    );
    if (!hasConfigFiles) {
      log.info('用户配置目录为空，正在复制内置 Agent...');
      await this.copyBuiltinAgentsToUserDir();
    }
  }

  private async copyBuiltinAgentsToUserDir(): Promise<void> {
    // 从源码模板目录复制 agents
    if (!fsSync.existsSync(this.templateAgentsDir)) {
      log.warn(`模板 agents 目录不存在: ${this.templateAgentsDir}`);
      return;
    }

    const builtinFiles = await glob(this.templateAgentsDir + '/**/*.{yaml,yml}');

    if (builtinFiles.length === 0) {
      log.warn(`未找到模板 agent 配置文件: ${this.templateAgentsDir}`);
      return;
    }

    log.info(`从模板复制 ${builtinFiles.length} 个 Agent 配置...`);

    for (const srcPath of builtinFiles) {
      try {
        const content = await fs.readFile(srcPath, 'utf-8');
        const fileName = path.basename(srcPath);
        const destPath = path.join(this.userAgentsDir, fileName);

        // 直接复制文件内容
        await fs.writeFile(destPath, content, 'utf-8');
        log.debug('复制 Agent 配置: ' + fileName);
      } catch (error: any) {
        log.error('复制 Agent 配置失败: ' + srcPath, error.message);
      }
    }
    log.info('Agent 配置复制完成');
  }

  private async loadAgentConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config: ConfigurableAgentConfig = parseYAML(content);

      this.validateConfig(config);
      const runtimeMeta = config.metadata || {};
      const category = this.inferCategory(config);
      config.metadata = {
        ...runtimeMeta,
        filePath,
        loadedAt: new Date().toISOString(),
        category
      };
      this.register(config);
      log.debug('加载 Agent: ' + config.id + ' (' + config.name + ')');
    } catch (error: any) {
      log.error('加载失败: ' + filePath, error.message);
    }
  }

  getCategory(agent: ConfigurableAgentConfig): AgentCategory {
    return this.configManager.getCategory(agent);
  }

  private inferCategory(config: ConfigurableAgentConfig): AgentCategory {
    if (config.metadata?.category) return config.metadata.category;
    if (config.metadata?.isSystemAgent || config.metadata?.isMainAgent) return 'system';
    return 'custom';
  }

  register(config: ConfigurableAgentConfig): void {
    const existing = this.agents.get(config.id);
    if (existing) {
      log.info('覆盖 Agent 配置: ' + config.id + ' (' + existing.metadata?.filePath + ' -> ' + config.metadata?.filePath + ')');
    }
    this.agents.set(config.id, config);
  }

  get(id: string): ConfigurableAgentConfig | undefined {
    // 先检查是否是临时 Agent
    const tempAgent = this.temporaryAgentFactory.getTemporaryAgent(id);
    if (tempAgent) {
      return tempAgent;
    }

    // 否则从常规 Agent 中获取
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    return this.configManager.getAgentWithOverride(agent);
  }

  getRaw(id: string): ConfigurableAgentConfig | undefined {
    // 先检查是否是临时 Agent
    const tempAgent = this.temporaryAgentFactory.getTemporaryAgent(id);
    if (tempAgent) {
      return tempAgent;
    }

    return this.agents.get(id);
  }

  getEnabled(): ConfigurableAgentConfig[] {
    // 包含临时 Agent
    const regularAgents = Array.from(this.agents.values())
      .filter(agent => agent.enabled)
      .map(agent => this.configManager.getAgentWithOverride(agent));

    const tempAgents = this.temporaryAgentFactory.getAllTemporaryAgents();

    return [...regularAgents, ...tempAgents];
  }

  getAll(): ConfigurableAgentConfig[] {
    // 包含临时 Agent
    const regularAgents = Array.from(this.agents.values())
      .map(agent => this.configManager.getAgentWithOverride(agent));

    const tempAgents = this.temporaryAgentFactory.getAllTemporaryAgents();

    return [...regularAgents, ...tempAgents];
  }

  /**
   * 获取临时 Agent 工厂
   */
  getTemporaryAgentFactory(): TemporaryAgentFactory {
    return this.temporaryAgentFactory;
  }

  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  getEnabledIds(): string[] {
    return this.getEnabled().map(agent => agent.id);
  }

  getAgentListForPrompt(): string {
    return this.getEnabled()
      .map(agent => {
        const capabilitiesList = agent.capabilities.map(cap => '- ' + cap).join('\n');
        const toolsList = agent.tools.map(t => t.name).join(', ');
        const tagsList = agent.tags.join('、');
        return '\n## ' + agent.name + ' (' + agent.id + ')\n\n**描述**: ' + agent.description + '\n\n**能力**:\n' + capabilitiesList + '\n\n**可用工具**: ' + toolsList + '\n\n**适用场景**: ' + tagsList;
      })
      .join('\n---\n');
  }

  private watchDirectory(dirPath: string): void {
    try {
      const watcher = watch(
        dirPath,
        { recursive: true },
        async (eventType, filename) => {
          if (filename && /\.(yaml|yml)$/.test(filename)) {
            log.info('检测到配置变更: ' + filename);
            await this.reload();
          }
        }
      );
      this.watchers.push(watcher);
    } catch (error: any) {
      log.warn('无法监听目录: ' + dirPath, error.message);
    }
  }

  async reload(): Promise<void> {
    log.info('重新加载 Agent 配置...');
    this.closeWatchers();
    this.agents.clear();
    await this.init();
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch (error: any) {
        log.warn('关闭监听器失败:', error.message);
      }
    }
    this.watchers = [];
  }

  private validateConfig(config: ConfigurableAgentConfig): void {
    const required = [
      'id',
      'name',
      'description',
      'systemPrompt',
      'tools',
      'model',
      'execution',
      'permissions'
    ];
    for (const field of required) {
      if (!(field in config)) {
        throw new Error('缺少必填字段: ' + field);
      }
    }
    if (!config.model?.primary) {
      throw new Error('缺少模型配置: model.primary');
    }
    if (!Array.isArray(config.tools)) {
      throw new Error('tools 必须是数组');
    }
    if (config.knowledgeBase) {
      if (!config.knowledgeBase.path) {
        throw new Error('缺少知识库路径: knowledgeBase.path');
      }
      if (!Array.isArray(config.knowledgeBase.sources)) {
        throw new Error('knowledgeBase.sources 必须是数组');
      }
    }
  }

  dispose(): void {
    log.info('清理 Agent Registry...');
    this.closeWatchers();
    this.agents.clear();
  }

  async saveToFile(config: ConfigurableAgentConfig): Promise<void> {
    await fs.mkdir(this.userAgentsDir, { recursive: true });
    const filePath = path.join(this.userAgentsDir, config.id + '.yaml');
    const { metadata, ...configToSave } = config;
    const configWithMeta: any = { ...configToSave };
    if (metadata?.category && metadata.category !== 'custom') {
      configWithMeta.metadata = {
        category: metadata.category,
        templateSource: metadata.templateSource
      };
    }
    const yamlContent = stringifyYAML(configWithMeta);
    await fs.writeFile(filePath, yamlContent, 'utf-8');
    log.info('保存 Agent 配置: ' + filePath);
    await this.reload();
  }

  async deleteFile(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.metadata?.filePath) {
      throw new Error('Agent 不存在或无法删除: ' + agentId);
    }
    const category = this.inferCategory(agent);
    if (category !== 'custom') {
      throw new Error('只有自定义 Agent 可以删除: ' + agentId);
    }
    await fs.unlink(agent.metadata.filePath);
    log.info('删除 Agent 配置: ' + agent.metadata.filePath);
    await this.reload();
  }

  getConfigManager(): AgentConfigManager {
    return this.configManager;
  }
}
