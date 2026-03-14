/**
 * ============================================================
 * Multi-Agent System - ConfigurableWorkerAgent
 * ============================================================
 * 可配置的 Worker Agent，根据 YAML 配置创建专属资源
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';
import globCb from 'glob';
import { parse as parseCSV } from 'csv-parse/sync';
import type {
  ConfigurableAgentConfig,
  CustomSkill,
  KnowledgeSource,
  AgentContext,
} from './types';
import type { Skill } from '@/core/skills/types';
import { SkillRegistry } from '@/core/skills/registry';

const glob = promisify(globCb);
import { MemoryManager } from '@/memory/MemoryManager';
import type { IMemoryStore } from '@/memory/types';
import type { IToolRegistry } from '@/core/types';
import type { Tool } from '@/core/types';
import { ToolRegistry } from '@/core/tools/ToolRegistry';
import { KnowledgeQueryTool } from '@/core/tools/KnowledgeQueryTool';
import type { ILLMProvider } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'configurable-worker-agent' });

/**
 * 可配置 Worker Agent
 *
 * 特点：
 * - 专属 SkillRegistry（内置 + 自定义）
 * - 专属 MemoryManager（知识库）
 * - 专属 ToolRegistry（过滤 + 自定义配置）
 * - 独立目录存储（全局/项目级）
 */
export class ConfigurableWorkerAgent {
  // 专属资源
  private skillRegistry!: SkillRegistry;
  private memoryManager!: IMemoryStore;
  private toolRegistry!: IToolRegistry;
  private agentDir: string;

  // 配置
  readonly id: string;
  readonly name: string;
  readonly description: string;

  constructor(
    private config: ConfigurableAgentConfig,
    private globalSkillRegistry: SkillRegistry,
    private globalToolRegistry: IToolRegistry,
    private provider: ILLMProvider,
  ) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;

