// ============================================================
// SessionDiagnostics — 会话诊断信息生成
// ============================================================

import type { AppConfig } from '@/core/types';
import type { MCPManager } from '@/mcp/MCPManager';
import type { SkillRegistry } from '@/core/skills';
import type { IMemoryStore } from '@/memory/types';
import type { IPermissionController } from '@/permission/types';
import { maskApiKey } from '@/core/utils/ui/formatters';

export interface DiagnosticsContext {
  config: AppConfig;
  mcpManager: MCPManager | null;
  skillRegistry: SkillRegistry | null;
  memoryManager: IMemoryStore | null;
  permissionController: IPermissionController | null;
  initialized: boolean;
}

/**
 * 生成系统诊断报告
 */
export async function generateDiagnostics(ctx: DiagnosticsContext): Promise<string> {
  const lines: string[] = [];
  const check = (ok: boolean) => ok ? '✓' : '✗';

  // ── 模型配置 ──
  const provider = ctx.config.provider;
  lines.push('🏥 璇玑系统诊断');
  lines.push('');
  lines.push('📡 模型配置');
  lines.push(`  模型:     ${provider.model ?? '未配置'}`);
  lines.push(`  轻量模型: ${provider.lightModel ?? '未配置'}`);
  lines.push(`  服务地址: ${provider.baseURL ?? '未配置'}`);
  lines.push(`  适配器:   ${provider.adapter ?? 'auto'}`);
  lines.push(`  API Key:  ${maskApiKey(provider.apiKey)}`);
  lines.push(`  Max Tokens: ${provider.maxTokens ?? 'default'}`);

  // ── MCP 服务 ──
  lines.push('');
  const mcpManager = ctx.mcpManager;
  if (mcpManager && mcpManager.isInitialized()) {
    const runtimes = mcpManager.getServerRuntimes();
    lines.push(`🔌 MCP 服务 (${runtimes.length} 个)`);
    if (runtimes.length === 0) {
      lines.push('  (无)');
    } else {
      for (const rt of runtimes) {
        const transport = rt.config.transport ?? 'stdio';
        const target = transport === 'sse'
          ? (rt.config.sseUrl ?? '')
          : `${rt.config.command ?? ''} ${(rt.config.args ?? []).join(' ')}`.trim();
        lines.push(`  ${check(rt.state === 'ready')} ${rt.name}  [${transport}]  ${target}  (${rt.state})`);
      }
    }
  } else {
    lines.push('🔌 MCP 服务 (未初始化)');
    lines.push('  配置文件: ~/.xuanji/mcp.json');
  }

  // ── Skills ──
  lines.push('');
  if (ctx.skillRegistry) {
    const allSkills = ctx.skillRegistry.list();
    const builtinSkills = allSkills.filter(s => [
      'xuanji-assistant', 'memory-context', 'project-rules', 'life-secretary',
      'code-assistant', 'tool-guidance', 'security-rules', 'agent-rules',
      'react-loop-default', 'multi-turn-handling', 'commit', 'review-pr',
    ].includes(s.id));
    const customSkills = allSkills.filter(s => !builtinSkills.includes(s));
    const mcpSkills = customSkills.filter(s => s.id.includes(':'));
    const userSkills = customSkills.filter(s => !s.id.includes(':'));

    lines.push(`🧩 Skills (${allSkills.length} 个)`);
    lines.push(`  内置 (${builtinSkills.length}): ${builtinSkills.map(s => s.id).join(', ')}`);
    if (userSkills.length > 0) {
      lines.push(`  自定义 (${userSkills.length}): ${userSkills.map(s => s.id).join(', ')}`);
    }
    if (mcpSkills.length > 0) {
      lines.push(`  MCP (${mcpSkills.length}): ${mcpSkills.map(s => s.id).join(', ')}`);
    }
  } else {
    lines.push('🧩 Skills (未初始化)');
  }

  // ── Memory ──
  lines.push('');
  if (ctx.memoryManager) {
    lines.push('🧠 记忆系统 (已启用)');
    const stats = await ctx.memoryManager.getStats();
    lines.push(`  总记忆数: ${stats.total}`);
    lines.push(`  类型分布:`);
    for (const [type, count] of Object.entries(stats.byType)) {
      lines.push(`    ${type}: ${count}`);
    }
  } else {
    lines.push('🧠 记忆系统 (未启用)');
    lines.push('  配置文件: xuanji.config.ts');
    lines.push('  示例: memory: { enabled: true }');
  }

  // ── Permission ──
  lines.push('');
  if (ctx.permissionController) {
    const config = ctx.permissionController.getConfig();
    lines.push('🔒 权限控制');
    lines.push(`  文件读取: ${config.fileRead}`);
    lines.push(`  文件写入: ${config.fileWrite}`);
    lines.push(`  命令执行: ${config.bashExec}`);
    lines.push(`  Warn 策略: ${config.warnLevel ?? 'ask'}`);
    lines.push(`  写入确认: ${config.confirmWrite ?? 'plan-only'}`);
    if (config.deniedCommands && config.deniedCommands.length > 0) {
      lines.push(`  禁止命令: ${config.deniedCommands.length} 条`);
    }
    if (config.deniedPaths && config.deniedPaths.length > 0) {
      lines.push(`  禁止路径: ${config.deniedPaths.length} 条`);
    }
  } else {
    lines.push('🔒 权限控制 (未配置)');
  }

  // ── 初始化状态 ──
  lines.push('');
  lines.push('🎯 系统状态');
  lines.push(`  已初始化: ${check(ctx.initialized)}`);

  return lines.join('\n');
}
