import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { promisify } from 'node:util';
import globCb from 'glob';
import type { AgentCategory, ConfigurableAgentConfig } from './types';
import { logger } from '@/infrastructure/logger';
import { AgentConfigManager } from './AgentConfigManager';
import {
  getUserAgentsDir,
  getTemplateAgentsDir
} from '@/infrastructure/config/PathManager';

const glob = promisify(globCb);
const log = logger.child({ module: 'AgentRegistry' });
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

export class AgentRegistry {
  private agents = new Map<string, ConfigurableAgentConfig>();
  private watchers: FSWatcher[] = [];
  private configPaths: string[];
  private configManager: AgentConfigManager;
  private userAgentsDir: string;
  private templateAgentsDir: string;
  private userId: string;
  /** 防抖：防止短时间内多次 reload */
  private reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 互斥锁：防止并发 reload */
  private reloadInProgress = false;
  /** 在上一次 reload 期间又收到了变更通知 */
  private pendingReload = false;
  private static readonly RELOAD_DEBOUNCE_MS = 300;

  constructor(userId: string) {
    this.userId = userId;
    this.userAgentsDir = getUserAgentsDir(userId);
    this.templateAgentsDir = getTemplateAgentsDir();
    this.configPaths = [this.userAgentsDir];
    this.configManager = new AgentConfigManager(userId);
  }

