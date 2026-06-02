/**
 * ListAgentsTool — 列出可用 Agent
 *
 * 让 LLM 查询系统中所有可用的 Agent，帮助做出更好的决策。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import { BaseTool } from './BaseTool';

export class ListAgentsTool extends BaseTool {
  readonly name = 'list_agents';
  readonly description = [
    'List available agents in the system.',
    '',
    'Use this to discover which agents exist and their capabilities when intent analysis or match_agent is insufficient.',
    '',
    'Supports filtering by search keyword, tags, and showing only enabled agents.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        description: 'Optional filters to narrow down the list',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags (e.g., ["finance", "coding"])',
          },
          search: {
            type: 'string',
            description: 'Search keyword in name, description, or capabilities',
          },
          enabled_only: {
            type: 'boolean',
            description: 'Only show enabled agents (default: true)',
          },
          include_subagents: {
            type: 'boolean',
            description: 'Include built-in sub-agents (explore, plan, coder, etc.) (default: true)',
          },
        },
      },
    },
  };

  readonly readonly = true; // Read-only operation

  private agentRegistry: AgentRegistry | null = null;

  /**
   * 注入 AgentRegistry 依赖
   */
  setAgentRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.agentRegistry) {
      return this.error('AgentRegistry not available. This tool requires agent configuration.');
    }

    const filter = input.filter as {
      tags?: string[];
      search?: string;
      enabled_only?: boolean;
      include_subagents?: boolean;
    } | undefined;

    const enabledOnly = filter?.enabled_only ?? true;
    const includeSubagents = filter?.include_subagents ?? true;

    // 获取 Agent（启用状态过滤）
    let agents = enabledOnly
      ? this.agentRegistry.getEnabled()
      : this.agentRegistry.getAll();

    // 🔧 排除系统内置 agent（不应被 LLM 选为团队成员）
    agents = agents.filter(a => a.metadata?.category !== 'system');

    // 过滤子代理（可选）
    if (!includeSubagents) {
      agents = agents.filter(a => !a.metadata?.internal);
    }

    // 标签过滤
    if (filter?.tags && filter.tags.length > 0) {
      agents = agents.filter(a =>
        filter.tags!.some(tag => (a.tags ?? []).includes(tag))
      );
    }

    // 关键词搜索
    if (filter?.search && typeof filter.search === 'string') {
      const keyword = filter.search.toLowerCase();
      agents = agents.filter(a =>
        a.id.toLowerCase().includes(keyword) ||
        a.name.toLowerCase().includes(keyword) ||
        a.description.toLowerCase().includes(keyword) ||
        a.capabilities.some(cap => cap.toLowerCase().includes(keyword))
      );
    }

    if (agents.length === 0) {
      return this.success('No agents found matching the criteria.');
    }

    // 格式化输出
    const output = this.formatAgentList(agents);

    return this.success(output);
  }

  /**
   * 格式化 Agent 列表
   */
  private formatAgentList(agents: any[]): string {
    const lines: string[] = [
      `Found ${agents.length} agent(s):`,
      '',
    ];

    // 按是否内置分组
    const builtin = agents.filter(a =>
      a.metadata?.internal ||
      a.metadata?.filePath?.includes('/builtin/') ||
      a.metadata?.filePath?.includes('\\builtin\\')
    );
    const custom = agents.filter(a =>
      !a.metadata?.internal &&
      !a.metadata?.filePath?.includes('/builtin/') &&
      !a.metadata?.filePath?.includes('\\builtin\\')
    );

    if (builtin.length > 0) {
      lines.push('## Built-in Agents');
      lines.push('');
      builtin.forEach(agent => {
        lines.push(this.formatAgentInfo(agent));
      });
      lines.push('');
    }

    if (custom.length > 0) {
      lines.push('## Custom Agents');
      lines.push('');
      custom.forEach(agent => {
        lines.push(this.formatAgentInfo(agent));
      });
    }

    return lines.join('\n');
  }

  /**
   * 格式化单个 Agent 信息
   */
  private formatAgentInfo(agent: any): string {
    const lines: string[] = [];

    // 标题行
    const badge = agent.metadata?.internal ? '🤖 Internal Agent' : '⭐ Agent';
    lines.push(`### ${badge} ${agent.name} (${agent.id})`);
    lines.push('');

    // 描述
    if (agent.description) {
      lines.push(`**Description**: ${agent.description}`);
      lines.push('');
    }

    // 能力
    if (agent.capabilities && agent.capabilities.length > 0) {
      lines.push(`**Capabilities**:`);
      agent.capabilities.forEach((cap: string) => {
        lines.push(`  - ${cap}`);
      });
      lines.push('');
    }

    // 标签
    if (agent.tags && agent.tags.length > 0) {
      lines.push(`**Tags**: ${agent.tags.join(', ')}`);
      lines.push('');
    }

    // 模型
    if (agent.model?.primary) {
      lines.push(`**Model**: ${agent.model.primary}`);
      if (agent.metadata?.useLightModel) {
        lines.push(`  (Optimized for speed)`);
      }
      lines.push('');
    }

    // 工具数量
    if (agent.tools && agent.tools.length > 0) {
      lines.push(`**Tools**: ${agent.tools.length} available`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');

    return lines.join('\n');
  }
}
