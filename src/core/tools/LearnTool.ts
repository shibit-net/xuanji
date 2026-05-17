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
import { getMemoryManager } from '@/core/memory/globals';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LearnTool' });

export class LearnTool extends BaseTool {
  readonly name = 'learn';
  readonly description = '学习新能力或知识。搜索 Web 文档，提取 API 规格，生成 MCP 服务器和 Skill。当用户说"学一下X"时调用此工具。';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: '学习目标，如 "高德地图 API"、"饿了吗点外卖"、"Spring Boot 3 项目脚手架"',
      },
      depth: {
        type: 'string',
        enum: ['shallow', 'moderate', 'deep'],
        description: '学习深度。shallow=仅搜索, moderate=搜索+提取API+生成MCP, deep=搜索+提取+生成MCP+生成Skill',
        default: 'moderate',
      },
      scene_tag: {
        type: 'string',
        description: '场景标签',
      },
    },
    required: ['goal'],
  };

  override readonly readonly = false;

  private learnEngine: LearnEngine | null = null;

  private getEngine(): LearnEngine {
    if (!this.learnEngine) {
      const memoryManager = getMemoryManager();
      this.learnEngine = new LearnEngine(
        undefined, // cheapLLM — 由调用方注入
        undefined, // webSearchFn
        memoryManager?.skillRegistry,
        memoryManager?.toolRegistry,
        memoryManager?.mcpManager,
        memoryManager,
        undefined, // baseDir
      );
    }
    return this.learnEngine;
  }

  setLearnEngine(engine: LearnEngine): void {
    this.learnEngine = engine;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const goal = input.goal as string;
    const depth = (input.depth as string) ?? 'moderate';
    const sceneTag = input.scene_tag as string | undefined;

    if (!goal || goal.trim().length === 0) {
      return this.error('学习目标不能为空');
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
