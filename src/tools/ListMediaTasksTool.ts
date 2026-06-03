// ============================================================
// 媒体任务管理 — 列出异步媒体任务 (list_media_tasks)
// ============================================================

import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import { BaseTool } from './BaseTool';
import { MediaTaskTracker, type MediaTaskEntry } from './MediaTaskTracker';
import { ToolConfigManager } from './ToolConfigManager';

/**
 * 列出异步媒体任务
 *
 * 展示所有通过 generate_video(async=true) 等异步模式提交的媒体任务。
 * Agent 通过此工具感知有哪些任务在后台运行，选择合适的时机查询或取消。
 */
export class ListMediaTasksTool extends BaseTool {
  readonly name = 'list_media_tasks';
  readonly readonly = true;
  readonly description =
    'List all pending async media generation tasks (video, audio, image). Returns task_id, type, status, and prompt for each. Use this to check what tasks are running in the background before deciding to query or cancel them.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['pending', 'all'],
        description: 'Filter tasks. "pending" (default): only submitted/running tasks. "all": all tasks including completed/failed.',
      },
      sync: {
        type: 'boolean',
        description: 'Whether to sync task status from remote API before listing (default: false). When true, fetches latest status from provider for each pending task.',
      },
    },
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tracker = MediaTaskTracker.getInstance();
    const filterMode = (input.filter as string) || 'pending';
    const shouldSync = input.sync === true;

    let tasks: MediaTaskEntry[];

    if (filterMode === 'all') {
      tasks = tracker.list();
    } else {
      tasks = tracker.listPending();
    }

    // 可选：从远程同步状态
    if (shouldSync && tasks.length > 0) {
      const cfg = ToolConfigManager.getInstance().getConfig('generate_video');
      if (cfg) {
        for (const task of tasks) {
          if (task.type === 'video' && (task.status === 'submitted' || task.status === 'running')) {
            await tracker.syncTask(task.taskId, cfg);
          }
        }
        // 重新获取列表（状态已更新）
        tasks = filterMode === 'all' ? tracker.list() : tracker.listPending();
      }
    }

    if (tasks.length === 0) {
      return {
        content: '📭 当前没有异步媒体任务。',
        isError: false,
      };
    }

    const lines: string[] = [
      `📋 异步媒体任务 (${tasks.length}):`,
      '',
    ];

    const statusIcons: Record<string, string> = {
      submitted: '⏳',
      running: '🔄',
      succeeded: '✅',
      failed: '❌',
    };

    for (const task of tasks) {
      const icon = statusIcons[task.status] || '❓';
      const age = Math.round((Date.now() - task.submittedAt) / 1000);
      const ageStr = age < 60 ? `${age}s` : `${Math.round(age / 60)}m`;

      lines.push(`${icon} \`${task.taskId}\``);
      lines.push(`   type: ${task.type}  |  provider: ${task.provider}  |  status: ${task.status}  |  age: ${ageStr}`);
      lines.push(`   prompt: ${task.prompt}`);

      if (task.status === 'succeeded' && task.videoUrl) {
        lines.push(`   video_url: ${task.videoUrl}`);
      }
      if (task.status === 'failed' && task.error) {
        lines.push(`   error: ${task.error}`);
      }
      lines.push('');
    }

    lines.push('💡 使用 query_video_task(task_id) 查询详情，cancel_video_task(task_id) 取消任务。');

    return { content: lines.join('\n'), isError: false };
  }
}
