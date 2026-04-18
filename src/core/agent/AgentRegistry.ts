import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { parse as parseYAML } from 'yaml';
import { promisify } from 'node:util';
import globCb from 'glob';
import type { ConfigurableAgentConfig } from './types';
import { logger } from '@/core/logger';
import { AgentConfigManager } from './AgentConfigManager';

const glob = promisify(globCb);
const log = logger.child({ module: 'AgentRegistry' });
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

function getUserConfigDir(userId: string): string {
  return path.join(process.cwd(), '.xuanji', 'users', userId);
}

export class AgentRegistry {
  private agents = new Map<string, ConfigurableAgentConfig>();
  private watchers: FSWatcher[] = [];
  private configPaths: string[];
  private configManager: AgentConfigManager;
  private userAgentsDir: string;
  private userId: string;

  constructor(userId: string = 'default') {
    this.userId = userId;
    this.userAgentsDir = path.join(getUserConfigDir(userId), 'agents');
    this.configPaths = [this.userAgentsDir];
    this.configManager = new AgentConfigManager(userId);
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
        const files = await glob(configPath + '/**/*.{json5,yaml,yml,json}');
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
      file.endsWith('.json5') || file.endsWith('.yaml') || 
      file.endsWith('.yml') || file.endsWith('.json')
    );
    if (!hasConfigFiles) {
      log.info('用户配置目录为空，正在复制内置 Agent...');
      await this.copyBuiltinAgentsToUserDir();
    }
  }

  private async copyBuiltinAgentsToUserDir(): Promise<void> {
    // 从 default 模板复制 agents 目录
    const templateAgentsDir = path.join(process.cwd(), '.xuanji', 'users', 'default', 'agents');

    if (!fs.existsSync(templateAgentsDir)) {
      log.warn(`模板 agents 目录不存在: ${templateAgentsDir}`);
      return;
    }

    const builtinFiles = await glob(templateAgentsDir + '/**/*.{json5,yaml,yml,json}');

    if (builtinFiles.length === 0) {
      log.warn(`未找到模板 agent 配置文件: ${templateAgentsDir}`);
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
      let config: ConfigurableAgentConfig;
      if (filePath.endsWith('.json5')) {
        config = JSON5.parse(content);
      } else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        config = parseYAML(content);
      } else {
        config = JSON.parse(content);
      }
      this.validateConfig(config);
      const runtimeMeta = config.metadata || {};
      const isBuiltin = runtimeMeta.builtin === true;
      const source = isBuiltin ? 'builtin' : 'user';
      config.metadata = {
        ...runtimeMeta,
        filePath,
        loadedAt: new Date().toISOString(),
        source
      };
      this.register(config);
      log.debug('加载 Agent: ' + config.id + ' (' + config.name + ')');
    } catch (error: any) {
      log.error('加载失败: ' + filePath, error.message);
    }
  }

  register(config: ConfigurableAgentConfig): void {
    const existing = this.agents.get(config.id);
    if (existing) {
      log.info('覆盖 Agent 配置: ' + config.id + ' (' + existing.metadata?.filePath + ' -> ' + config.metadata?.filePath + ')');
    }
    this.agents.set(config.id, config);
  }

  get(id: string): ConfigurableAgentConfig | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    return this.configManager.getAgentWithOverride(agent);
  }

  getRaw(id: string): ConfigurableAgentConfig | undefined {
    return this.agents.get(id);
  }

  getEnabled(): ConfigurableAgentConfig[] {
    return Array.from(this.agents.values())
      .filter(agent => agent.enabled)
      .map(agent => this.configManager.getAgentWithOverride(agent));
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
          if (filename && /\.(json5|yaml|yml|json)$/.test(filename)) {
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
    const isInternalAgent = config.metadata?.internal === true;
    if (!Array.isArray(config.tools)) {
      throw new Error('tools 必须是数组');
    }
    if (!isInternalAgent && config.tools.length === 0) {
      throw new Error('工具列表不能为空（系统内部 Agent 除外）');
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
    const filePath = path.join(this.userAgentsDir, config.id + '.json5');
    const { metadata, ...configToSave } = config;
    const configWithBuiltinMarker: any = { ...configToSave };
    if (metadata?.builtin === true) {
      configWithBuiltinMarker.metadata = {
        builtin: true,
        templateSource: metadata.templateSource
      };
    }
    const json5Content = JSON5.stringify(configWithBuiltinMarker, null, 2);
    await fs.writeFile(filePath, json5Content, 'utf-8');
    log.info('保存 Agent 配置: ' + filePath);
    await this.reload();
  }

  async deleteFile(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.metadata?.filePath) {
      throw new Error('Agent 不存在或无法删除: ' + agentId);
    }
    if (agent.metadata?.builtin === true) {
      throw new Error('内置 Agent 不可删除: ' + agentId);
    }
    await fs.unlink(agent.metadata.filePath);
    log.info('删除 Agent 配置: ' + agent.metadata.filePath);
    await this.reload();
  }

  getConfigManager(): AgentConfigManager {
    return this.configManager;
  }
}
