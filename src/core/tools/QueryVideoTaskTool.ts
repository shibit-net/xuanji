// ============================================================
// 视频任务管理 — 查询视频任务状态 (query_video_task)
// ============================================================

import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import { BaseTool } from './BaseTool';
import { ToolConfigManager } from './ToolConfigManager';
import { getAdapter } from './adapters/AdapterFactory';
import { MediaTaskTracker } from './MediaTaskTracker';

/**
 * 查询视频生成任务状态
 *
 * 传入 generate_video(async=true) 返回的 task_id，
 * 查询任务的当前状态并返回结果（含视频 URL，成功时）。
 */
export class QueryVideoTaskTool extends BaseTool {
  readonly name = 'query_video_task';
  readonly readonly = true;
  readonly description =
    'Query the status of an async video generation task submitted by generate_video. Returns task status (submitted/running/succeeded/failed) and, if complete, the video URL.';

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
    if (!adapter.queryVideoTask) {
      return this.error(`当前平台 (${cfg.provider}) 不支持查询视频任务状态。`);
    }

    try {
      const status = await adapter.queryVideoTask(taskId, cfg);

      // 同步更新 MediaTaskTracker
      MediaTaskTracker.getInstance().updateStatus(taskId, status);

      const lines = [
        `📊 视频任务状态:`,
        `task_id: ${status.taskId}`,
        `status: ${status.status}`,
      ];
      if (status.status === 'succeeded' && status.videoUrl) {
        lines.push(`video_url: ${status.videoUrl}`);
        lines.push('');
        lines.push('💡 请使用 send_file_to_user 将视频发送给用户。');
      } else if (status.status === 'failed') {
        lines.push(`error: ${status.error || '未知错误'}`);
      } else {
        lines.push('任务仍在处理中，请稍后再查询。');
      }
      return { content: lines.join('\n'), isError: false };
    } catch (err: any) {
      return this.error(`查询视频任务失败: ${err.message}`);
    }
  }
}
