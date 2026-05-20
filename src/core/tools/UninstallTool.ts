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

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';
import type { MCPInstaller } from '@/mcp/market/MCPInstaller';
import type { SkillInstaller } from '@/core/skills/SkillInstaller';

const log = logger.child({ module: 'UninstallTool' });

// ============================================================
// UninstallTool
// ============================================================

export class UninstallTool extends BaseTool {
  readonly name = 'uninstall';
  readonly description =
    '卸载已安装的 MCP 服务器或 Skill。' +
    'uninstall({ packageId: "postgres-123", type: "mcp" }) 卸载 MCP。' +
    'uninstall({ packageId: "skill-456", type: "skill" }) 卸载 Skill。';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      packageId: {
        type: 'string',
        description: '天工坊 packageId（安装时使用的 ID）',
      },
      type: {
        type: 'string',
        enum: ['mcp', 'skill'],
        description: '要卸载的插件类型。mcp=MCP服务器, skill=技能',
      },
      name: {
        type: 'string',
        description: 'MCP 服务器名称（可选，不传则通过 packageId 自动匹配）。仅 type=mcp 时有效。',
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
