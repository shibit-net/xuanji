/**
 * Agent Registry - Agent 配置注册表
 *
 * 职责：
 * - 扫描配置目录（builtin/user/project）
 * - 加载 JSON5/YAML/JSON 配置文件
 * - 配置验证
 * - 热重载（监听文件变更）
 *
 * 注意：所有 agent 配置都是独立的，不再有优先级概念。
 * 如果多个目录有同名 agent，后加载的覆盖前加载的（简单覆盖）。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { watch, type FSWatcher } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { parse as parseYAML } from 'yaml';
import { promisify } from 'node:util';
import globCb from 'glob';
import type { ConfigurableAgentConfig } from './types';
import { logger } from '@/core/logger';

const glob = promisify(globCb);
const log = logger.child({ module: 'AgentRegistry' });

// ESM 兼容：__dirname 在 ESM 模式下不存在
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

export class AgentRegistry {
  private agents = new Map<string, ConfigurableAgentConfig>();
  private watchers: FSWatcher[] = [];
  private configPaths: string[];

  constructor(configPaths?: string[]) {
    // 配置路径（加载顺序：builtin → user → project）
    // 后加载的同名 agent 会覆盖先加载的
    this.configPaths = configPaths || [
      path.join(__dirname_esm, 'builtin'),                     // 内置 Agent
      path.join(os.homedir(), '.xuanji/agents'),             // 用户自定义 Agent
      path.join(process.cwd(), '.xuanji/agents'),            // 项目专用 Agent
    ];
  }

  /**
   * 初始化：扫描所有配置目录
   */
  async init(): Promise<void> {
    log.info('初始化 Agent Registry...');

    for (const configPath of this.configPaths) {
      try {
        // 检查目录是否存在
        const stat = await fs.stat(configPath).catch(() => null);
        if (!stat?.isDirectory()) {
          log.warn(`配置目录不存在，跳过: ${configPath}`);
          continue;
        }

        // 扫描 JSON5/YAML/JSON 文件（优先级：JSON5 > YAML > JSON）
        const files = await glob(`${configPath}/**/*.{json5,yaml,yml,json}`);

        log.info(`扫描配置目录: ${configPath}`);

        for (const file of files) {
          await this.loadAgentConfig(file);
        }

        // 监听文件变更（热重载）
        this.watchDirectory(configPath);
      } catch (error: any) {
        log.error(`扫描配置目录失败: ${configPath}`, error.message);
      }
    }

    log.info(`Agent Registry 初始化完成，已加载 ${this.agents.size} 个 Agent`);
  }

  /**
   * 加载单个 Agent 配置
   */
  private async loadAgentConfig(filePath: string): Promise<void> {
    try {
      // 读取文件
      const content = await fs.readFile(filePath, 'utf-8');

      // 解析 JSON5/YAML/JSON
      let config: ConfigurableAgentConfig;
      if (filePath.endsWith('.json5')) {
        config = JSON5.parse(content);
      } else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        config = parseYAML(content);
      } else {
        config = JSON.parse(content);
      }

      // 验证配置
      this.validateConfig(config);

      // 添加元数据
      const runtimeMeta = config.metadata || {};
      // 判断是否为内置 Agent（从 builtin 目录加载）
      const isBuiltin = filePath.includes('/builtin/') || filePath.includes('\\builtin\\');

      config.metadata = {
        ...runtimeMeta,
        filePath,
        loadedAt: new Date().toISOString(),
        builtin: isBuiltin, // 标记是否为内置 Agent
      };

      // 注册（简单覆盖，后加载的覆盖先加载的）
      this.register(config);

      log.debug(`加载 Agent: ${config.id} (${config.name})`);
    } catch (error: any) {
      log.error(`加载失败: ${filePath}`, error.message);
    }
  }

  /**
   * 注册 Agent（简单覆盖）
   */
  register(config: ConfigurableAgentConfig): void {
    const existing = this.agents.get(config.id);

    if (existing) {
      log.info(`覆盖 Agent 配置: ${config.id} (${existing.metadata?.filePath} → ${config.metadata?.filePath})`);
    }

    this.agents.set(config.id, config);
  }

  /**
   * 获取 Agent 配置
   */
  get(id: string): ConfigurableAgentConfig | undefined {
    return this.agents.get(id);
  }

  /**
   * 获取所有启用的 Agent
   */
  getEnabled(): ConfigurableAgentConfig[] {
    return Array.from(this.agents.values()).filter(agent => agent.enabled);
  }

  /**
   * 获取所有 Agent ID
   */
  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * 生成给 Orchestrator 的 Agent 列表（Markdown 格式）
   */
  getAgentListForPrompt(): string {
    return this.getEnabled()
      .map(agent => {
        return `
## ${agent.name} (${agent.id})

**描述**: ${agent.description}

**能力**:
${agent.capabilities.map(cap => `- ${cap}`).join('\n')}

**可用工具**: ${agent.tools.map(t => t.name).join(', ')}

**适用场景**: ${agent.tags.join('、')}
`;
      })
      .join('\n---\n');
  }

  /**
   * 监听目录变更（热重载）
   */
  private watchDirectory(dirPath: string): void {
    try {
      const watcher = watch(
        dirPath,
        { recursive: true },
        async (eventType, filename) => {
          if (filename && /\.(json5|yaml|yml|json)$/.test(filename)) {
            log.info(`检测到配置变更: ${filename}`);
            await this.reload();
          }
        }
      );

      this.watchers.push(watcher);
    } catch (error: any) {
      log.warn(`无法监听目录: ${dirPath}`, error.message);
    }
  }

  /**
   * 重新加载所有配置
   */
  async reload(): Promise<void> {
    log.info('重新加载 Agent 配置...');

    // 先关闭所有旧的监听器，避免监听器泄漏
    this.closeWatchers();

    this.agents.clear();
    await this.init();
  }

  /**
   * 关闭所有文件监听器
   */
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

  /**
   * 验证配置合法性
   */
  private validateConfig(config: ConfigurableAgentConfig): void {
    // 检查必填字段
    const required = [
      'id',
      'name',
      'description',
      'systemPrompt',
      'tools',
      'model',
      'execution',
      'permissions',
    ];

    for (const field of required) {
      if (!(field in config)) {
        throw new Error(`缺少必填字段: ${field}`);
      }
    }

    // 检查模型配置
    if (!config.model?.primary) {
      throw new Error('缺少模型配置: model.primary');
    }

    // 检查工具列表（系统内部 Agent 允许为空）
    const isInternalAgent = config.metadata?.internal === true;
    if (!Array.isArray(config.tools)) {
      throw new Error('tools 必须是数组');
    }
    if (!isInternalAgent && config.tools.length === 0) {
      throw new Error('工具列表不能为空（系统内部 Agent 除外）');
    }

    // 检查知识库配置
    if (config.knowledgeBase) {
      if (!config.knowledgeBase.path) {
        throw new Error('缺少知识库路径: knowledgeBase.path');
      }
      if (!Array.isArray(config.knowledgeBase.sources)) {
        throw new Error('knowledgeBase.sources 必须是数组');
      }
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    log.info('清理 Agent Registry...');
    this.closeWatchers();
    this.agents.clear();
  }

  /**
   * 保存 Agent 配置到 JSON5 文件
   * @param config Agent 配置
   * @param targetDir 目标目录（'user' 或 'project'）
   */
  async saveToFile(config: ConfigurableAgentConfig, targetDir: 'user' | 'project' = 'user'): Promise<void> {
    // 确定保存路径
    const saveDir = targetDir === 'user'
      ? path.join(os.homedir(), '.xuanji/agents')
      : path.join(process.cwd(), '.xuanji/agents');

    await fs.mkdir(saveDir, { recursive: true });

    const filePath = path.join(saveDir, `${config.id}.json5`);

    // 移除元数据字段（不应保存到文件）
    const { metadata, ...configToSave } = config;

    // 序列化为 JSON5（带缩进和注释支持）
    const json5Content = JSON5.stringify(configToSave, null, 2);

    // 写入文件
    await fs.writeFile(filePath, json5Content, 'utf-8');

    log.info(`保存 Agent 配置: ${filePath}`);

    // 重新加载配置
    await this.reload();
  }

  /**
   * 删除 Agent 配置文件
   * @param agentId Agent ID
   */
  async deleteFile(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.metadata?.filePath) {
      throw new Error(`Agent 不存在或无法删除: ${agentId}`);
    }

    // 内置 Agent 不可删除（检查文件路径）
    if (agent.metadata.filePath.includes('/builtin/') || agent.metadata.filePath.includes('\\builtin\\')) {
      throw new Error(`内置 Agent 不可删除: ${agentId}`);
    }

    // 删除文件
    await fs.unlink(agent.metadata.filePath);

    log.info(`删除 Agent 配置: ${agent.metadata.filePath}`);

    // 重新加载配置
    await this.reload();
  }
}
