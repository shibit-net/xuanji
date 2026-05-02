/**
 * TaskControlTool — 管理后台运行的 Agent 任务
 *
 * 支持查询进度、取消任务、列出所有后台任务。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { AsyncAgentTaskManager } from '@/core/agent/async';

export class TaskControlTool extends BaseTool {
  readonly name = 'task_control';
  readonly description = [
    'Manage background agent tasks (started by task or agent_team).',
    '',
    'Actions:',
    '  status — Check progress and result of a specific task',
    '  cancel — Cancel a running background task',
    '  list   — Show all background tasks',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'cancel', 'list'],
        description: 'status=查询指定任务进度, cancel=取消指定任务, list=列出所有后台任务',
      },
      groupId: {
        type: 'string',
        description: '任务组 ID（action=status 或 cancel 时必填）',
      },
    },
    required: ['action'],
  };

  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const groupId = input.groupId as string | undefined;
    const manager = AsyncAgentTaskManager.getInstance();

    switch (action) {
      case 'status': {
        if (!groupId) {
          return this.error('action=status 需要 groupId 参数');
        }
        const progress = manager.getProgress(groupId);
        if (!progress.found) {
          return this.error(progress.error ?? '任务组不存在');
        }

        const p = progress.progress;
        const elapsedMin = p ? (p.elapsed / 60_000).toFixed(1) : '?';
        const remainingMin = p?.estimatedRemaining
          ? `, 预计剩余 ${(p.estimatedRemaining / 60_000).toFixed(1)}min`
          : '';

        const lines = [
          `[后台任务 ${groupId}]`,
          `状态: ${progress.status}`,
          `类型: ${progress.type}`,
          `目标: ${progress.goal}`,
          p ? `阶段: ${p.phase}` : '',
          p ? `进度: ${p.completedMembers}/${p.totalMembers}` : '',
          p?.currentMember ? `当前成员: ${p.currentMember}` : '',
          p?.currentMemberStatus ? `  状态: ${p.currentMemberStatus}` : '',
          `已用时间: ${elapsedMin}min${remainingMin}`,
          progress.completedAt
            ? `完成时间: ${new Date(progress.completedAt).toISOString()}`
            : '',
        ].filter(Boolean).join('\n');

        return this.success(lines, { taskControl: true, action: 'status', groupId });
      }

      case 'cancel': {
        if (!groupId) {
          return this.error('action=cancel 需要 groupId 参数');
        }
        const result = manager.cancelTask(groupId);
        if (result.success) {
          return this.success(`任务组 ${groupId} 已取消。`, {
            taskControl: true,
            action: 'cancel',
            groupId,
          });
        }
        return this.error(result.error ?? '取消失败');
      }

      case 'list': {
        const tasks = manager.listTasks();
        if (tasks.length === 0) {
          return this.success('当前没有后台运行的任务。', {
            taskControl: true,
            action: 'list',
            tasks: [],
          });
        }

        const taskList = tasks
          .sort((a, b) => b.startedAt - a.startedAt)
          .map((t, i) => {
            const elapsed = (t.progress.elapsed / 60_000).toFixed(1);
            return [
              `${i + 1}. [${t.groupId}] ${t.type === 'team' ? 'team' : 'task'} - ${t.goal.slice(0, 80)}`,
              `   状态: ${t.status} | 进度: ${t.progress.completedMembers}/${t.progress.totalMembers} | ${elapsed}min`,
            ].join('\n');
          })
          .join('\n');

        return this.success(`后台任务列表 (${tasks.length} 个):\n\n${taskList}`, {
          taskControl: true,
          action: 'list',
          tasks: tasks.map((t) => ({ groupId: t.groupId, type: t.type, status: t.status })),
        });
      }

      default:
        return this.error(`未知 action: ${action}。支持: status, cancel, list`);
    }
  }
}
