// ============================================================
// 视频任务管理 — 取消视频任务 (cancel_video_task)
// ============================================================

import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import { BaseTool } from './BaseTool';
import { ToolConfigManager } from './ToolConfigManager';
import { getAdapter } from './adapters/AdapterFactory';
import { MediaTaskTracker } from './MediaTaskTracker';

/**
 * 取消视频生成任务
 *
 * 传入 generate_video(async=true) 返回的 task_id，
 * 取消正在运行或排队中的视频任务。
 */
export class CancelVideoTaskTool extends BaseTool {
  readonly name = 'cancel_video_task';
  readonly readonly = true;
  readonly description =
    'Cancel a running or queued video generation task submitted by generate_video. Requires the task_id returned from generate_video(async=true).';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['task_id'],
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID returned by generate_video(async=true)',
      },
    },
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const taskId = input.task_id as string;
    if (!taskId) return this.error('task_id 参数不能为空。');

    const cfg = ToolConfigManager.getInstance().getConfig('generate_video');
    if (!cfg) {
      return this.error('未找到 generate_video 配置。请在 Agent 配置中添加 generate_video 工具。');
    }

    const adapter = getAdapter(cfg.provider);
    if (!adapter.cancelVideoTask) {
      return this.error(`当前平台 (${cfg.provider}) 不支持取消视频任务。`);
    }

    try {
      const result = await adapter.cancelVideoTask(taskId, cfg);

      // 同步更新 MediaTaskTracker
      if (result.cancelled) {
        MediaTaskTracker.getInstance().markCancelled(taskId);
      }

      return {
        content: result.cancelled
          ? [
              `✅ 视频任务已取消`,
              `task_id: ${taskId}`,
            ].join('\n')
          : `取消视频任务失败: 平台返回 cancelled=false`,
        isError: !result.cancelled,
      };
    } catch (err: any) {
      return this.error(`取消视频任务失败: ${err.message}`);
    }
  }
}
