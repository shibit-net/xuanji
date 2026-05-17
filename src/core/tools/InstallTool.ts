/**
 * InstallTool — 外部插件安装工具
 *
 * 搜索外部 MCP 服务器 / Skill 并安装。
 * 设计文档：docs/plugin-system.md
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/core/memory/globals';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'InstallTool' });

export interface McpCandidate {
  name: string;
  description: string;
  installCommand: string;
  confidence: number;
}

export interface SkillCandidate {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface PluginSearchService {
  searchMcp(query: string): Promise<McpCandidate[]>;
  searchSkill(query: string): Promise<SkillCandidate[]>;
  getMcpDetail(id: string): Promise<McpCandidate | null>;
  getSkillDetail(id: string): Promise<SkillCandidate | null>;
}

export class InstallTool extends BaseTool {
  readonly name = 'install';
  readonly description = '搜索并安装外部插件（MCP 服务器或 Skill）。当缺少工具时调用此工具。例如：install({ goal: "PostgreSQL 数据库" }) 会搜索并安装 PostgreSQL MCP 服务器。';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: '要安装的插件描述，如 "PostgreSQL"、"playwright 浏览器自动化"、"review PR"',
      },
      type: {
        type: 'string',
        enum: ['mcp', 'skill', 'auto'],
        description: '插件类型。mcp=MCP服务器, skill=技能, auto=自动检测',
        default: 'auto',
      },
      source: {
        type: 'string',
        enum: ['npm', 'github', 'marketplace', 'auto'],
        description: '搜索来源。npm=npm registry, github=GitHub, marketplace=插件市场, auto=自动',
        default: 'auto',
      },
    },
    required: ['goal'],
  };

  override readonly readonly = false;

  private searchService: PluginSearchService | null = null;

  setSearchService(service: PluginSearchService): void {
    this.searchService = service;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const goal = input.goal as string;
    const pluginType = (input.type as string) ?? 'auto';

    if (!goal || goal.trim().length === 0) {
      return this.error('安装目标不能为空');
    }

    const manager = getMemoryManager();

    try {
      // Step 1: 搜索
      let mcpCandidates: McpCandidate[] = [];
      let skillCandidates: SkillCandidate[] = [];

      if (this.searchService) {
        if (pluginType === 'mcp' || pluginType === 'auto') {
          mcpCandidates = await this.searchService.searchMcp(goal);
        }
        if (pluginType === 'skill' || pluginType === 'auto') {
          skillCandidates = await this.searchService.searchSkill(goal);
        }
      }

      if (mcpCandidates.length === 0 && skillCandidates.length === 0) {
        return this.success(`未找到与 "${goal}" 匹配的插件。请尝试更具体的关键词。`, { found: 0 });
      }

      const parts: string[] = [`## 安装结果: ${goal}`];

      // Step 2: 安装 MCP
      if (mcpCandidates.length > 0 && manager?.mcpManager) {
        const best = mcpCandidates[0];
        parts.push('\n### MCP 服务器');
        parts.push(`- 找到 ${mcpCandidates.length} 个候选`);

        try {
          const config = {
            name: best.name,
            command: best.installCommand,
            args: [],
          };
          manager.mcpManager.addServer(config);
          parts.push(`- ✅ 已安装: **${best.name}**`);
          parts.push(`  - 描述: ${best.description}`);
          parts.push(`  - 安装命令: \`${best.installCommand}\``);
        } catch (err) {
          parts.push(`- ❌ 安装失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Step 3: 安装 Skill
      if (skillCandidates.length > 0 && manager?.skillRegistry) {
        const best = skillCandidates[0];
        parts.push('\n### Skill');
        parts.push(`- 找到 ${skillCandidates.length} 个候选`);

        try {
          const skill = {
            id: `installed-${best.id}`,
            name: best.name,
            version: '1.0.0',
            description: best.description,
            category: best.category,
            tags: ['installed'],
            source: 'installed',
            content: '',
          };
          manager.skillRegistry.register(skill);
          parts.push(`- ✅ 已安装: **${best.name}** (${best.category})`);

          // 持久化到 installed/ 目录
          // (实际持久化由 SkillRegistry 负责)
        } catch (err) {
          parts.push(`- ❌ 安装失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      parts.push('\n---');
      parts.push(`搜索完成: ${mcpCandidates.length + skillCandidates.length} 个候选`);

      return this.success(parts.join('\n'), {
        goal,
        mcpCount: mcpCandidates.length,
        skillCount: skillCandidates.length,
        mcpCandidates: mcpCandidates.slice(0, 3),
        skillCandidates: skillCandidates.slice(0, 3),
      });
    } catch (err) {
      return this.error(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
