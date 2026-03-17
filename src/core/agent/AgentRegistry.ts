/**
 * Agent Registry - Agent 配置注册表
 *
 * 职责：
 * - 扫描配置目录（builtin/global/project）
 * - 加载 JSON5/YAML/JSON 配置文件（优先级：JSON5 > YAML > JSON）
 * - 配置验证
 * - 热重载（监听文件变更）
 * - 优先级处理（project > global > builtin）
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

const glob = promisify(globCb);

// ESM 兼容：__dirname 在 ESM 模式下不存在
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

export class AgentRegistry {
  private agents = new Map<string, ConfigurableAgentConfig>();
  private watchers: FSWatcher[] = [];
  private configPaths: string[];

  constructor(configPaths?: string[]) {
    // 默认配置路径（优先级：项目 > 全局 > 内置）
    this.configPaths = configPaths || [
      path.join(__dirname_esm, 'builtin'),                     // 内置 Agent
      path.join(os.homedir(), '.xuanji/agents'),             // 全局 Agent
      path.join(process.cwd(), '.xuanji/agents'),            // 项目级 Agent
    ];
  }

  /**
   * 初始化：扫描所有配置目录
   */
  async init(): Promise<void> {
    console.log('🤖 初始化 Agent Registry...');

    for (const configPath of this.configPaths) {
      try {
        // 检查目录是否存在
        const stat = await fs.stat(configPath).catch(() => null);
        if (!stat?.isDirectory()) {
          console.log(`  ⚠️  配置目录不存在，跳过: ${configPath}`);
          continue;
        }

        // 扫描 JSON5/YAML/JSON 文件（优先级：JSON5 > YAML > JSON）
        const files = await glob(`${configPath}/**/*.{json5,yaml,yml,json}`);

        console.log(`  📂 扫描配置目录: ${configPath}`);

        for (const file of files) {
          await this.loadAgentConfig(file);
        }

        // 监听文件变更（热重载）
        this.watchDirectory(configPath);
      } catch (error: any) {
        console.error(`  ❌ 扫描配置目录失败: ${configPath}`, error.message);
      }
    }

    console.log(`✅ Agent Registry 初始化完成，已加载 ${this.agents.size} 个 Agent\n`);
  }

  /**
   * 加载单个 Agent 配置
   */
  private async loadAgentConfig(filePath: string): Promise<void> {
    try {
      // 读取文件
      const content = await fs.readFile(filePath, 'utf-8');

      // 解析 JSON5/YAML/JSON（优先级：JSON5 > YAML > JSON）
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

      // 添加元数据（保留 JSON5 中的额外字段如 builtin/isSubAgent）
      const runtimeMeta = config.metadata || {};
      config.metadata = {
        ...runtimeMeta,
        source: this.getSource(filePath),
        filePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 注册（优先级：project > global > builtin）
      this.register(config);

      console.log(`    ✓ ${config.id} (${config.name})`);
    } catch (error: any) {
      console.error(`    ✗ 加载失败: ${filePath}`, error.message);
    }
  }

  /**
   * 注册 Agent（支持优先级覆盖）
   */
  register(config: ConfigurableAgentConfig): void {
    const existing = this.agents.get(config.id);

    // 优先级：project > global > builtin
    if (existing && existing.metadata) {
      const priority = { builtin: 0, global: 1, project: 2 };
      const existingPriority = priority[existing.metadata.source];
      const newPriority = priority[config.metadata!.source];

      if (newPriority < existingPriority) {
        console.log(
          `    ⚠️  跳过低优先级配置: ${config.id} (${config.metadata!.source} < ${existing.metadata.source})`
        );
        return; // 低优先级，跳过
      }

      if (newPriority > existingPriority) {
        console.log(
          `    🔄 覆盖配置: ${config.id} (${config.metadata!.source} > ${existing.metadata.source})`
        );
      }
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
            console.log(`\n📝 检测到配置变更: ${filename}`);
            await this.reload();
          }
        }
      );

      this.watchers.push(watcher);
    } catch (error: any) {
      console.error(`  ⚠️  无法监听目录: ${dirPath}`, error.message);
    }
  }

  /**
   * 重新加载所有配置
   */
  async reload(): Promise<void> {
    console.log('🔄 重新加载 Agent 配置...');
    this.agents.clear();
    await this.init();
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

    // 检查 Skills 配置
    if (config.skills) {
      if (config.skills.builtin && !Array.isArray(config.skills.builtin)) {
        throw new Error('skills.builtin 必须是数组');
      }
      if (config.skills.custom && !Array.isArray(config.skills.custom)) {
        throw new Error('skills.custom 必须是数组');
      }
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
   * 判断配置来源
   */
  private getSource(filePath: string): 'builtin' | 'global' | 'project' {
    if (filePath.includes('/builtin/') || filePath.includes('\\builtin\\')) {
      return 'builtin';
    }
    if (filePath.includes('.xuanji/agents') && filePath.includes(process.cwd())) {
      return 'project';
    }
    return 'global';
  }

  /**
   * 清理资源
   */
  dispose(): void {
    console.log('🧹 清理 Agent Registry...');
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    this.agents.clear();
  }

  /**
   * 保存 Agent 配置到 JSON5 文件
   * @param config Agent 配置
   * @param scope 保存范围（global 或 project）
   */
  async saveToFile(config: ConfigurableAgentConfig, scope: 'global' | 'project' = 'global'): Promise<void> {
    // 确定保存路径
    const targetDir = scope === 'global'
      ? path.join(os.homedir(), '.xuanji/agents')
      : path.join(process.cwd(), '.xuanji/agents');

    await fs.mkdir(targetDir, { recursive: true });

    const filePath = path.join(targetDir, `${config.id}.json5`);

    // 移除元数据字段（不应保存到文件）
    const { metadata, ...configToSave } = config;

    // 序列化为 JSON5（带缩进和注释支持）
    const json5Content = JSON5.stringify(configToSave, null, 2);

    // 写入文件
    await fs.writeFile(filePath, json5Content, 'utf-8');

    console.log(`  ✓ 保存 Agent 配置: ${filePath}`);

    // 重新加载配置
    await this.reload();
  }

  /**
   * 删除 Agent 配置文件
   * @param agentId Agent ID
   */
  async deleteFile(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.metadata) {
      throw new Error(`Agent 不存在或无法删除: ${agentId}`);
    }

    // 内置 Agent 不可删除
    if (agent.metadata.source === 'builtin') {
      throw new Error(`内置 Agent 不可删除: ${agentId}`);
    }

    // 删除文件
    await fs.unlink(agent.metadata.filePath);

    console.log(`  ✓ 删除 Agent 配置: ${agent.metadata.filePath}`);

    // 重新加载配置
    await this.reload();
  }
}
