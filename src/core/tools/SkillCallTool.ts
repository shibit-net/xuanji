/**
 * ============================================================
 * Skill Gateway Tool - 统一的 Skill 调用入口
 * ============================================================
 * LLM 通过此单一工具调用所有已安装的 Skill。
 * 可用 Skill 列表通过 system prompt 注入。
 *
 * 支持三种 Skill 类型：
 * - workflow: 调用 skillRegistry.executeWorkflow()
 * - prompt:   调用 skillRegistry.render()，返回渲染后的提示词内容
 * - action:   调用 skill.execute()，执行具体操作
 */

import type { ToolResult, JSONSchema } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillCallTool' });

export class SkillCallTool extends BaseTool {
  readonly name = 'skill_call';
  readonly description =
    'Invoke an installed Skill. Available skills are listed in the system prompt under "Skills". ' +
    'Use this for workflows (e.g., commit, review), prompt rendering, and action execution.';
  readonly readonly = false;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'The Skill ID to invoke (listed in the system prompt under "Skills")',
      },
      params: {
        type: 'object',
        description: 'Optional parameters to pass to the skill',
      },
    },
    required: ['skillId'],
  };

  private skillRegistry: any = null;

  setDependencies(deps: { skillRegistry: any }): void {
    this.skillRegistry = deps.skillRegistry;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.skillRegistry) {
      return this.error('SkillRegistry 未初始化，无法调用 Skill');
    }

    const skillId = input.skillId as string;
    if (!skillId) {
      return this.error('缺少必需参数 "skillId"。请查看 system prompt 中 "Skills" 段获取可用 Skill 列表。');
    }

    const skill = this.skillRegistry.get?.(skillId);
    if (!skill) {
      return this.error(
        `未找到 Skill "${skillId}"。使用 skill_manage(list) 查看已安装的 Skill 列表。`,
      );
    }

    if (skill.enabled === false) {
      return this.error(
        `Skill "${skill.name}" (${skillId}) 已被禁用。使用 skill_manage(enable, "${skillId}") 启用它。`,
      );
    }

    const params = (input.params ?? {}) as Record<string, any>;

    try {
      switch (skill.category) {
        case 'workflow': {
          const result = await this.skillRegistry.executeWorkflow(skillId, params);
          if (result.success) {
            return this.success(result.output || 'Workflow completed', result.metadata);
          }
          return this.error(result.error || 'Workflow failed');
        }

        case 'prompt': {
          const content = await this.skillRegistry.render(skillId, { params });
          return this.success(content, { skillId, category: 'prompt' });
        }

        case 'action': {
          if (typeof skill.execute === 'function') {
            const result = await skill.execute(params);
            const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return this.success(output, { skillId, category: 'action' });
          }
          return this.error(
            `Skill "${skill.name}" (${skillId}) 是 action 类型但没有 execute 方法。`,
          );
        }

        default:
          return this.error(`不支持的 Skill 类型: ${skill.category}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Skill "${skillId}" execution failed:`, err);
      return this.error(`Skill 执行失败: ${message}`, { skillId });
    }
  }
}