  async init(): Promise<void> {
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
        log.debug('扫描配置目录: ' + configPath);
        for (const file of files) {
          await this.loadAgentConfig(file);
        }
        this.watchDirectory(configPath);
      } catch (error: any) {
        log.error('扫描配置目录失败: ' + configPath, error.message);
      }
    }
    log.debug('Agent Registry 初始化完成，已加载 ' + this.agents.size + ' 个 Agent');
  }

  private async initializeUserAgentsDir(): Promise<void> {
    await fs.mkdir(this.userAgentsDir, { recursive: true });
    const userFiles = await fs.readdir(this.userAgentsDir).catch(() => []);
    const hasConfigFiles = userFiles.some(file =>
      file.endsWith('.yaml') || file.endsWith('.yml')
    );
    if (!hasConfigFiles) {
      log.debug('用户配置目录为空，正在复制内置 Agent...');
      await this.copyBuiltinAgentsToUserDir();
    } else {
      // 已有配置文件，同步内置系统 agent 的更新（覆盖 internal:true 的 agent）
      await this.syncBuiltinAgents();
    }
  }

  private get agentSyncStatePath(): string {
    return path.join(this.userAgentsDir, '.sync-state.json');
  }

  private async loadAgentSyncState(): Promise<Record<string, string>> {
    try { return JSON.parse(await fs.readFile(this.agentSyncStatePath, 'utf-8')); } catch { return {}; }
  }

  private async saveAgentSyncState(state: Record<string, string>): Promise<void> {
    await fs.writeFile(this.agentSyncStatePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * 智能同步内置系统 agent（仅 internal: true）
   *
   * 通过 .sync-state.json 存储 hash，保护用户自定义：
   * - 模板未变更 → 跳过
   * - 模板变更 + 用户未自定义 → 覆盖更新
   * - 模板变更 + 用户已自定义 → 跳过
   */
  private async syncBuiltinAgents(): Promise<void> {
    if (!fsSync.existsSync(this.templateAgentsDir)) return;

    const builtinFiles = await glob(this.templateAgentsDir + '/**/*.{yaml,yml}');
    const syncState = await this.loadAgentSyncState();
    let updated = 0, skipped = 0;

    for (const srcPath of builtinFiles) {
      try {
        const content = await fs.readFile(srcPath, 'utf-8');
        const config = parseYAML(content) as any;
        if (!config?.metadata?.internal) continue;

        const fileName = path.basename(srcPath);
        const templateHash = this.computeHash(content);
        const destPath = path.join(this.userAgentsDir, fileName);

        if (!syncState[fileName]) {
          // 新文件 / 首次同步
          await fs.writeFile(destPath, content, 'utf-8');
          syncState[fileName] = templateHash;
          updated++;
          log.debug(`新增内置 Agent: ${fileName}`);
          continue;
        }

        if (syncState[fileName] === templateHash) continue; // 模板未变更

        // 模板已变更：检查用户是否自定义
        let userContent: string;
        try { userContent = await fs.readFile(destPath, 'utf-8'); } catch {
          await fs.writeFile(destPath, content, 'utf-8');
          syncState[fileName] = templateHash;
          updated++;
          continue;
        }

        if (this.computeHash(userContent) === syncState[fileName]) {
          // 用户未自定义 → 安全覆盖
          await fs.writeFile(destPath, content, 'utf-8');
          syncState[fileName] = templateHash;
          updated++;
          log.debug(`更新内置 Agent: ${fileName}（模板已更新，用户未自定义）`);
        } else {
          skipped++;
          log.debug(`跳过内置 Agent: ${fileName}（用户已自定义）`);
        }
      } catch (error: any) {
        log.error(`同步内置 Agent 失败: ${srcPath}`, error.message);
      }
    }

    await this.saveAgentSyncState(syncState);
    if (updated > 0 || skipped > 0) {
      log.debug(`内置 Agent 同步完成: ${updated} 更新, ${skipped} 跳过（用户自定义）`);
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

    log.debug(`从模板复制 ${builtinFiles.length} 个 Agent 配置...`);

    const syncState: Record<string, string> = {};

    for (const srcPath of builtinFiles) {
      try {
        const content = await fs.readFile(srcPath, 'utf-8');
        const fileName = path.basename(srcPath);
        const destPath = path.join(this.userAgentsDir, fileName);

        await fs.writeFile(destPath, content, 'utf-8');
        syncState[fileName] = this.computeHash(content);
        log.debug('复制 Agent 配置: ' + fileName);
      } catch (error: any) {
        log.error('复制 Agent 配置失败: ' + srcPath, error.message);
      }
    }

    await this.saveAgentSyncState(syncState);
    log.debug('Agent 配置复制完成');
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
      log.debug('覆盖 Agent 配置: ' + config.id + ' (' + existing.metadata?.filePath + ' -> ' + config.metadata?.filePath + ')');
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

  getAll(): ConfigurableAgentConfig[] {
    return Array.from(this.agents.values())
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
        const tagsList = (agent.tags ?? []).join('、');
        return '\n## ' + agent.name + ' (' + agent.id + ')\n\n**描述**: ' + agent.description + '\n\n**能力**:\n' + capabilitiesList + '\n\n**可用工具**: ' + toolsList + '\n\n**适用场景**: ' + tagsList;
      })
      .join('\n---\n');
  }

  /** 生成用于 scene-classifier prompt 的 agent 列表（紧凑格式，排除 system agent 和 xuanji） */
  getAgentListForClassifier(): string {
    const agents = this.getEnabled()
      .filter(a => a.metadata?.category !== 'system')
      .filter(a => !a.metadata?.isMainAgent);

    if (agents.length === 0) return '（无可用 Agent）';

    return agents.map(a => {
      const caps = (a.capabilities || []);
      const tags = (a.tags || []).join(', ');
      return [
        `- id: ${a.id}`,
        `  name: ${a.name}`,
        `  description: ${a.description}`,
        caps.length > 0 ? '  capabilities:' : '',
        ...caps.map((c) => `    - ${c}`),
        tags ? `  tags: ${tags}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n');
  }

  private watchDirectory(dirPath: string): void {
    try {
      const watcher = watch(
        dirPath,
        { recursive: true },
        (_eventType, filename) => {
          if (filename && /\.(yaml|yml)$/.test(filename)) {
            log.debug('检测到配置变更: ' + filename);
            this.scheduleReload();
          }
        }
      );
      this.watchers.push(watcher);
    } catch (error: any) {
      log.warn('无法监听目录: ' + dirPath, error.message);
    }
  }

  /** 带防抖的 reload 调度，避免同一文件保存触发多次 reload */
  private scheduleReload(): void {
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }
    this.reloadDebounceTimer = setTimeout(async () => {
      this.reloadDebounceTimer = null;
      await this.reload();
    }, AgentRegistry.RELOAD_DEBOUNCE_MS);
  }

  async reload(): Promise<void> {
    // 如果已有 reload 正在进行，标记为待处理
    if (this.reloadInProgress) {
      this.pendingReload = true;
      return;
    }
    this.reloadInProgress = true;
    try {
      log.debug('重新加载 Agent 配置...');
      this.closeWatchers();
      this.agents.clear();
      await this.init();
    } finally {
      this.reloadInProgress = false;
      // 如果在 reload 期间又收到了变更通知，再 reload 一次
      if (this.pendingReload) {
        this.pendingReload = false;
        this.scheduleReload();
      }
    }
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
    log.debug('清理 Agent Registry...');
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
    log.debug('保存 Agent 配置: ' + filePath);
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
    log.debug('删除 Agent 配置: ' + agent.metadata.filePath);
    await this.reload();
  }

  getConfigManager(): AgentConfigManager {
    return this.configManager;
  }
}
