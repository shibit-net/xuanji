/**
 * TaskControlTool — 管理后台运行的 Agent 任务
 *
 * 支持查询进度、取消任务、列出所有后台任务。
 * 输出按 phase + status 组合格式化，每种场景带明确行为指令，
 * 避免 LLM 将"运行中 + 部分进度"误读为"部分失败"。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import type { TaskMember } from '@/core/task/types';

// ─── 格式化工具 ────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  setup: '🔧 初始化',
  executing: '🚀 执行中',
  synthesizing: '📊 汇总中',
};

const STATUS_ICON: Record<string, string> = {
  running: '🔄',
  completed: '✅',
  failed: '❌',
  cancelled: '🚫',
};

const MEMBER_STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  waiting: '⏸️',
  running: '🔄',
  completed: '✅',
  failed: '❌',
};

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

function formatMemberTree(members: TaskMember[]): string {
  if (!members || members.length === 0) return '';
  return members
    .map((m, i) => {
      const isLast = i === members.length - 1;
      const prefix = isLast ? '└─' : '├─';
      const icon = MEMBER_STATUS_ICON[m.status] || '⏳';
      let detail: string;
      if (m.status === 'completed') {
        if (m.endTime && m.startTime) {
          detail = `完成 (${formatElapsed(m.endTime - m.startTime)})`;
        } else {
          detail = '完成';
        }
        // 如果经历了重试才成功，标注出来
        if (m.retryCount && m.retryCount > 0) {
          detail += ` —— 经 ${m.retryCount} 次重试后成功`;
        }
      } else if (m.status === 'failed') {
        const reason = m.failureReason || '未知原因';
        detail = `失败 —— ${reason}`;
        if (m.retryCount && m.retryCount > 0) {
          detail += `（已重试 ${m.retryCount} 次）`;
        }
      } else if (m.status === 'running') {
        detail = m.retryCount && m.retryCount > 0
          ? `执行中...（第 ${m.retryCount + 1} 次尝试）`
          : '执行中...';
      } else if (m.status === 'waiting') {
        detail = '排队等待中';
      } else {
        detail = '等待启动';
      }
      return `${prefix} ${icon} ${m.name || m.id}: ${detail}`;
    })
    .join('\n');
}

// ─── 场景化输出构建 ────────────────────────────────

function buildStatusOutput(p: {
  groupId: string;
  type: string;
  goal: string;
  status: string;
  phase: string;
  totalMembers: number;
  completedMembers: number;
  currentMember?: string;
  currentMemberStatus?: string;
  members?: TaskMember[];
  elapsed: number;
  error?: string;
}): string {
  const { groupId, type, goal, status, phase, totalMembers, completedMembers, members, elapsed, error } = p;
  const typeLabel = type === 'team' ? `team${p.currentMember ? '' : ''}` : 'task';
  const header = `📋 [${typeLabel}] ${goal}`;

  // ── running 状态 ──
  if (status === 'running') {
    if (phase === 'setup') {
      return [
        header,
        '',
        `阶段: ${PHASE_LABEL[phase]} —— 正在创建执行环境...`,
        `状态: 运行中`,
        `成员: ${totalMembers} 人待启动`,
        `已用: ${formatElapsed(elapsed)}`,
        '',
        '⏳ 任务正在初始化，无需任何操作。',
      ].join('\n');
    }

    if (phase === 'synthesizing') {
      return [
        header,
        '',
        `阶段: ${PHASE_LABEL[phase]} —— 所有成员已执行完毕，正在聚合结果...`,
        `状态: 运行中`,
        `成员: ${completedMembers}/${totalMembers} 已执行`,
        `已用: ${formatElapsed(elapsed)}`,
        '',
        '⏳ 汇总即将完成，稍后系统会自动通知结果。不要主动查询。',
      ].join('\n');
    }

    // executing 阶段
    const lines: string[] = [header, '', `阶段: ${PHASE_LABEL[phase]}`];

    if (type === 'team') {
      // 统计各状态成员数
      const successCount = members?.filter(m => m.status === 'completed').length ?? completedMembers;
      const failedCount = members?.filter(m => m.status === 'failed').length ?? 0;
      const runningCount = members?.filter(m => m.status === 'running').length ?? 0;
      const waitingCount = members?.filter(m => m.status === 'waiting').length ?? 0;
      const pendingCount = members?.filter(m => m.status === 'pending').length ?? 0;

      const statusParts: string[] = [];
      if (successCount > 0) statusParts.push(`${successCount}/${totalMembers} 成功`);
      if (failedCount > 0) statusParts.push(`${failedCount}/${totalMembers} 失败`);
      if (runningCount > 0) statusParts.push(`${runningCount}/${totalMembers} 执行中`);
      if (waitingCount > 0) statusParts.push(`${waitingCount}/${totalMembers} 排队中`);
      if (pendingCount > 0) statusParts.push(`${pendingCount}/${totalMembers} 等待启动`);

      lines.push(`状态: 运行中 —— 团队正常工作，个体成员完成/失败不代表团队结束`);
      lines.push(`成员: ${statusParts.join(', ')}`);
      if (members && members.length > 0) {
        lines.push(formatMemberTree(members));
      }

      if (failedCount > 0) {
        lines.push('', '⚠️ 有成员失败，TeamManager 正在自动重试。不要干预。');
      }
    } else {
      // task 类型
      lines.push(`状态: 运行中`);
      if (p.currentMember) {
        lines.push(`当前: ${p.currentMember} ${p.currentMemberStatus || '执行中...'}`);
      }
    }

    lines.push(`已用: ${formatElapsed(elapsed)}`);
    lines.push('');
    lines.push('⚠️ 任务仍在运行。完成后系统自动通知，不要轮询。');
    lines.push('   用户主动问进度时可以告知当前状态，但不需要主动查询。');
    lines.push('   如需取消: task_control({ action: "cancel", groupId: "' + groupId + '" })');
    lines.push('   如需修改: 先取消，再用新参数重新创建任务。');

    return lines.join('\n');
  }

  // ── completed 状态 ──
  if (status === 'completed') {
    const lines: string[] = [header, ''];

    if (type === 'team' && members && members.length > 0) {
      const successCount = members.filter(m => m.status === 'completed').length;
      const failedCount = members.filter(m => m.status === 'failed').length;

      if (failedCount > 0) {
        lines.push(`状态: ⚠️ 已完成（部分成员失败）`);
        lines.push(`成员: ${successCount}/${totalMembers} 成功, ${failedCount}/${totalMembers} 失败`);
        lines.push(formatMemberTree(members));
        lines.push(`总耗时: ${formatElapsed(elapsed)}`);
        lines.push('');
        lines.push('📌 向用户汇报：');
        lines.push('   1. 先汇总成功成员的发现');
        lines.push('   2. 说明失败成员及原因');
        lines.push('   3. 建议用 task 工具单独重试失败成员，不需重建整个 team');
      } else {
        lines.push(`状态: ✅ 已完成 —— 全部成功`);
        lines.push(`成员: ${totalMembers}/${totalMembers} 全部成功`);
        lines.push(formatMemberTree(members));
        lines.push(`总耗时: ${formatElapsed(elapsed)}`);
        lines.push('');
        lines.push('📌 现在请汇总各成员发现，向用户汇报。引用成员输出时使用 📎 标注。');
      }
    } else {
      lines.push(`状态: ✅ 已完成`);
      lines.push(`总耗时: ${formatElapsed(elapsed)}`);
      lines.push('');
      lines.push('📌 此任务已完成，请向用户汇总结果。');
    }

    return lines.join('\n');
  }

  // ── failed 状态 ──
  if (status === 'failed') {
    const lines: string[] = [
      header,
      '',
      `状态: ❌ 失败 —— 团队执行异常终止`,
      `原因: ${error || '未知错误'}`,
    ];
    if (members && members.length > 0) {
      const successCount = members.filter(m => m.status === 'completed').length;
      if (successCount > 0) {
        lines.push(`已完成成员: ${successCount}/${totalMembers}（结果可能已保存至 checkpoint）`);
      }
    }
    lines.push(`已用: ${formatElapsed(elapsed)}`);
    lines.push('');
    lines.push('📌 向用户说明失败原因，询问是否重试或调整配置。');
    return lines.join('\n');
  }

  // ── cancelled 状态 ──
  if (status === 'cancelled') {
    return [
      header,
      '',
      `状态: 🚫 已取消`,
      `已用: ${formatElapsed(elapsed)}`,
      '',
      '📌 任务已被取消，告知用户即可。',
    ].join('\n');
  }

  // fallback
  return [
    header,
    '',
    `状态: ${STATUS_ICON[status] || ''} ${status}`,
    `已用: ${formatElapsed(elapsed)}`,
  ].join('\n');
}

// ─── TaskControlTool ──────────────────────────────

export class TaskControlTool extends BaseTool {
  readonly name = 'task_control';
  readonly description = [
    'Manage background agent tasks (started by task or agent_team).',
    '',
    'Actions:',
    '  status — 查询任务进度和结果。运行中→只汇报进度不轮询；已完成→汇总汇报',
    '  cancel — 取消运行中的后台任务',
    '  list   — 列出所有后台任务，按状态分组',
    '',
    'IMPORTANT:',
    '  - 状态为"运行中"时不要轮询，系统完成后会自动通知你',
    '  - agent_team 中个体成员失败不代表团队失败，团队可能仍在运行',
    '  - 中途修改任务：先 cancel 再重新创建',
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
    const manager = TaskOrchestrator.getInstance();

    switch (action) {
      // ── status ──────────────────────────────────
      case 'status': {
        if (!groupId) {
          return this.error('action=status 需要 groupId 参数');
        }
        const progress = manager.getProgress(groupId);
        if (!progress.found) {
          return this.error(progress.error ?? '任务组不存在');
        }

        const p = progress.progress;
        const content = buildStatusOutput({
          groupId,
          type: progress.type || 'task',
          goal: progress.goal || '',
          status: progress.status || 'running',
          phase: p?.phase || 'executing',
          totalMembers: p?.totalMembers || 0,
          completedMembers: p?.completedMembers || 0,
          currentMember: p?.currentMember,
          currentMemberStatus: p?.currentMemberStatus,
          members: progress.members,
          elapsed: p?.elapsed || 0,
          error: progress.error,
        });

        return this.success(content, {
          taskControl: true,
          action: 'status',
          groupId,
          status: progress.status,
          phase: p?.phase,
          type: progress.type,
        });
      }

      // ── cancel ──────────────────────────────────
      case 'cancel': {
        if (!groupId) {
          return this.error('action=cancel 需要 groupId 参数');
        }
        const result = manager.cancelTask(groupId);
        if (result.success) {
          return this.success(
            `🚫 任务组 ${groupId} 已取消。\n\n📌 告知用户任务已取消。如需修改后重试，用新参数重新创建即可。`,
            { taskControl: true, action: 'cancel', groupId },
          );
        }
        return this.error(result.error ?? '取消失败');
      }

      // ── list ────────────────────────────────────
      case 'list': {
        const tasks = manager.listTasks();
        if (tasks.length === 0) {
          return this.success('当前没有后台运行的任务。', {
            taskControl: true, action: 'list', tasks: [],
          });
        }

        // 按状态分组
        const running: typeof tasks = [];
        const completed: typeof tasks = [];
        const failed: typeof tasks = [];

        for (const t of tasks) {
          if (t.status === 'running') running.push(t);
          else if (t.status === 'completed') completed.push(t);
          else failed.push(t);
        }

        const sections: string[] = [`后台任务 (${tasks.length} 个)\n`];

        if (running.length > 0) {
          sections.push('🔄 运行中 —— 不要汇报，等待自动通知：');
          for (let i = 0; i < running.length; i++) {
            const t = running[i];
            const typeLabel = t.type === 'team' ? 'team' : 'task';
            sections.push(`  ${i + 1}. [${t.groupId}] ${typeLabel}  "${t.goal}"  进度 ${t.progress.completedMembers}/${t.progress.totalMembers}  ${formatElapsed(t.progress.elapsed)}`);
          }
          sections.push('');
        }

        if (completed.length > 0) {
          sections.push('✅ 已完成 —— 需要汇报：');
          for (let i = 0; i < completed.length; i++) {
            const t = completed[i];
            const typeLabel = t.type === 'team' ? 'team' : 'task';
            sections.push(`  ${i + 1}. [${t.groupId}] ${typeLabel}  "${t.goal}"  ${formatElapsed(t.progress.elapsed)}`);
          }
          sections.push('');
        }

        if (failed.length > 0) {
          sections.push('❌ 失败/已取消 —— 需要汇报：');
          for (let i = 0; i < failed.length; i++) {
            const t = failed[i];
            const typeLabel = t.type === 'team' ? 'team' : 'task';
            sections.push(`  ${i + 1}. [${t.groupId}] ${typeLabel}  "${t.goal}"  ${t.status}  ${formatElapsed(t.progress.elapsed)}`);
          }
        }

        return this.success(sections.join('\n'), {
          taskControl: true,
          action: 'list',
          tasks: tasks.map(t => ({ groupId: t.groupId, type: t.type, status: t.status })),
        });
      }

      default:
        return this.error(`未知 action: ${action}。支持: status, cancel, list`);
    }
  }
}
