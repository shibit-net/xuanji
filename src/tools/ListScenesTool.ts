/**
 * ListScenesTool — 列出可用场景
 *
 * 让主 Agent 查询系统中所有可用的场景（L1层prompt组件），
 * 帮助动态分配场景给子 Agent。
 */

import type { JSONSchema, ToolResult } from '@/infrastructure/core-types';
import type { PromptComponentRegistry } from '@/infrastructure/prompt/PromptComponentRegistry';
import { BaseTool } from './BaseTool';

export class ListScenesTool extends BaseTool {
  readonly name = 'list_scenes';
  readonly description = [
    'List available scenes (behavior modes) for sub-agents.',
    '',
    'Use this when intent analysis or task planning needs available scene IDs for task or agent_team calls.',
    'Each scene defines a sub-agent\'s behavior mode (e.g., write_code focuses on implementation,',
    'test focuses on testing). Pass the scene ID in task or agent_team calls.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        description: 'Optional filters to narrow down the list',
        properties: {
          search: {
            type: 'string',
            description: 'Search keyword in name or description',
          },
        },
      },
    },
  };

  readonly readonly = true; // Read-only operation

  private promptRegistry: PromptComponentRegistry | null = null;

  /**
   * 注入 PromptComponentRegistry 依赖
   */
  setPromptRegistry(registry: PromptComponentRegistry): void {
    this.promptRegistry = registry;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.promptRegistry) {
      return this.error('PromptComponentRegistry not available. This tool requires prompt configuration.');
    }

    const filter = input.filter as {
      search?: string;
    } | undefined;

    // 获取所有组件
    const allComponents = this.promptRegistry.getComponents();

    // 过滤出 L1 层的场景组件
    const sceneComponents = Array.from(allComponents.values()).filter(
      component => component.layer === 'L1' && !component.internal
    );

    if (sceneComponents.length === 0) {
      return this.success('No scenes found in the system.');
    }

    // 关键词搜索
    let filteredScenes = sceneComponents;
    if (filter?.search && typeof filter.search === 'string') {
      const keyword = filter.search.toLowerCase();
      filteredScenes = sceneComponents.filter(scene =>
        scene.id.toLowerCase().includes(keyword) ||
        scene.name.toLowerCase().includes(keyword) ||
        (scene.match?.description && scene.match.description.toLowerCase().includes(keyword)) ||
        (scene.match?.keywords && (
          (typeof scene.match.keywords === 'string' && scene.match.keywords.toLowerCase().includes(keyword)) ||
          (Array.isArray(scene.match.keywords) && scene.match.keywords.some((item: string) => item.toLowerCase().includes(keyword)))
        ))
      );
    }

    if (filteredScenes.length === 0) {
      return this.success('No scenes found matching the criteria.');
    }

    // 格式化输出
    const output = this.formatSceneList(filteredScenes);

    return this.success(output);
  }

  /**
   * 格式化场景列表
   */
  private formatSceneList(scenes: any[]): string {
    const lines: string[] = [
      `Found ${scenes.length} scene(s):`,
      '',
    ];

    scenes.forEach((scene) => {
      lines.push(this.formatSceneInfo(scene));
    });

    return lines.join('\n');
  }

  /**
   * 格式化单个场景信息
   */
  private formatSceneInfo(scene: any): string {
    const lines: string[] = [];

    // 标题行
    lines.push(`### 🎬 Scene: ${scene.name} (${scene.id})`);
    lines.push('');

    // 描述
    if (scene.match?.description) {
      lines.push(`**Description**: ${scene.match.description}`);
      lines.push('');
    }

    // 关键词（自然语言描述，供 LLM 理解场景用途）
    if (scene.match?.keywords) {
      const kw = typeof scene.match.keywords === 'string'
        ? scene.match.keywords
        : scene.match.keywords.source || '';
      if (kw) {
        lines.push(`**Keywords**: ${kw}`);
        lines.push('');
      }
    }

    // Content 摘要（前3行，来自 scene.content）
    if (scene.content) {
      const contentLines = scene.content.trim().split('\n').slice(0, 3);
      lines.push(`**Content Summary**:`);
      contentLines.forEach((line: string) => {
        lines.push(`  ${line}`);
      });
      if (scene.content.trim().split('\n').length > 3) {
        lines.push(`  ...`);
      }
      lines.push('');
    }

    // 优先级和预估 tokens
    lines.push(`**Priority**: ${scene.priority} | **Estimated Tokens**: ${scene.estimatedTokens}`);
    lines.push('');

    lines.push('---');
    lines.push('');

    return lines.join('\n');
  }
}