    // 解析 Agent 目录路径
    this.agentDir = this.resolveAgentDirectory(config);
  }

  /**
   * 初始化 Agent（异步加载专属资源）
   */
  async init(): Promise<void> {
    log.info(`🤖 初始化 Agent: ${this.name} (${this.id})`);

    try {
      // 确保目录存在
      await fs.mkdir(this.agentDir, { recursive: true });

      // 1. 构建专属 Skill Registry
      this.skillRegistry = await this.buildSkillRegistry();
      log.info(`  ✓ Skill Registry: ${this.skillRegistry.list().length} skills`);

      // 2. 构建专属知识库
      this.memoryManager = await this.buildMemoryManager();
      log.info(`  ✓ Knowledge Base: initialized`);

      // 3. 构建专属工具集
      this.toolRegistry = this.buildToolRegistry();
      log.info(`  ✓ Tool Registry: ${this.config.tools.length} tools`);

      log.info(`✅ Agent 初始化完成: ${this.name}`);
    } catch (error) {
      log.error(`❌ Agent 初始化失败: ${this.name}`, error);
      throw error;
    }
  }

  /**
   * 执行任务
   */
  async run(context: AgentContext): Promise<string> {
    log.info(`▶️  执行任务: ${context.task}`);

    try {
      // 1. 检索专属知识库
      const knowledge = await this.memoryManager.retrieve(context.task, {
        types: ['agent_knowledge'],
        maxResults: this.config.knowledgeBase.retrieval?.maxResults || 5,
        minConfidence: this.config.knowledgeBase.retrieval?.similarityThreshold || 0.5,
      });

      log.debug(`  📚 知识库检索: ${knowledge.length} 条结果`);

      // 2. 构建系统提示词
      const systemPrompt = await this.buildSystemPrompt(context, knowledge);

      // 3. 创建 AgentLoop（简化版：直接调用 LLM，不使用完整的 ReAct 循环）
      // TODO: 后续集成完整的 AgentLoop
      const messages: import('@/core/types').Message[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: context.task,
        },
      ];

      const stream = this.provider.stream(messages, [], {
        model: this.config.model.primary,
        maxTokens: this.config.cost?.maxTokensPerTask || 4000,
      });

      // 简化处理：收集所有文本
      let result = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          result += event.text;
        }
      }

      log.info(`✅ 任务完成`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`❌ 任务执行失败: ${message}`);

      // 如果配置了重试
      if (this.config.execution.retryOnError) {
        log.info(`🔄 正在重试...`);
        return this.run(context); // 重试一次
      }

      throw error;
    }
  }

  /**
   * 构建专属 Skill Registry
   */
  private async buildSkillRegistry(): Promise<SkillRegistry> {
    const registry = new SkillRegistry();

    // 1. 加载内置 Skills（引用全局 Skill Registry）
    if (this.config.skills.builtin) {
      for (const skillId of this.config.skills.builtin) {
        const skill = this.globalSkillRegistry.get(skillId);
        if (skill) {
          registry.register(skill);
          log.debug(`    ↳ 内置 Skill: ${skillId}`);
        } else {
          log.warn(`    ⚠️  内置 Skill 不存在: ${skillId}`);
        }
      }
    }

    // 2. 加载自定义 Skills
    if (this.config.skills.custom) {
      for (const customSkill of this.config.skills.custom) {
        const skill = this.createSkillFromConfig(customSkill);
        registry.register(skill);
        log.debug(`    ↳ 自定义 Skill: ${customSkill.id}`);
      }
    }

    return registry;
  }

  /**
   * 从配置创建 Skill
   */
  private createSkillFromConfig(customSkill: CustomSkill): Skill {
    return {
      id: customSkill.id,
      name: customSkill.name,
      version: '1.0.0',
      category: customSkill.category,
      description: customSkill.name,
      tags: [],
      priority: customSkill.priority,
      dependencies: customSkill.dependencies,

      // 渲染函数
      render: async (options) => {
        let content = customSkill.content;

        // 处理依赖注入
        if (customSkill.dependencies && options?.params?.dependencies) {
          for (const depId of customSkill.dependencies) {
            const dep = options.params.dependencies[depId];
            if (dep) {
              content = content.replace(`{{${depId}}}`, dep);
            }
          }
        }

        return content;
      },
    };
  }

  /**
   * 构建专属知识库
   */
  private async buildMemoryManager(): Promise<IMemoryStore> {
    const knowledgeDir = path.join(this.agentDir, 'knowledge');
    await fs.mkdir(knowledgeDir, { recursive: true });

    // 创建 Memory Manager（独立数据库，使用 knowledgeDir 作为 projectRoot）
    const memoryManager = new MemoryManager(
      {
        enabled: true,
      },
      knowledgeDir  // projectRoot 参数
    );

    await memoryManager.init();

    // 加载数据源到知识库
    for (const source of this.config.knowledgeBase.sources) {
      await this.loadKnowledgeSource(source, knowledgeDir, memoryManager);
    }

    return memoryManager;
  }

  /**
   * 加载知识源
   */
  private async loadKnowledgeSource(
    source: KnowledgeSource,
    knowledgeDir: string,
    memoryManager: IMemoryStore,
  ): Promise<void> {
    const sourcePath = path.join(knowledgeDir, source.path);

    try {
      // 检查文件是否存在
      const stat = await fs.stat(sourcePath).catch(() => null);
      if (!stat) {
        log.warn(`    ⚠️  知识源文件不存在: ${source.path}`);
        return;
      }

      switch (source.type) {
        case 'csv':
          await this.loadCSV(sourcePath, source, memoryManager);
          break;
        case 'json':
          await this.loadJSON(sourcePath, source, memoryManager);
          break;
        case 'markdown':
          await this.loadMarkdown(sourcePath, source, memoryManager);
          break;
        default:
          log.warn(`    ⚠️  不支持的数据源类型: ${source.type}`);
      }

      log.debug(`    ↳ 知识源加载成功: ${source.path}`);
    } catch (error) {
      log.error(`    ✗ 知识源加载失败: ${source.path}`, error);
    }
  }

  /**
   * 加载 CSV 数据源
   */
  private async loadCSV(
    filePath: string,
    source: KnowledgeSource,
    memoryManager: IMemoryStore,
  ): Promise<void> {
    if (!memoryManager.add) {
      log.warn('MemoryManager does not support add() method, skipping CSV loading');
      return;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const rows = parseCSV(content, { columns: true, skip_empty_lines: true });

    for (const row of rows) {
      const rowObj = row as Record<string, unknown>;
      await memoryManager.add({
        type: 'agent_knowledge',
        content: JSON.stringify(rowObj, null, 2),
        keywords: Object.values(rowObj).filter((v): v is string => typeof v === 'string'),
        metadata: {
          source: source.path,
          sourceType: 'csv',
        },
      });
    }

    log.debug(`      ✓ 加载 ${rows.length} 条 CSV 记录`);
  }

  /**
   * 加载 JSON 数据源
   */
  private async loadJSON(
    filePath: string,
    source: KnowledgeSource,
    memoryManager: IMemoryStore,
  ): Promise<void> {
    if (!memoryManager.add) {
      log.warn('MemoryManager does not support add() method, skipping JSON loading');
      return;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      // 提取关键词：所有字符串类型的值
      const keywords: string[] = [];
      const extractKeywords = (obj: any): void => {
        for (const value of Object.values(obj)) {
          if (typeof value === 'string') {
            keywords.push(value);
          } else if (typeof value === 'object' && value !== null) {
            extractKeywords(value);
          }
        }
      };
      extractKeywords(item);

      await memoryManager.add({
        type: 'agent_knowledge',
        content: JSON.stringify(item, null, 2),
        keywords,
        metadata: {
          source: source.path,
          sourceType: 'json',
        },
      });
    }

    log.debug(`      ✓ 加载 ${items.length} 条 JSON 记录`);
  }

  /**
   * 加载 Markdown 数据源（支持目录递归）
   */
  private async loadMarkdown(
    sourcePath: string,
    source: KnowledgeSource,
    memoryManager: IMemoryStore,
  ): Promise<void> {
    if (!memoryManager.add) {
      log.warn('MemoryManager does not support add() method, skipping Markdown loading');
      return;
    }

    const stat = await fs.stat(sourcePath);

    if (stat.isDirectory()) {
      // 递归加载目录中的所有 .md 文件
      const files = await glob(`${sourcePath}/**/*.md`);
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const relativePath = path.relative(sourcePath, file);

        await memoryManager.add({
          type: 'agent_knowledge',
          content,
          keywords: this.extractMarkdownKeywords(content),
          metadata: {
            source: relativePath,
            sourceType: 'markdown',
          },
        });
      }

      log.debug(`      ✓ 加载 ${files.length} 个 Markdown 文件`);
    } else {
      // 单个文件
      const content = await fs.readFile(sourcePath, 'utf-8');

      await memoryManager.add({
        type: 'agent_knowledge',
        content,
        keywords: this.extractMarkdownKeywords(content),
        metadata: {
          source: source.path,
          sourceType: 'markdown',
        },
      });

      log.debug(`      ✓ 加载 1 个 Markdown 文件`);
    }
  }

  /**
   * 从 Markdown 提取关键词
   */
  private extractMarkdownKeywords(content: string): string[] {
    // 提取标题（# 开头的行）
    const headings = content.match(/^#{1,6}\s+(.+)$/gm) || [];
    const keywords = headings.map(h => h.replace(/^#{1,6}\s+/, '').trim());

    // 提取代码块中的标识符
    const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
    for (const block of codeBlocks) {
      const identifiers = block.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
      keywords.push(...identifiers.slice(0, 10)); // 限制数量
    }

    return [...new Set(keywords)].slice(0, 50); // 去重并限制总数
  }

  /**
   * 构建专属工具集
   */
  private buildToolRegistry(): IToolRegistry {
    const registry = new ToolRegistry();

    // 复制允许的工具
    for (const toolConfig of this.config.tools) {
      if (toolConfig.enabled === false) continue;

      const tool = this.globalToolRegistry.get(toolConfig.name);
      if (!tool) {
        log.warn(`    ⚠️  工具不存在: ${toolConfig.name}`);
        continue;
      }

      registry.register(tool);

      // TODO: 应用自定义配置（需要工具支持 setConfig 方法）
      if (toolConfig.config && 'setConfig' in tool) {
        (tool as any).setConfig(toolConfig.config);
      }

      log.debug(`    ↳ 工具: ${toolConfig.name}`);
    }

    // 注册专属工具：knowledge_query
    const knowledgeQueryTool = new KnowledgeQueryTool();
    knowledgeQueryTool.setMemoryManager(this.memoryManager);
    registry.register(knowledgeQueryTool);
    log.debug(`    ↳ 专属工具: knowledge_query`);

    return registry;
  }

  /**
   * 构建系统提示词（注入知识和上下文）
   */
  private async buildSystemPrompt(
    context: AgentContext,
    knowledge: any[],
  ): Promise<string> {
    let prompt = this.config.systemPrompt;

    // 1. 注入专属知识
    if (knowledge.length > 0) {
      prompt += `\n\n# 专属知识库检索结果\n\n`;
      prompt += knowledge
        .map((entry, i) => {
          const source = entry.metadata?.source || '未知来源';
          return `## 知识 ${i + 1} (来源: ${source})\n\n${entry.content}`;
        })
        .join('\n\n');
    }

    // 2. 渲染专属 Skills
    const skillIds = this.skillRegistry.list().map(s => s.id);
    if (skillIds.length > 0) {
      const skillsPrompt = await this.skillRegistry.composeBatch(skillIds);
      if (skillsPrompt) {
        prompt += `\n\n${skillsPrompt}`;
      }
    }

    // 3. 注入上下文变量（模板替换）
    prompt = prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return context[key] !== undefined ? String(context[key]) : match;
    });

    // 4. 注入约束条件
    if (context.constraints && context.constraints.length > 0) {
      prompt += `\n\n# 约束条件\n${context.constraints.map(c => `- ${c}`).join('\n')}`;
    }

    // 5. 注入偏好设置
    if (context.preferences && Object.keys(context.preferences).length > 0) {
      prompt += `\n\n# 偏好设置\n\`\`\`json\n${JSON.stringify(context.preferences, null, 2)}\n\`\`\``;
    }

    return prompt;
  }

  /**
   * 解析 Agent 目录路径
   */
  private resolveAgentDirectory(config: ConfigurableAgentConfig): string {
    if (config.metadata?.source === 'project') {
      return path.join(process.cwd(), '.xuanji/agents', config.id);
    } else {
      return path.join(os.homedir(), '.xuanji/agents', config.id);
    }
  }

  /**
   * 获取 Agent 状态
   */
  getState(): {
    id: string;
    name: string;
    skillCount: number;
    toolCount: number;
    knowledgeDir: string;
  } {
    return {
      id: this.id,
      name: this.name,
      skillCount: this.skillRegistry?.list().length || 0,
      toolCount: this.config.tools.length,
      knowledgeDir: path.join(this.agentDir, 'knowledge'),
    };
  }
}
