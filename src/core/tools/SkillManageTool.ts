/**
 * SkillManageTool — Skill 管理工具
 *
 * Agent 通过此工具管理已安装的 Skills：
 *  - 列出所有 Skill（内置/自定义/学习/市场安装）
 *  - 启用/禁用 Skill
 *  - 查看 Skill 详情
 *  - 发布学习得到的 Skill 到天工坊
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillManageTool' });

export class SkillManageTool extends BaseTool {
  readonly name = 'skill_manage';
  readonly description = [
    '管理已安装的 Skills。支持以下操作：',
    '',
    '- **list** — 列出所有 Skill（可按来源/分类过滤）',
    '- **status** — 查看指定 Skill 的详细信息',
    '- **enable** — 启用指定 Skill',
    '- **disable** — 禁用指定 Skill',
    '- **publish** — 将学习得到的 Skill 草稿发布到天工坊市场',
    '',
    '当用户说"列出 Skills"、"看看有哪些技能"、"启用/禁用 XXX skill"、"把 XXX 发布到天工坊"时调用此工具。',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'status', 'enable', 'disable', 'publish'],
        description: '操作类型',
      },
      skillId: {
        type: 'string',
        description: 'Skill ID（action=status/enable/disable/publish 时必填）',
      },
      filter: {
        type: 'object',
        description: '过滤条件（action=list 时可选）',
        properties: {
          source: {
            type: 'string',
            enum: ['builtin', 'custom', 'learned', 'marketplace'],
            description: '按来源过滤',
          },
          category: {
            type: 'string',
            enum: ['prompt', 'action', 'workflow'],
            description: '按分类过滤',
          },
          search: {
            type: 'string',
            description: '搜索关键词（匹配名称和描述）',
          },
        },
      },
    },
    required: ['action'],
  };

  private skillRegistry: any;
  private tiangongMarket: any;

  setDependencies(deps: { skillRegistry: any; tiangongMarket?: any }): void {
    this.skillRegistry = deps.skillRegistry;
    this.tiangongMarket = deps.tiangongMarket;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const skillId = input.skillId as string | undefined;
    const filter = input.filter as Record<string, string> | undefined;

    if (!this.skillRegistry) {
      return this.error('SkillRegistry 未初始化');
    }

    switch (action) {
      case 'list': return this.listSkills(filter);
      case 'status': return this.skillStatus(skillId);
      case 'enable': return this.toggleSkill(skillId!, true);
      case 'disable': return this.toggleSkill(skillId!, false);
      case 'publish': return this.publishSkill(skillId!);
      default: return this.error(`未知操作: ${action}`);
    }
  }

  private async listSkills(filter?: Record<string, string>): Promise<ToolResult> {
    try {
      let skills = this.skillRegistry.list?.() || [];

      // 过滤
      if (filter?.source) {
        skills = skills.filter((s: any) => s.source === filter.source);
      }
      if (filter?.category) {
        skills = skills.filter((s: any) => s.category === filter.category);
      }
      if (filter?.search) {
        const kw = filter.search.toLowerCase();
        skills = skills.filter((s: any) =>
          s.name?.toLowerCase().includes(kw) ||
          s.description?.toLowerCase().includes(kw),
        );
      }

      if (skills.length === 0) {
        return this.success('当前没有匹配的 Skill。');
      }

      const lines: string[] = [`## Skills (${skills.length})`, ''];
      for (const s of skills) {
        const sourceIcons: Record<string, string> = {
          builtin: '🏗️', custom: '✏️', learned: '🧠', marketplace: '📦',
        };
        const sourceIcon = sourceIcons[s.source] || '❓';
        const status = s.enabled !== false ? '✅' : '⏸️';
        lines.push(`${sourceIcon} **${s.name}** \`${s.id}\` ${status} | ${s.category || '?'} | ${s.version || '?'}`);
      }

      // 统计
      const bySource: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const s of skills) {
        bySource[s.source || 'unknown'] = (bySource[s.source || 'unknown'] || 0) + 1;
        byCategory[s.category || 'unknown'] = (byCategory[s.category || 'unknown'] || 0) + 1;
      }

      lines.push('', '### 统计');
      lines.push('**按来源**: ' + Object.entries(bySource).map(([k, v]) => `${k}: ${v}`).join(' | '));
      lines.push('**按分类**: ' + Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(' | '));

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`列出 Skill 失败: ${err}`);
    }
  }

  private async skillStatus(skillId?: string): Promise<ToolResult> {
    if (!skillId) return this.error('请指定 skillId');

    try {
      const skill = this.skillRegistry.get?.(skillId);
      if (!skill) return this.error(`未找到 Skill: ${skillId}`);

      const lines = [
        `## ${skill.name}`,
        `- **ID**: \`${skill.id}\``,
        `- **版本**: ${skill.version || '?'}`,
        `- **分类**: ${skill.category || '?'}`,
        `- **来源**: ${skill.source || '?'}`,
        `- **状态**: ${skill.enabled !== false ? '✅ 启用' : '⏸️ 禁用'}`,
        `- **描述**: ${skill.description || '-'}`,
        `- **标签**: ${(skill.tags || []).join(', ') || '-'}`,
      ];

      if (skill.requiredTools?.length) {
        lines.push(`- **依赖工具**: ${skill.requiredTools.join(', ')}`);
      }
      if (skill.content) {
        const preview = typeof skill.content === 'string'
          ? skill.content.slice(0, 300)
          : JSON.stringify(skill.content).slice(0, 300);
        lines.push('', '### 内容预览', '```', preview + (String(skill.content).length > 300 ? '...' : ''), '```');
      }

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`查看 Skill 详情失败: ${err}`);
    }
  }

  private async toggleSkill(skillId: string, enable: boolean): Promise<ToolResult> {
    if (!skillId) return this.error('请指定 skillId');

    try {
      const skill = this.skillRegistry.get?.(skillId);
      if (!skill) return this.error(`未找到 Skill: ${skillId}`);

      skill.enabled = enable;
      if (typeof this.skillRegistry.update === 'function') {
        this.skillRegistry.update(skill);
      }
      return this.success(`Skill "${skill.name}" (${skillId}) 已${enable ? '启用' : '禁用'}`);
    } catch (err) {
      return this.error(`${enable ? '启用' : '禁用'} Skill 失败: ${err}`);
    }
  }

  private async publishSkill(skillId?: string): Promise<ToolResult> {
    if (!skillId) return this.error('请指定要发布的 skillId');
    if (!this.tiangongMarket) {
      return this.error('天工坊市场未配置，无法发布');
    }

    try {
      const skill = this.skillRegistry.get?.(skillId);
      if (!skill) return this.error(`未找到 Skill: ${skillId}`);

      // 构建发布数据
      const publishData = {
        name: skill.name,
        packageId: `skill-${skill.id}`,
        type: 2, // Skill
        description: skill.description || '',
        version: skill.version || '0.1.0',
        categoryId: 8, // AI Skills
        tags: skill.tags || ['learned'],
        repositoryUrl: 'https://github.com/shibit/skills',
        license: 'MIT',
        transport: 'stdio',
        pricingType: 0,
        pricingModel: 0,
        isPrivate: false,
        configTemplate: JSON.stringify({
          name: skill.id,
          type: 'prompt',
          command: 'npx',
          args: ['-y', 'skill-prompt'],
        }),
        packageType: skill.category || 'prompt',
      };

      // 通过 admin API 发布
      if (typeof (this.tiangongMarket as any).adminPublish === 'function') {
        const result = await (this.tiangongMarket as any).adminPublish(publishData);
        return this.success(`Skill "${skill.name}" 已发布到天工坊！\nPackage ID: ${publishData.packageId}\n${JSON.stringify(result, null, 2)}`);
      }

      return this.error('天工坊 adminPublish 方法不可用');
    } catch (err) {
      return this.error(`发布 Skill 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
