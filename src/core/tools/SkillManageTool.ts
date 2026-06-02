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
    'Manage installed Skills. Supports the following operations:',
    '',
    '- **list** — List all Skills (filterable by source/category)',
    '- **status** — View detailed info for a specific Skill',
    '- **enable** — Enable a specific Skill',
    '- **disable** — Disable a specific Skill',
    '- **publish** — Publish a learned Skill draft to the marketplace',
    '',
    'Call this tool when the user says "list Skills", "what skills are available", "enable/disable XXX skill", "publish XXX to marketplace".',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'status', 'enable', 'disable', 'publish'],
        description: 'Operation type',
      },
      skillId: {
        type: 'string',
        description: 'Skill ID (required when action=status/enable/disable/publish)',
      },
      filter: {
        type: 'object',
        description: 'Filter criteria (optional, for action=list)',
        properties: {
          source: {
            type: 'string',
            enum: ['builtin', 'custom', 'learned', 'marketplace'],
            description: 'Filter by source',
          },
          category: {
            type: 'string',
            enum: ['prompt', 'action', 'workflow'],
            description: 'Filter by category',
          },
          search: {
            type: 'string',
            description: 'Search keyword (matches name and description)',
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
      return this.error('SkillRegistry not initialized');
    }

    switch (action) {
      case 'list': return this.listSkills(filter);
      case 'status': return this.skillStatus(skillId);
      case 'enable': return this.toggleSkill(skillId!, true);
      case 'disable': return this.toggleSkill(skillId!, false);
      case 'publish': return this.publishSkill(skillId!);
      default: return this.error(`Unknown action: ${action}`);
    }
  }

  private async listSkills(filter?: Record<string, string>): Promise<ToolResult> {
    try {
      // 确保已扫描 marketplace 安装的 skill
      if (typeof this.skillRegistry.scanInstalled === 'function') {
        await this.skillRegistry.scanInstalled();
      }
      let skills = this.skillRegistry.list?.() || [];

      // Filter
      if (filter?.source) {
        skills = skills.filter((s: any) => s.source === filter.source);
      }
      if (filter?.category) {
        skills = skills.filter((s: any) => s.category === filter.category);
      }
      if (filter?.search) {
        const kw = filter.search.toLowerCase();
        skills = skills.filter((s: any) => {
          const searchable = [
            s.id,
            s.name,
            s.description,
            s.category,
            s.source,
            s.slashCommand,
            ...(Array.isArray(s.tags) ? s.tags : []),
            ...(Array.isArray(s.requiredTools) ? s.requiredTools : []),
            ...(Array.isArray(s.allowedTools) ? s.allowedTools : []),
            s.intentMeta?.description,
            s.intentMeta?.category,
            ...(Array.isArray(s.intentMeta?.keywords) ? s.intentMeta.keywords : []),
            typeof s.content === 'string'
              ? s.content.split('\n').filter((line: string) => /^#{1,3}\s+/.test(line)).slice(0, 5).join(' ')
              : undefined,
          ];
          return searchable.some((value) => String(value || '').toLowerCase().includes(kw));
        });
      }

      if (skills.length === 0) {
        return this.success('No matching Skills found.');
      }

      const lines: string[] = [`## Skills (${skills.length})`, ''];
      for (const s of skills) {
        const status = s.enabled !== false ? 'enabled' : 'disabled';
        const tags = Array.isArray(s.tags) && s.tags.length ? s.tags.join(', ') : '-';
        const requiredTools = Array.isArray(s.requiredTools) && s.requiredTools.length ? s.requiredTools.join(', ') : '-';
        const allowedTools = Array.isArray(s.allowedTools) && s.allowedTools.length ? s.allowedTools.join(', ') : '-';
        const slashCommand = s.slashCommand || '-';
        const description = s.description || '-';
        lines.push(`### ${s.name || s.id}`);
        lines.push(`- **id**: \`${s.id}\``);
        lines.push(`- **description**: ${description}`);
        lines.push(`- **source/category/status**: ${s.source || '?'} / ${s.category || '?'} / ${status}`);
        lines.push(`- **tags**: ${tags}`);
        lines.push(`- **slashCommand**: ${slashCommand}`);
        lines.push(`- **requiredTools**: ${requiredTools}`);
        lines.push(`- **allowedTools**: ${allowedTools}`);
        lines.push('');
      }

      // Stats
      const bySource: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const s of skills) {
        bySource[s.source || 'unknown'] = (bySource[s.source || 'unknown'] || 0) + 1;
        byCategory[s.category || 'unknown'] = (byCategory[s.category || 'unknown'] || 0) + 1;
      }

      lines.push('', '### Stats');
      lines.push('**By source**: ' + Object.entries(bySource).map(([k, v]) => `${k}: ${v}`).join(' | '));
      lines.push('**By category**: ' + Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(' | '));

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`Failed to list Skills: ${err}`);
    }
  }

  private async skillStatus(skillId?: string): Promise<ToolResult> {
    if (!skillId) return this.error('Please specify skillId');

    try {
      const skill = this.skillRegistry.get?.(skillId);
      if (!skill) return this.error(`Skill not found: ${skillId}`);

      const lines = [
        `## ${skill.name}`,
        `- **ID**: \`${skill.id}\``,
        `- **Version**: ${skill.version || '?'}`,
        `- **Category**: ${skill.category || '?'}`,
        `- **Source**: ${skill.source || '?'}`,
        `- **Status**: ${skill.enabled !== false ? 'Enabled' : 'Disabled'}`,
        `- **Description**: ${skill.description || '-'}`,
        `- **Tags**: ${(skill.tags || []).join(', ') || '-'}`,
        `- **Slash command**: ${skill.slashCommand || '-'}`,
        `- **Required tools**: ${skill.requiredTools?.length ? skill.requiredTools.join(', ') : '-'}`,
        `- **Allowed tools**: ${skill.allowedTools?.length ? skill.allowedTools.join(', ') : '-'}`,
      ];

      if (skill.intentMeta) {
        lines.push(`- **Intent**: ${skill.intentMeta.description || '-'}; keywords=${Array.isArray(skill.intentMeta.keywords) ? skill.intentMeta.keywords.join(', ') : '-'}`);
      }
      if (skill.content) {
        const preview = typeof skill.content === 'string'
          ? skill.content.slice(0, 300)
          : JSON.stringify(skill.content).slice(0, 300);
        lines.push('', '### Content preview', '```', preview + (String(skill.content).length > 300 ? '...' : ''), '```');
      }

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`Failed to view Skill details: ${err}`);
    }
  }

  private async toggleSkill(skillId: string, enable: boolean): Promise<ToolResult> {
    if (!skillId) return this.error('Please specify skillId');

    try {
      const skill = this.skillRegistry.get?.(skillId);
      if (!skill) return this.error(`Skill not found: ${skillId}`);

      skill.enabled = enable;
      if (typeof this.skillRegistry.update === 'function') {
        this.skillRegistry.update(skill);
      }
      return this.success(`Skill "${skill.name}" (${skillId}) ${enable ? 'enabled' : 'disabled'}`);
    } catch (err) {
      return this.error(`Failed to ${enable ? 'enable' : 'disable'} Skill: ${err}`);
    }
  }

  private async publishSkill(skillId?: string): Promise<ToolResult> {
    if (!skillId) return this.error('Please specify skillId to publish');
    if (!this.tiangongMarket) {
      return this.error('Marketplace not configured, cannot publish');
    }

    try {
      const skill = this.skillRegistry.get?.(skillId);
      if (!skill) return this.error(`Skill not found: ${skillId}`);

      // Build publish data
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

      // Publish via admin API
      if (typeof (this.tiangongMarket as any).adminPublish === 'function') {
        const result = await (this.tiangongMarket as any).adminPublish(publishData);
        return this.success(`Skill "${skill.name}" published to marketplace!\nPackage ID: ${publishData.packageId}\n${JSON.stringify(result, null, 2)}`);
      }

      return this.error('Marketplace adminPublish method not available');
    } catch (err) {
      return this.error(`Failed to publish Skill: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
