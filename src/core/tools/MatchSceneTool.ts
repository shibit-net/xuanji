/**
 * MatchSceneTool — 语义场景匹配
 *
 * 让主 Agent 通过语义向量匹配找到最合适的场景（scene），
 * 用于 task 或 agent_team 调用中指定子 Agent 的行为模式。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MatchSceneTool' });

interface SceneInfo {
  scene: string;
  description?: string;
  keywords?: string;
}

export class MatchSceneTool extends BaseTool {
  readonly name = 'match_scene';
  readonly description = [
    'Find the best-matching scene(s) for a given task description using semantic vector matching.',
    '',
    'Use this when choosing scenes for a split sub-task or team member, or when scene context is uncertain.',
    'Front-stage intent analysis is for the main agent only; delegated sub-tasks should be matched again. Each task/member may use 1-3 scenes.',
    'Each scene defines a sub-agent behavior mode (e.g., write_code, debug, explore, plan).',
    '',
    'Score guide:',
    '  ≥ 0.5 — Strong match, use the scene ID directly in task({ scene: "..." })',
    '  0.3-0.5 — Moderate match, consider combining with other cues',
    '  < 0.3 — Weak match, use list_scenes to browse all available scenes',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Description of the task you need a scene for',
      },
      top_k: {
        type: 'number',
        description: 'Number of scenes to return (default: 3, max: 10). Pick 1-3 scenes for a delegated sub-task/member.',
      },
    },
    required: ['task_description'],
  };

  readonly readonly = true;

  private embedder: EmbeddingProviderInterface | null = null;
  private sceneList: SceneInfo[] = [];

  setEmbedder(embedder: EmbeddingProviderInterface | null): void {
    this.embedder = embedder;
  }

  setSceneList(scenes: SceneInfo[]): void {
    this.sceneList = scenes;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const taskDescription = input.task_description as string;
    const topK = Math.min((input.top_k as number) || 5, 10);

    if (!taskDescription || taskDescription.trim() === '') {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数 task_description',
        reason: 'match_scene 需要任务描述来匹配合适的场景。',
        solutions: ['提供详细的任务描述'],
        example: 'match_scene({ task_description: "分析并修复登录模块的性能瓶颈" })',
      });
    }

    if (!this.embedder) {
      return this.formatError({
        type: '资源错误',
        message: '向量模型未安装，无法进行语义匹配',
        reason: 'match_scene 依赖本地 embedding 模型进行语义匹配。',
        solutions: [
          '使用 list_scenes 查看所有可用场景，手动选择合适的 scene ID',
          '等待向量模型下载完成后重试',
        ],
      });
    }

    if (this.sceneList.length === 0) {
      return this.success('当前没有可用的场景。请使用 list_scenes 查看所有场景。');
    }

    // 向量匹配
    const messageVec = await this.safeEmbed(taskDescription.trim());
    if (!messageVec) {
      return this.error('向量化失败，无法进行场景匹配');
    }

    const sceneTexts = this.sceneList.map((s) =>
      [s.keywords || '', s.description || ''].join(' '),
    );
    const sceneVecs = await Promise.all(sceneTexts.map((t) => this.safeEmbed(t)));

    const scored: Array<{ scene: string; score: number; description?: string }> = [];
    this.sceneList.forEach((s, i) => {
      const vec = sceneVecs[i];
      if (!vec) return;
      const sim = this.embedder!.cosineSimilarity(messageVec, vec);
      if (sim > 0.2) {
        scored.push({ scene: s.scene, score: sim, description: s.description });
      }
    });

    scored.sort((a, b) => b.score - a.score);
    const matches = scored.slice(0, topK);

    if (matches.length === 0) {
      return this.success(
        `Task: "${taskDescription}"\n\n❌ 未找到匹配的场景。建议使用 list_scenes 查看所有可用场景。`
      );
    }

    const lines: string[] = [
      `Task: "${taskDescription}"`,
      '',
      `Top ${matches.length} scene(s) (vector similarity):`,
      '',
    ];

    matches.forEach((match, idx) => {
      const pct = (match.score * 100).toFixed(0);
      const stars = match.score >= 0.5 ? '★★★' : match.score >= 0.35 ? '★★' : '★';
      lines.push(`${idx + 1}. **${match.scene}** — ${stars} ${pct}%`);
      if (match.description) {
        lines.push(`   ${match.description}`);
      }
      lines.push('');
    });

    const best = matches[0];
    if (best.score >= 0.5) {
      lines.push(`💡 推荐使用场景 "${best.scene}"，在 task 中传入 scene: "${best.scene}"。`);
    } else {
      lines.push('💡 最高分低于 0.5，建议使用 list_scenes 浏览所有可用场景。');
    }

    return this.success(lines.join('\n'));
  }

  private async safeEmbed(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      return await this.embedder.embed(text);
    } catch (err) {
      log.warn(`Embedding failed: ${(err as Error).message}`);
      return null;
    }
  }
}
