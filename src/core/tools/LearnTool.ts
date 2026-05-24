/**
 * LearnTool — 学习工具
 *
 * Agent 调此工具让 xuanji 自主学习新能力。
 * 包装 LearnEngine，提供 Agent 接口。
 * 设计文档：docs/memory-system-part-8-self-learning.md §6
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { LearnEngine } from '@/core/learn/LearnEngine';
import { ExperienceCrystallizer, type ConversationSnapshot, type SkillDraft } from '@/core/learn/ExperienceCrystallizer';
import { getMemoryManager } from '@/core/memory/globals';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TiangongMarket } from '@/mcp';

const log = logger.child({ module: 'LearnTool' });

export class LearnTool extends BaseTool {
  readonly name = 'learn';
  readonly description = [
    'Learn new capabilities or knowledge. Supports two modes:',
    '',
    '1. **Active Learning** (default) — Search web docs, extract API specs, generate MCP server and Skill.',
    '   Call this when user says \"learn about X\". Set goal and depth parameters.',
    '',
    '2. **Experience Crystallization** (trigger: conversation) — Extract reusable experience from the completed conversation,',
    '   Generate a Skill draft. Call when user says \"learn from that conversation\" or \"summarize the experience\".',
    '   Pass trigger: \"conversation\" and context (conversation summary).',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Learning goal (active learning mode), e.g., understanding a new API, building a project scaffold, or researching a topic',
      },
      depth: {
        type: 'string',
        enum: ['shallow', 'moderate', 'deep'],
        description: 'Learning depth. shallow=search only, moderate=search+extract API+generate MCP, deep=search+extract+generate MCP+generate Skill',
        default: 'moderate',
      },
      trigger: {
        type: 'string',
        enum: ['goal', 'conversation'],
        description: 'Trigger mode. goal=active learning (requires goal param), conversation=extract experience from conversation (requires context param)',
        default: 'goal',
      },
      context: {
        type: 'object',
        description: 'Conversation context (required when trigger=conversation). Contains userMessage, outcomeSummary, toolsUsed, errors',
        properties: {
          userMessage: { type: 'string', description: 'Original user message' },
          outcomeSummary: { type: 'string', description: 'Conversation outcome summary' },
          toolsUsed: { type: 'array', items: { type: 'string' }, description: 'List of tools used' },
          errors: { type: 'array', items: { type: 'string' }, description: 'Errors encountered' },
        },
      },
      scene_tag: {
        type: 'string',
        description: 'Scene tag',
      },
    },
  };

  override readonly readonly = false;

  private learnEngine: LearnEngine | null = null;
  private crystallizer: ExperienceCrystallizer | null = null;
  private _cheapLLM: any;
  private _webSearchFn: ((query: string) => Promise<string[]>) | undefined;
  private _baseDir: string | undefined;

  /** 注入 LearnEngine 所需的全部依赖（由 SessionFactory 调用） */
  setDependencies(deps: {
    cheapLLM: any;
    webSearchFn?: (query: string) => Promise<string[]>;
    baseDir?: string;
  }): void {
    this._cheapLLM = deps.cheapLLM;
    this._webSearchFn = deps.webSearchFn;
    this._baseDir = deps.baseDir;
    // 同步创建 ExperienceCrystallizer
    if (this._cheapLLM && this._baseDir) {
      this.crystallizer = new ExperienceCrystallizer(this._cheapLLM, this._baseDir);
    }
  }

  private getEngine(): LearnEngine {
    if (!this.learnEngine) {
      const memoryManager = getMemoryManager();
      this.learnEngine = new LearnEngine(
        this._cheapLLM,
        this._webSearchFn,
        memoryManager?.skillRegistry,
        memoryManager?.toolRegistry,
        memoryManager?.mcpManager,
        memoryManager,
        this._baseDir,
      );
    }
    return this.learnEngine;
  }

  setLearnEngine(engine: LearnEngine): void {
    this.learnEngine = engine;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const trigger = (input.trigger as string) ?? 'goal';
    const goal = input.goal as string;
    const depth = (input.depth as string) ?? 'moderate';
    const sceneTag = input.scene_tag as string | undefined;
    const context = input.context as ConversationSnapshot | undefined;

    // ── 经验结晶模式 ──
    if (trigger === 'conversation') {
      if (!context?.userMessage) {
        return this.error('经验结晶模式需要 context.userMessage');
      }
      if (!this.crystallizer) {
        return this.error('ExperienceCrystallizer 未初始化（缺少 cheapLLM 或 baseDir）');
      }

      const snapshot: ConversationSnapshot = {
        sessionId: context.sessionId || `conv-${Date.now()}`,
        userMessage: context.userMessage,
        outcomeSummary: context.outcomeSummary || '',
        toolsUsed: Array.isArray(context.toolsUsed) ? context.toolsUsed : [],
        errors: Array.isArray(context.errors) ? context.errors : [],
        timestamp: Date.now(),
      };

      eventBus.emitSync(XuanjiEvent.MEMORY_LEARNING_PROGRESS, {
        goal: `[经验结晶] ${snapshot.userMessage.slice(0, 50)}`,
        stage: 'started',
        depth: 'deep',
      });

      try {
        // 强制提炼（不依赖缓冲区）
        const drafts = await this.crystallizer.forceCrystallize();
        // 先吞入快照再提炼一次
        await this.crystallizer.ingest(snapshot);
        const drafts2 = await this.crystallizer.forceCrystallize();
        const allDrafts = [...drafts, ...drafts2];

        eventBus.emitSync(XuanjiEvent.MEMORY_LEARNING_PROGRESS, {
          goal: `[经验结晶] ${snapshot.userMessage.slice(0, 50)}`,
          stage: 'completed',
          result: { draftCount: allDrafts.length },
        });

        const parts: string[] = [`## 经验结晶完成`];
        if (allDrafts.length > 0) {
          parts.push(`\n从对话中提炼了 ${allDrafts.length} 个 Skill 草稿：`);
          for (const d of allDrafts) {
            parts.push(`- **${d.name}** [${d.status}] — ${d.description}`);
          }
          parts.push(`\n草稿已保存到 learned/drafts/，默认禁用。使用 \`skill enable <id>\` 启用。`);
        } else {
          parts.push('\n当前对话中暂未发现足够形成 Skill 的重复模式。');
          parts.push('继续积累经验后重试。');
        }

        return this.success(parts.join('\n'), { drafts: allDrafts.map(d => d.id) });
      } catch (err) {
        eventBus.emitSync(XuanjiEvent.MEMORY_LEARNING_PROGRESS, {
          goal: `[经验结晶] ${snapshot.userMessage.slice(0, 50)}`,
          stage: 'error',
          error: String(err),
        });
        return this.error(`经验结晶失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── 主动学习模式 ──
    if (!goal || goal.trim().length === 0) {
      return this.error('主动学习模式需要 goal 参数');
    }

    // 发送学习进度事件
    eventBus.emitSync(XuanjiEvent.MEMORY_LEARNING_PROGRESS, {
      goal,
      stage: 'started',
      depth,
    });

    try {
      const engine = this.getEngine();
      const result = await engine.execute(goal, depth as 'shallow' | 'moderate' | 'deep');

      eventBus.emitSync(XuanjiEvent.MEMORY_LEARNING_PROGRESS, {
        goal,
        stage: 'completed',
        result,
      });

      // 记录为叙事记忆
      const memoryManager = getMemoryManager();
      if (memoryManager?.episodicMemory) {
        try {
          const narrative = result.success
            ? `成功学习「${goal}」。${result.apiSpec ? `发现 API: ${result.apiSpec.name} (${result.apiSpec.endpoints.length} 个端点)。` : ''}${result.skillGenerated ? `已生成 Skill: ${result.skillId}。` : ''}`
            : `学习「${goal}」遇到问题: ${result.errors.join(', ')}`;
          await memoryManager.episodicMemory.createFromLearning({
            title: `学习记录: ${goal.slice(0, 50)}`,
            narrative,
            participants: result.apiSpec?.endpoints.map((e: any) => e.path) || [],
            scene_tag: sceneTag || '学习',
            importance: result.success ? 3 : 4,
          });
        } catch { /* 非关键路径 */ }
      }

      const parts: string[] = [`## 学习完成: ${goal}`];

      if (result.searchResults.length > 0) {
        parts.push('\n### 搜索结果');
        for (const r of result.searchResults.slice(0, 5)) {
          parts.push(`- ${r}`);
        }
      }

      if (result.apiSpec) {
        parts.push(`\n### API: ${result.apiSpec.name}`);
        parts.push(`- 基础 URL: ${result.apiSpec.baseUrl}`);
        parts.push(`- 端点: ${result.apiSpec.endpoints.length} 个`);
        for (const ep of result.apiSpec.endpoints.slice(0, 10)) {
          parts.push(`  - ${ep.method} ${ep.path}: ${ep.description}`);
        }
      }

      if (result.mcpGenerated) {
        parts.push('\n✅ MCP 服务器已生成并注册');
      }

      if (result.skillGenerated && result.skillId) {
        parts.push(`\n✅ Skill 已生成: ${result.skillId}`);
      }

      if (result.errors.length > 0) {
        parts.push(`\n⚠️ 遇到 ${result.errors.length} 个问题`);
      }

      parts.push(`\n⏱ 耗时: ${(result.duration / 1000).toFixed(1)}s`);

      return this.success(parts.join('\n'), {
        goal,
        depth,
        success: result.success,
        skillId: result.skillId,
        duration: result.duration,
      });
    } catch (err) {
      eventBus.emitSync(XuanjiEvent.MEMORY_LEARNING_PROGRESS, {
        goal,
        stage: 'error',
        error: String(err),
      });
      return this.error(`学习失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
