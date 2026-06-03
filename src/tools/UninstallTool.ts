/**
 * UninstallTool — MCP / Skill 卸载工具
 *
 * 卸载从 Marketplace 安装的 MCP 服务器或 Skill。
 * 设计文档：docs/mcp-skills-audit-dev-plan.md (M4)
 *
 * 使用方式：
 *   uninstall({ packageId: "postgres-123", type: "mcp" })
 *   uninstall({ packageId: "skill-456", type: "skill" })
 */

import type { JSONSchema, ToolResult } from '@/infrastructure/core-types';
import { BaseTool } from './BaseTool';
import { logger } from '@/infrastructure/logger';
import type { MCPInstaller } from '@/mcp/market/MCPInstaller';
import type { SkillInstaller } from '@/skills/SkillInstaller';

const log = logger.child({ module: 'UninstallTool' });

// ============================================================
// UninstallTool
// ============================================================

export class UninstallTool extends BaseTool {
  readonly name = 'uninstall';
  readonly description =
    'Uninstall an installed MCP server or Skill. ' +
    'uninstall({ packageId: "postgres-123", type: "mcp" }) uninstalls MCP. ' +
    'uninstall({ packageId: "skill-456", type: "skill" }) uninstalls Skill.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      packageId: {
        type: 'string',
        description:
          '要卸载的 skill ID（即系统提示中 Skills 列表里反引号包裹的 id，如 `skill-superpowers`，' +
          '注意不要传 skill 名称）。卸载 MCP 时传 marketplace packageId。',
      },
      type: {
        type: 'string',
        enum: ['mcp', 'skill'],
        description: 'Plugin type to uninstall. mcp=MCP server, skill=Skill',
      },
      name: {
        type: 'string',
        description: 'MCP server name (optional, auto-matched via packageId if not provided). Only valid when type=mcp.',
      },
    },
    required: ['packageId', 'type'],
  };

  override readonly readonly = false;

  // ── 依赖注入 ──────────────────────────────────────────

  private mcpInstaller: MCPInstaller | null = null;
  private skillInstaller: SkillInstaller | null = null;

  setDependencies(deps: {
    mcpInstaller: MCPInstaller;
    skillInstaller: SkillInstaller;
  }): void {
    this.mcpInstaller = deps.mcpInstaller;
    this.skillInstaller = deps.skillInstaller;
  }

  // ── Execute ───────────────────────────────────────────

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const packageId = input.packageId as string | undefined;
    const type = input.type as string | undefined;
    const name = input.name as string | undefined;

    if (!packageId || !packageId.trim()) {
      return this.error('缺少 packageId');
    }
    if (!type || !['mcp', 'skill'].includes(type)) {
      return this.error('type 必须是 "mcp" 或 "skill"');
    }

    // ── MCP 卸载 ───────────────────────────────────────
    if (type === 'mcp') {
      if (!this.mcpInstaller) {
        return this.error('MCP 安装器未初始化。请检查 marketplace 配置。');
      }

      try {
        const success = await this.mcpInstaller.uninstall(packageId.trim(), name);
        if (success) {
          log.info(`MCP uninstalled: ${packageId}`);
          return this.success(`✅ MCP 服务器 \`${packageId}\` 已卸载`, {
            packageId,
            type: 'mcp',
          });
        }
        return this.error(
          `卸载 \`${packageId}\` 时出现问题：未找到运行中的服务器，但安装文件已清理。`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Uninstall MCP failed: ${packageId}`, err);
        return this.error(`MCP 卸载失败: ${msg}`);
      }
    }

    // ── Skill 卸载 ─────────────────────────────────────
    if (type === 'skill') {
      if (!this.skillInstaller) {
        return this.error('Skill 安装器未初始化。请检查 marketplace 配置。');
      }

      try {
        // SkillInstaller.uninstall 接受 skillId（即 packageId）
        const result = await this.skillInstaller.uninstall(packageId.trim());
        if (result.success) {
          log.info(`Skill uninstalled: ${packageId}`);
          return this.success(`✅ Skill \`${packageId}\` 已卸载`, {
            packageId,
            type: 'skill',
          });
        }
        return this.error(`Skill 卸载失败: ${result.error}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Uninstall Skill failed: ${packageId}`, err);
        return this.error(`Skill 卸载失败: ${msg}`);
      }
    }

    return this.error(`未知类型: ${type}`);
  }
}
