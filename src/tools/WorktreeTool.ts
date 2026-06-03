// ============================================================
// M6 工具系统 — WorktreeTool Git Worktree 隔离
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { WorktreeManager, type WorktreeInfo } from '@/agent/WorktreeManager';

/**
 * Git Worktree 工具
 *
 * 提供 Git Worktree 创建/移除/列出功能，
 * 用于子代理隔离或多分支并行开发场景。
 */
export class WorktreeTool extends BaseTool {
  readonly name = 'enter_worktree';
  readonly description = [
    'Create an isolated Git worktree for sub-agent task execution.',
    '',
    'Actions: create, remove, list, cleanup.',
    'Useful for parallel development on different branches without interference.',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'remove', 'list', 'cleanup'],
        description: 'Operation type: create, remove, list, cleanup (clean unchanged worktrees)',
      },
      name: {
        type: 'string',
        description: '(create) Worktree name (optional, auto-generates unique name)',
      },
      path: {
        type: 'string',
        description: '(remove) Path of the worktree to remove',
      },
    },
    required: ['action'],
  };

  private manager = new WorktreeManager();

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;

    try {
      switch (action) {
        case 'create':
          return this.handleCreate(input.name as string | undefined);

        case 'remove':
          return this.handleRemove(input.path as string | undefined);

        case 'list':
          return this.handleList();

        case 'cleanup':
          return this.handleCleanup();

        default:
          return this.error(`未知操作: ${action}，支持: create, remove, list, cleanup`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`Worktree 操作失败: ${message}`);
    }
  }

  private async handleCreate(name?: string): Promise<ToolResult> {
    const info = await this.manager.create(name);
    return this.success(
      `Worktree 已创建\n路径: ${info.path}\n分支: ${info.branch}`,
      { path: info.path, branch: info.branch },
    );
  }

  private async handleRemove(wtPath?: string): Promise<ToolResult> {
    if (!wtPath) {
      return this.error('remove 操作需要提供 path 参数');
    }
    await this.manager.remove(wtPath);
    return this.success(`Worktree 已移除: ${wtPath}`);
  }

  private async handleList(): Promise<ToolResult> {
    const { execSync } = await import('node:child_process');
    try {
      const output = execSync('git worktree list', {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 5000,
      });
      return this.success(output.trim() || '(无 worktree)');
    } catch {
      return this.error('列出 worktree 失败，请确认当前目录是 Git 仓库');
    }
  }

  private async handleCleanup(): Promise<ToolResult> {
    const { removed, kept } = await this.manager.cleanup();
    const lines: string[] = [];
    if (removed.length > 0) {
      lines.push(`已清理 ${removed.length} 个无改动的 worktree:`);
      for (const p of removed) lines.push(`  - ${p}`);
    }
    if (kept.length > 0) {
      lines.push(`保留 ${kept.length} 个有改动的 worktree:`);
      for (const p of kept) lines.push(`  - ${p}`);
    }
    if (lines.length === 0) {
      lines.push('无需清理的 worktree');
    }
    return this.success(lines.join('\n'));
  }
}
