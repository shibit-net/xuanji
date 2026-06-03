/**
 * ============================================================
 * Skill Gateway Tool - 统一的 Skill 调用入口
 * ============================================================
 * LLM 通过此单一工具调用所有已安装的 Skill。
 * 可用 Skill 列表通过 system prompt 注入。
 *
 * 所有 Skill 统一为 prompt 类型，调用 skillRegistry.render() 返回渲染内容。
 */

import type { ToolResult, JSONSchema } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'SkillCallTool' });

export class SkillCallTool extends BaseTool {
  readonly name = 'skill_call';
  readonly description =
    'Invoke an installed Skill by its ID. Use `skill_manage(list)` to discover available Skills and their descriptions first.';
  readonly readonly = false;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'The Skill ID to invoke. Use skill_manage(list) to discover available Skill IDs.',
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
      const content = await this.skillRegistry.render(skillId, { params });

      // 附带 ClawHub 元数据，帮助 LLM 了解 Skill 的能力边界
      const metadata: Record<string, unknown> = { skillId, category: 'prompt' };
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        metadata.allowedTools = skill.allowedTools;
      }
      if (skill.clawhubMetadata) {
        const domains = extractClawhubDomains(skill.clawhubMetadata);
        if (domains.length > 0) {
          metadata.domains = domains;
        }
      }

      return this.success(content, metadata);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Skill "${skillId}" execution failed:`, err);
      return this.error(`Skill 执行失败: ${message}`, { skillId });
    }
  }
}

/** 从 clawhubMetadata 中提取领域关键词 */
function extractClawhubDomains(metadata: Record<string, unknown>): string[] {
  const domains: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && value.length > 0 && value.length < 100) {
      domains.push(value);
    } else if (key && key !== 'tags' && key !== 'version') {
      domains.push(key);
    }
  }
  return [...new Set(domains)].slice(0, 10);
}
