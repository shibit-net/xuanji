/**
 * ListScenesTool — 列出可用场景
 *
 * 让主 Agent 查询系统中所有可用的场景（L1层prompt组件），
 * 帮助动态分配场景给子 Agent。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import type { PromptComponentRegistry } from '@/core/prompt/PromptComponentRegistry';
import { BaseTool } from './BaseTool';

export class ListScenesTool extends BaseTool {
  readonly name = 'list_scenes';
  readonly description = [
    'List all available scenes (L1 layer prompt components) in the system.',
    '',
    'Use this tool when you need to:',
    '✓ Discover what scenes are available for task guidance',
    '✓ Match scenes to agent capabilities',
    '✓ Understand scene purposes and requirements',
    '',
    'Returns scene information including:',
    '- Scene ID (use in task or agent_team tools)',
    '- Name and description',
    '- Keywords for matching',
    '- Collaboration hints (for complex tasks)',
    '- Content summary',
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
            description: 'Search keyword in name, description, or keywords',
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
      component => component.layer === 'L1'
    );

    if (sceneComponents.length === 0) {
      return this.success('No scenes found in the system.');
    }

    // 关键词搜索
    let filteredScenes = sceneComponents;
    if (filter?.search) {
      const keyword = filter.search.toLowerCase();
      filteredScenes = sceneComponents.filter(scene =>
        scene.id.toLowerCase().includes(keyword) ||
        scene.name.toLowerCase().includes(keyword) ||
        scene.match?.description.toLowerCase().includes(keyword) ||
        scene.match?.keywords.source.toLowerCase().includes(keyword)
      );
    }

    if (filteredScenes.length === 0) {
      return this.success('No scenes found matching the criteria.');
    }

    // 获取完整配置（包含 collaborationHint）
    const scenesWithConfig = await Promise.all(
      filteredScenes.map(async scene => {
        const config = await this.promptRegistry!.getComponentConfig(scene.id);
        return { scene, config };
      })
    );

    // 格式化输出
    const output = this.formatSceneList(scenesWithConfig);

    return this.success(output);
  }

  /**
   * 格式化场景列表
   */
  private formatSceneList(scenesWithConfig: Array<{ scene: any; config: any }>): string {
    const lines: string[] = [
      `Found ${scenesWithConfig.length} scene(s):`,
      '',
    ];

    scenesWithConfig.forEach(({ scene, config }) => {
      lines.push(this.formatSceneInfo(scene, config));
    });

    return lines.join('\n');
  }

  /**
   * 格式化单个场景信息
   */
  private formatSceneInfo(scene: any, config: any): string {
    const lines: string[] = [];

    // 标题行
    lines.push(`### 🎬 Scene: ${scene.name} (${scene.id})`);
    lines.push('');

    // 描述
    if (scene.match?.description) {
      lines.push(`**Description**: ${scene.match.description}`);
      lines.push('');
    }

    // 适用任务
    if (config?.suitableFor && config.suitableFor.length > 0) {
      lines.push(`**Suitable For**:`);
      config.suitableFor.forEach((task: string) => {
        lines.push(`  - ${task}`);
      });
      lines.push('');
    }

    // 需要的能力
    if (config?.requiredCapabilities && config.requiredCapabilities.length > 0) {
      lines.push(`**Required Capabilities**:`);
      config.requiredCapabilities.forEach((cap: string) => {
        lines.push(`  - ${cap}`);
      });
      lines.push('');
    }

    // 关键词
    if (scene.match?.keywords) {
      lines.push(`**Keywords**: ${scene.match.keywords.source}`);
      lines.push('');
    }

    // 协作提示（如果有）
    if (config?.collaborationHint) {
      lines.push(`**Collaboration Hint**:`);
      const hintLines = config.collaborationHint.trim().split('\n');
      hintLines.forEach((line: string) => {
        lines.push(`  ${line}`);
      });
      lines.push('');
    }

    // Content 摘要（前3行）
    if (config?.content) {
      const contentLines = config.content.trim().split('\n').slice(0, 3);
      lines.push(`**Content Summary**:`);
      contentLines.forEach((line: string) => {
        lines.push(`  ${line}`);
      });
      if (config.content.split('\n').length > 3) {
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

