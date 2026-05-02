/**
 * PermissionGate — 工具权限门控
 *
 * 在 ToolGateway 执行工具前进行权限校验。
 */
import { logger } from '@/core/logger';
import type { PermissionController } from '@/core/permission/PermissionController';

const log = logger.child({ module: 'PermissionGate' });

export class PermissionGate {
  private controller: PermissionController;

  constructor(controller: PermissionController) {
    this.controller = controller;
  }

  check(toolName: string, input: Record<string, unknown>): 'allowed' | 'denied' | 'confirm' {
    const result = this.controller.check(toolName, input);
    if (result === 'denied') {
      this.controller.trackDenial(toolName);
      log.warn(`Tool "${toolName}" denied by permission gate`);
    }
    return result;
  }

  async requestConfirmation(toolName: string, input: Record<string, unknown>, reason: string): Promise<boolean> {
    const risk = this.assessRisk(toolName, input);
    return this.controller.requestConfirmation({
      toolName,
      toolInput: input,
      reason,
      risk,
    });
  }

  isReadonly(toolName: string): boolean {
    const readonlyTools = new Set([
      'read', 'glob', 'grep', 'ls', 'list_agents', 'list_scenes',
      'match_agent', 'todo_list', 'task_output',
    ]);
    return readonlyTools.has(toolName);
  }

  private assessRisk(toolName: string, input: Record<string, unknown>): 'low' | 'medium' | 'high' {
    const highRiskTools = new Set(['bash', 'write', 'edit', 'multi_edit', 'delete', 'task', 'team', 'worktree']);
    const mediumRiskTools = new Set(['web_fetch', 'notebook_edit', 'enter_plan_mode', 'exit_plan_mode']);

    if (highRiskTools.has(toolName)) return 'high';
    if (mediumRiskTools.has(toolName)) return 'medium';
    if (toolName === 'bash') {
      const cmd = String(input.command || input.cmd || '');
      if (cmd.includes('rm -rf') || cmd.includes('sudo') || cmd.includes('chmod 777')) return 'high';
    }
    return 'low';
  }
}
