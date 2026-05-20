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
    '搜索并安装外部插件（MCP 服务器或 Skill）。当缺少工具时调用此工具。\n\n' +
    '搜索模式：install({ goal: "PostgreSQL 数据库", type: "mcp" }) → 返回搜索结果列表\n' +
    '安装模式：install({ packageId: "postgres-123", type: "mcp", version: "1.0.0" }) → 下载并注册\n\n' +
    '类型说明：mcp=MCP服务器（工具），skill=技能（工作流/prompt）';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description:
          '搜索关键词，描述你需要的功能，如 "PostgreSQL"、"playwright 浏览器自动化"、"review PR"。与 packageId 二选一。',
      },
      type: {
        type: 'string',
        enum: ['mcp', 'skill', 'auto'],
        description: '插件类型。mcp=MCP服务器, skill=技能, auto=同时搜索两者',
        default: 'auto',
      },
      packageId: {
        type: 'string',
        description:
          '直接安装指定的天工坊 packageId（从搜索结果中获取）。提供此参数时跳过搜索。',
      },
      version: {
        type: 'string',
        description: '指定版本号（不传则安装最新版）。仅在提供 packageId 时生效。',
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
        type: 'Marketplace 未配置',
        message: 'marketplace 服务不可用',
        reason: '尚未注入 marketplace 依赖。请检查 Xuanji 配置中的 mcp.marketplace 字段。',
        solutions: [
          '在 xuanji.json 的 mcp.marketplace 中配置 baseUrl（Starship 天工坊地址）',
          '确认 marketplace.enabled 未设为 false',
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
      type: '参数错误',
      message: '缺少 goal 或 packageId',
      reason: 'install 工具需要 goal（搜索关键词）或 packageId（直接安装）参数。',
      solutions: ['提供 goal 参数进行搜索', '提供 packageId 参数直接安装（从搜索结果中获取）'],
      example: 'install({ goal: "PostgreSQL", type: "mcp" })',
    });
  }

  // ============================================================
  // Private: Search Mode
  // ============================================================

  private async searchAndPresent(goal: string, type: string): Promise<ToolResult> {
    const parts: string[] = [`## 🔍 搜索: "${goal}"`];
    let mcpItems: MarketPackage[] = [];
    let skillItems: MarketPackage[] = [];

    try {
      // 搜索 MCP
      if (type === 'mcp' || type === 'auto') {
        const mcpResult = await this.market!.search({ type: 'mcp', query: goal, pageSize: 5 });
        mcpItems = mcpResult.items;
      }

      // 搜索 Skill
      if (type === 'skill' || type === 'auto') {
        const skillResult = await this.market!.search({ type: 'skill', query: goal, pageSize: 5 });
        skillItems = skillResult.items;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Search failed for "${goal}":`, err);
      return this.error(`搜索失败: ${msg}`);
    }

    if (mcpItems.length === 0 && skillItems.length === 0) {
      parts.push(`\n未找到与 "${goal}" 匹配的插件。请尝试更具体的关键词。`);
      return this.success(parts.join('\n'), { goal, found: 0 });
    }

    const total = mcpItems.length + skillItems.length;
    parts.push(`\n找到 ${total} 个结果。`);

    // 展示 MCP 结果
    if (mcpItems.length > 0) {
      parts.push('\n### MCP 服务器');
      parts.push('| # | 名称 | 描述 | ID | 下载量 | 评分 | 传输 |');
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

    // 展示 Skill 结果
    if (skillItems.length > 0) {
      parts.push('\n### Skill');
      parts.push('| # | 名称 | 描述 | ID | 下载量 | 评分 |');
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

    // 引导下一步
    parts.push('\n---');
    parts.push('💡 **下一步**：使用 `install({ packageId: "xxx", type: "mcp|skill" })` 安装选中的插件。');

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
    const parts: string[] = [`## 📦 安装: \`${packageId}\``];

    // ── MCP 安装 ───────────────────────────────────────
    if (type === 'mcp' || type === 'auto') {
      try {
        const result = await this.mcpInstaller!.install(packageId, {
          version,
          autoStart: true,
        });

        if (result.success) {
          parts.push(`\n✅ MCP 服务器安装成功！`);
          parts.push(`- 名称: **${result.config.name}**`);
          parts.push(`- 版本: ${result.version}`);
          parts.push(`- 路径: \`${result.installPath}\``);
          parts.push(`- 传输: ${result.config.transport || 'stdio'}`);

          return this.success(parts.join('\n'), {
            packageId,
            type: 'mcp',
            version: result.version,
            name: result.config.name,
          });
        }

        // MCP 安装失败 — 如果 type=auto，尝试 Skill
        if (type === 'auto') {
          log.info(`MCP install failed for ${packageId}, trying Skill install`);
        } else {
          return this.error(`MCP 安装失败: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (type === 'mcp') {
          return this.error(`MCP 安装失败: ${msg}`);
        }
        log.warn(`MCP install error for ${packageId} (type=auto, will try skill): ${msg}`);
      }
    }

    // ── Skill 安装 ─────────────────────────────────────
    if (type === 'skill' || type === 'auto') {
      try {
        const result = await this.skillInstaller!.install({
          packageId,
          version,
        });

        if (result.success) {
          parts.push(`\n✅ Skill 安装成功！`);
          parts.push(`- ID: **${result.skillId}**`);
          parts.push(`- 版本: ${result.version}`);
          parts.push(`- 文件: \`${result.filePath}\``);

          return this.success(parts.join('\n'), {
            packageId,
            type: 'skill',
            version: result.version,
            skillId: result.skillId,
          });
        }

        return this.error(`Skill 安装失败: ${result.error}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.error(`Skill 安装失败: ${msg}`);
      }
    }

    // type=auto 且 MCP 和 Skill 都失败
    return this.error(
      `无法安装 \`${packageId}\`：MCP 和 Skill 安装均未成功。请明确指定 type="mcp" 或 type="skill"。`,
    );
  }
}
