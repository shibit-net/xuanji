// ============================================================
// 媒体生成工具 — 文生视频 (generate_video)
// ============================================================

import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import type { ToolMediaGenConfig } from '@/shared/types/config';
import { AbstractMediaGenTool } from './AbstractMediaGenTool';
import { getAdapter } from './adapters/AdapterFactory';
import { MediaTaskTracker } from './MediaTaskTracker';

/**
 * 文生视频工具
 *
 * 支持同步和异步两种模式：
 *   async=true（默认）→ 仅提交任务，返回 task_id，需用 query_video_task 查询
 *   async=false       → 阻塞等待，完成后返回视频 URL
 *
 * 图生视频: 通过 reference_images 参数传入首帧/参考图
 */
export class GenerateVideoTool extends AbstractMediaGenTool {
  readonly name = 'generate_video';
  readonly toolConfigName = 'generate_video';
  readonly mediaType = 'video' as const;
  readonly displayUnit = '个';
  readonly description =
    'Generate videos from text descriptions or reference images. Required: prompt. Optional: size, n, reference_images, duration, style, async.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the desired video',
      },
      size: {
        type: 'string',
        enum: ['1K', '2K', '4K'],
        description: 'Video resolution (default: config defaultSize or 2K)',
      },
      n: {
        type: 'integer',
        description: 'Number of videos to generate (1-2, default: 1)',
      },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reference images as base64 strings — use for image-to-video generation',
      },
      duration: {
        type: 'integer',
        description: 'Video duration in seconds (default: config defaultDuration or 5)',
      },
      style: {
        type: 'string',
        description: 'Visual style (e.g. cinematic, anime, realistic)',
      },
      model: {
        type: 'string',
        description: 'Model name override',
      },
      async: {
        type: 'boolean',
        description: 'Whether to run asynchronously. true (default): returns task_id immediately, use query_video_task to check progress. false: blocks until complete.',
      },
    },
  };

  protected validateInput(input: Record<string, unknown>): ToolResult | null {
    return super.validateInput(input);
  }

  protected async doExecute(
    input: Record<string, unknown>,
    cfg: ToolMediaGenConfig,
  ): Promise<ToolResult> {
    const adapter = getAdapter(cfg.provider);

    if (!adapter.generateVideo) {
      return this.error(
        `当前平台 (${cfg.provider}) 暂不支持视频生成。请切换至 ark 或 bailian。`,
      );
    }

    const asyncMode = input.async !== false; // 默认 true

    if (!asyncMode) {
      // 同步模式：提交 + 轮询等待
      const result = await adapter.generateVideo(input as any, cfg);
      return {
        content: `成功生成 1 个视频。\n视频 URL: ${result.videoUrl}\n\n💡 请使用 send_file_to_user 将结果发送给用户。`,
        isError: false,
      };
    }

    // 异步模式：仅提交任务，返回 task_id
    if (!adapter.submitVideoTask) {
      return this.error(`当前平台 (${cfg.provider}) 不支持异步视频任务提交。`);
    }

    try {
      const taskId = await adapter.submitVideoTask(input as any, cfg);

      // 注册到 MediaTaskTracker，让 Agent 能感知后台任务
      const tracker = MediaTaskTracker.getInstance();
      tracker.register(taskId, 'video', cfg.provider, input.prompt as string);
      const pendingCount = tracker.listPending().length;

      return {
        content: [
          `✅ 视频生成任务已提交`,
          `task_id: ${taskId}`,
          `status: submitted`,
          `当前 ${pendingCount} 个视频任务在后台运行`,
          '',
          `💡 可随时调用 list_media_tasks 查看所有任务状态。`,
          `查询此任务: query_video_task(task_id: "${taskId}")`,
          `取消此任务: cancel_video_task(task_id: "${taskId}")`,
        ].join('\n'),
        isError: false,
      };
    } catch (err: any) {
      return this.error(`视频任务提交失败: ${err.message}`);
    }
  }

}
