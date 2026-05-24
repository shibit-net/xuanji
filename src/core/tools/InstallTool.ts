/**
 * InstallTool — MCP / Skill 安装工具
 *
 * 从天工坊 Marketplace 搜索并安装 MCP 服务器和 Skill。
 * 设计文档：docs/mcp-skills-audit-dev-plan.md (M4)
 *
 * 使用方式：
 *   搜索：install({ goal: "PostgreSQL", type: "mcp" })
 *   安装：install({ packageId: "postgres-123", type: "mcp" })
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';
import type { TiangongMarket, MarketPackage } from '@/mcp/market/TiangongMarket';
import type { MCPInstaller } from '@/mcp/market/MCPInstaller';
import type { SkillInstaller } from '@/core/skills/SkillInstaller';

const log = logger.child({ module: 'InstallTool' });

// ============================================================
// InstallTool
// ============================================================

export class InstallTool extends BaseTool {
  readonly name = 'install';
  readonly description =
    'Search and install external plugins (MCP servers or Skills). Call this tool when a required tool is missing.\n\n' +
    'Search mode: install({ goal: "PostgreSQL database", type: "mcp" }) → returns search results\n' +
    'Install mode: install({ packageId: "postgres-123", type: "mcp", version: "1.0.0" }) → download and register\n\n' +
    'Type info: mcp=MCP server (tools), skill=Skill (workflow/prompt)';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description:
          'Search keyword describing the capability you need, e.g. "PostgreSQL", "playwright browser automation", "review PR". Use this or packageId.',
      },
      type: {
        type: 'string',
        enum: ['mcp', 'skill', 'auto'],
        description: 'Plugin type. mcp=MCP server, skill=skill, auto=search both',
        default: 'auto',
      },
      packageId: {
        type: 'string',
        description:
          'Directly install the specified marketplace packageId (from search results). Skips search when provided.',
      },
      version: {
        type: 'string',
        description: 'Specify version (default: latest). Only used when packageId is provided.',
      },
    },
  };

  override readonly readonly = false;

  // ── 依赖注入 ──────────────────────────────────────────

  private market: TiangongMarket | null = null;
  private mcpInstaller: MCPInstaller | null = null;
  private skillInstaller: SkillInstaller | null = null;

  /**
   * 注入 marketplace 依赖（由 SessionFactory.registerAdvancedTools() 调用）
   */
  setDependencies(deps: {
    market: TiangongMarket;
    mcpInstaller: MCPInstaller;
    skillInstaller: SkillInstaller;
  }): void {
    this.market = deps.market;
    this.mcpInstaller = deps.mcpInstaller;
    this.skillInstaller = deps.skillInstaller;
  }

  // ── Execute ───────────────────────────────────────────

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const goal = input.goal as string | undefined;
    const type = (input.type as string) ?? 'auto';
    const packageId = input.packageId as string | undefined;
    const version = input.version as string | undefined;

    // 依赖检查
    if (!this.market) {
      return this.formatError({
        type: 'Marketplace not configured',
        message: 'Marketplace service unavailable',
        reason: 'Marketplace dependency not injected. Check the mcp.marketplace field in Xuanji config.',
        solutions: [
          'Configure baseUrl in xuanji.json mcp.marketplace (Starship marketplace address)',
          'Ensure marketplace.enabled is not set to false',
        ],
        example: '"mcp": { "marketplace": { "baseUrl": "https://api.shibit.com/api/tiangong" } }',
      });
    }

    // ── Mode 1: 直接安装（packageId 明确） ──────────
    if (packageId && packageId.trim().length > 0) {
      return this.installByPackageId(packageId.trim(), type, version);
    }

    // ── Mode 2: 搜索 ─────────────────────────────────
    if (goal && goal.trim().length > 0) {
      return this.searchAndPresent(goal.trim(), type);
    }

    return this.formatError({
      type: 'Parameter error',
      message: 'Missing goal or packageId',
      reason: 'install tool requires goal (search keyword) or packageId (direct install) parameter.',
      solutions: ['Provide goal parameter to search', 'Provide packageId parameter to install directly (from search results)'],
      example: 'install({ goal: "PostgreSQL", type: "mcp" })',
    });
  }

  // ============================================================
  // Private: Search Mode
  // ============================================================

  private async searchAndPresent(goal: string, type: string): Promise<ToolResult> {
    const parts: string[] = [`## 🔍 Search: "${goal}"`];
    let mcpItems: MarketPackage[] = [];
    let skillItems: MarketPackage[] = [];

    try {
      // Search MCP
      if (type === 'mcp' || type === 'auto') {
        const mcpResult = await this.market!.search({ type: 'mcp', query: goal, pageSize: 5 });
        mcpItems = mcpResult.items;
      }

      // Search Skill
      if (type === 'skill' || type === 'auto') {
        const skillResult = await this.market!.search({ type: 'skill', query: goal, pageSize: 5 });
        skillItems = skillResult.items;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Search failed for "${goal}":`, err);
      return this.error(`Search failed: ${msg}`);
    }

    if (mcpItems.length === 0 && skillItems.length === 0) {
      parts.push(`\nNo plugins found matching "${goal}". Try a more specific keyword.`);
      return this.success(parts.join('\n'), { goal, found: 0 });
    }

    const total = mcpItems.length + skillItems.length;
    parts.push(`\nFound ${total} result(s).`);

    // Show MCP results
    if (mcpItems.length > 0) {
      parts.push('\n### MCP Servers');
      parts.push('| # | Name | Description | ID | Downloads | Rating | Transport |');
      parts.push('|---|------|------|----|--------|------|------|');
      for (let i = 0; i < mcpItems.length; i++) {
        const item = mcpItems[i];
        const desc = (item.description || '').substring(0, 50).replace(/\|/g, '\\|');
        const rating = item.ratingAvg > 0 ? `⭐${item.ratingAvg.toFixed(1)}` : '-';
        parts.push(
          `| ${i + 1} | **${item.name}** | ${desc} | \`${item.packageId}\` | ${item.totalDownloads} | ${rating} | ${item.transport || '-'} |`,
        );
      }
    }

    // Show Skill results
    if (skillItems.length > 0) {
      parts.push('\n### Skills');
      parts.push('| # | Name | Description | ID | Downloads | Rating |');
      parts.push('|---|------|------|----|--------|------|');
      for (let i = 0; i < skillItems.length; i++) {
        const item = skillItems[i];
        const desc = (item.description || '').substring(0, 50).replace(/\|/g, '\\|');
        const rating = item.ratingAvg > 0 ? `⭐${item.ratingAvg.toFixed(1)}` : '-';
        parts.push(
          `| ${i + 1} | **${item.name}** | ${desc} | \`${item.packageId}\` | ${item.totalDownloads} | ${rating} |`,
        );
      }
    }

    // Guide next step
    parts.push('\n---');
    parts.push('💡 **Next step**: Use `install({ packageId: "xxx", type: "mcp|skill" })` to install the selected plugin.');

    return this.success(parts.join('\n'), {
      goal,
      mcpCount: mcpItems.length,
      skillCount: skillItems.length,
      mcpItems: mcpItems.map((i) => ({ packageId: i.packageId, name: i.name })),
      skillItems: skillItems.map((i) => ({ packageId: i.packageId, name: i.name })),
    });
  }

  // ============================================================
  // Private: Install Mode
  // ============================================================

  private async installByPackageId(
    packageId: string,
    type: string,
    version?: string,
  ): Promise<ToolResult> {
    const parts: string[] = [`## 📦 Install: \`${packageId}\``];

    // ── MCP Install ───────────────────────────────────────
    if (type === 'mcp' || type === 'auto') {
      try {
        const result = await this.mcpInstaller!.install(packageId, {
          version,
          autoStart: true,
        });

        if (result.success) {
          parts.push(`\n✅ MCP server installed successfully!`);
          parts.push(`- Name: **${result.config.name}**`);
          parts.push(`- Version: ${result.version}`);
          parts.push(`- Path: \`${result.installPath}\``);
          parts.push(`- Transport: ${result.config.transport || 'stdio'}`);

          return this.success(parts.join('\n'), {
            packageId,
            type: 'mcp',
            version: result.version,
            name: result.config.name,
          });
        }

        // MCP install failed — if type=auto, try Skill
        if (type === 'auto') {
          log.info(`MCP install failed for ${packageId}, trying Skill install`);
        } else {
          return this.error(`MCP install failed: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (type === 'mcp') {
          return this.error(`MCP install failed: ${msg}`);
        }
        log.warn(`MCP install error for ${packageId} (type=auto, will try skill): ${msg}`);
      }
    }

    // ── Skill Install ─────────────────────────────────────
    if (type === 'skill' || type === 'auto') {
      try {
        const result = await this.skillInstaller!.install({
          packageId,
          version,
        });

        if (result.success) {
          parts.push(`\n✅ Skill installed successfully!`);
          parts.push(`- ID: **${result.skillId}**`);
          parts.push(`- Version: ${result.version}`);
          parts.push(`- File: \`${result.filePath}\``);

          return this.success(parts.join('\n'), {
            packageId,
            type: 'skill',
            version: result.version,
            skillId: result.skillId,
          });
        }

        return this.error(`Skill install failed: ${result.error}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.error(`Skill install failed: ${msg}`);
      }
    }

    // type=auto and both MCP and Skill failed
    return this.error(
      `Cannot install \`${packageId}\`: both MCP and Skill install failed. Please explicitly specify type="mcp" or type="skill".`,
    );
  }
}
