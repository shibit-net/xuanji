// ============================================================
// 媒体生成工具 — 文生视频 (generate_video)
//
// 底层模型: Doubao Seedance 2.0 / 1.5 pro / 1.0
// API: POST /api/v3/contents/generations/tasks (异步任务 + 轮询)
//
// 核心能力:
//   文生视频 — prompt → 视频
//   图生视频(首帧) — prompt + reference_images[0] → 视频
//   图生视频(首尾帧) — prompt + reference_images[role:first_frame + role:last_frame]
//   多模态参考 — 最多9张图片、视频、音频混合参考
//   连续生成 — return_last_frame:true → 尾帧 → 下一段首帧
//   音画同步 — generate_audio:true (仅 2.0 / 1.5 pro)
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
 * 连续生成: return_last_frame=true 获取尾帧，作为下一段的首帧
 */
export class GenerateVideoTool extends AbstractMediaGenTool {
  readonly name = 'generate_video';
  readonly toolConfigName = 'generate_video';
  readonly mediaType = 'video' as const;
  readonly displayUnit = '个';
  readonly description =
    'Generate videos from text descriptions or reference images. ' +
    'Supports text-to-video, image-to-video (first/last frame), audio-synced output, ' +
    'and continuous multi-clip generation via return_last_frame. ' +
    'Required: prompt. Optional: reference_images, duration, resolution, ratio, seed, ' +
    'generate_audio, return_last_frame, watermark, style, model, async, n, ' +
    'camera_fixed, draft, service_tier, execution_expires_after, callback_url.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the desired video. Structure: subject + motion, scene + motion, camera + motion. Use natural language.',
      },
      model: {
        type: 'string',
        description: 'Model name override (e.g. doubao-seedance-2-0-260128). Default from config.',
      },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reference images (URLs or base64) for image-to-video. 1 image = first frame mode. 2 images = first+last frame mode (use role fields). Seedance 2.0 supports 1-9 images for multi-modal reference.',
      },
      duration: {
        type: 'integer',
        description: 'Video duration in seconds. Seedance 2.0: 4-15, 1.5 pro: 4-12, 1.0: 2-12. Set -1 for model auto-selection. Default: 15.',
      },
      resolution: {
        type: 'string',
        enum: ['480p', '720p', '1080p'],
        description: 'Video resolution. 2.0 fast does not support 1080p. Default: 720p.',
      },
      ratio: {
        type: 'string',
        enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
        description: 'Video aspect ratio. Default: "adaptive" (model decides).',
      },
      n: {
        type: 'integer',
        description: 'Number of videos to generate concurrently (1-2, default: 1).',
      },
      seed: {
        type: 'integer',
        description: 'Random seed for reproducible results. Same seed + same prompt = consistent output. Critical for multi-clip coherence.',
      },
      style: {
        type: 'string',
        description: 'Visual style for the video (e.g. "cinematic", "anime", "realistic", "Song dynasty period film, desaturated cold tones").',
      },
      generate_audio: {
        type: 'boolean',
        description: 'Generate audio-synced video with native sound. Only supported by Seedance 2.0 and 1.5 pro. Default: false.',
      },
      return_last_frame: {
        type: 'boolean',
        description: 'Return the last frame image URL of the generated video. Use this frame as the first frame of the next clip for continuous multi-clip generation. Default: false.',
      },
      watermark: {
        type: 'boolean',
        description: 'Whether to add watermark. Default: false.',
      },
      camera_fixed: {
        type: 'boolean',
        description: 'Fix camera position (no camera movement). Default: false (model auto camera movement).',
      },
      async: {
        type: 'boolean',
        description: 'Execution mode. true (default): submit task and return task_id immediately, use query_video_task to check progress. false: block until video generation completes.',
      },
      draft: {
        type: 'boolean',
        description: 'Draft/preview mode. Generate a low-cost preview for validation before full production. Only supported by Seedance 1.5 pro. Default: false.',
      },
      service_tier: {
        type: 'string',
        enum: ['default', 'flex'],
        description: 'Service tier. "default" (online, standard pricing), "flex" (offline, 50% cost, queued). Flex not available for Seedance 2.0. Default: "default".',
      },
      execution_expires_after: {
        type: 'integer',
        description: 'Task expiration timeout in seconds. Only effective with service_tier:"flex". Default: 172800 (48h).',
      },
      callback_url: {
        type: 'string',
        description: 'Webhook URL for task status change notifications (POST).',
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
      const parts = [
        `成功生成 1 个视频。`,
        `视频 URL: ${result.videoUrl}`,
      ];
      if (result.lastFrameUrl) {
        parts.push(`尾帧 URL: ${result.lastFrameUrl}`);
        parts.push('');
        parts.push('💡 尾帧已返回，可将此 URL 作为下一段视频的 reference_images 首帧实现连续生成。');
      }
      parts.push('', '💡 请使用 send_file_to_user 将结果发送给用户。');
      return {
        content: parts.join('\n'),
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
