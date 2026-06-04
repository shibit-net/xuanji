// ============================================================
// 媒体生成适配器 — 火山引擎豆包 (Ark)
//
// 模型: Seedream 4.0-5.0 (图片) + Seedance 1.0-2.0 (视频)
//
// 图片 API: POST {baseURL}/images/generations (OpenAI 兼容)
// 视频 API: POST {baseURL}/contents/generations/tasks (异步任务 + 轮询)
// 音频 API: POST {baseURL}/audio/speech (OpenAI TTS 兼容)
// ============================================================

import type { ToolMediaGenConfig } from '@/shared/types/config';
import type { PlatformAdapter, ContentBlockResult, MediaGenInput, VideoGenResult, VideoTaskStatus } from './PlatformAdapter';
import { apiGet, apiPost, apiDelete, parseB64Images, resolveSize } from './adapter-utils';

/**
 * 火山引擎豆包适配器
 *
 * 文生图: POST {baseURL}/images/generations，OpenAI 兼容格式
 * 图片编辑: 复用同一端点，repaint 操作传入 image + mask
 * 文生视频: POST {baseURL}/contents/generations/tasks，异步任务 + 轮询
 * 文生音频: POST {baseURL}/audio/speech，OpenAI TTS 兼容格式
 *
 * 限制: 豆包仅支持 repaint 编辑操作。其他操作需千问平台。
 */
export class ArkAdapter implements PlatformAdapter {
  readonly name = 'ark';
  readonly defaultBaseURL = 'https://ark.cn-beijing.volces.com/api/v3';

  // ============================================================
  // 图片生成
  // ============================================================

  async generateImage(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
  ): Promise<ContentBlockResult[]> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const size = input.size || cfg.defaultSize || '2K';

    // 构建 body — 从精简基线开始，仅添加明确指定的参数
    const body: Record<string, unknown> = {
      model: input.model || cfg.model,
      prompt: input.prompt,
      size,  // 透传原始尺寸（"2K"、"4K"），不解析为像素值
    };

    // n: 仅当 > 1 时发送
    const n = Math.max(1, Math.min(input.n || 1, 14));
    if (n > 1) {
      body.n = n;
    }

    // watermark: 遵循优先级 input > cfg > 不发送（让 API 用默认值）
    const watermark = input.watermark ?? cfg.watermark;
    if (watermark !== undefined) {
      body.watermark = watermark;
    }

    // output_format: 仅显式指定时才发送
    if (input.output_format) {
      body.output_format = input.output_format;
    }

    // response_format: 仅显式指定时才发送
    if (input.response_format) {
      body.response_format = input.response_format;
    }

    // sequential_image_generation: 转发用户指定的值（"disabled" | "auto"）
    if (input.sequential_image_generation) {
      body.sequential_image_generation = input.sequential_image_generation;
      if (input.sequential_image_generation === 'auto') {
        body.sequential_image_generation_options = { max_images: input.max_images || n };
      }
    } else if (n > 1) {
      body.sequential_image_generation = 'auto';
      body.sequential_image_generation_options = { max_images: n };
    }

    // 参考图: image (新) 优先，reference_images (旧) 作为回退
    const refImages = input.image
      ? (Array.isArray(input.image) ? input.image : [input.image])
      : input.reference_images;

    if (refImages && refImages.length > 0) {
      body.image = refImages.slice(0, 14);
    }

    // prompt 优化模式（仅 4.0 支持 fast）
    if (input.optimize_prompt) {
      body.optimize_prompt_options = { mode: input.optimize_prompt };
    }

    // 联网搜索（仅 5.0 lite）
    if (input.web_search) {
      body.tools = [{ type: 'web_search' }];
    }

    const data = await apiPost(`${baseURL}/images/generations`, cfg, body);
    return parseB64Images(data);
  }

  async editImage(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
    operation: string,
  ): Promise<ContentBlockResult[]> {
    if (operation !== 'repaint') {
      throw new Error(
        `火山引擎豆包暂不支持 ${operation} 操作，仅支持 repaint。如需 background/expand/erase/style，请切换至千问平台。`,
      );
    }
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const body = {
      model: input.model || cfg.model,
      prompt: input.prompt,
      response_format: 'b64_json',
      extra_body: {
        image: [input.source_image],
        watermark: input.watermark ?? cfg.watermark ?? false,
        ...(input.mask ? { mask: input.mask } : {}),
      },
    };
    const data = await apiPost(`${baseURL}/images/generations`, cfg, body);
    return parseB64Images(data);
  }

  // ============================================================
  // 视频生成（同步模式 — 提交 → 轮询 → 返回结果）
  // ============================================================

  /**
   * 构建视频生成请求 body
   *
   * 直接使用 API 顶层参数（新方式，推荐），而非 content_config
   * 参考: https://www.volcengine.com/docs/82379/2298881
   */
  private buildVideoBody(input: MediaGenInput, cfg: ToolMediaGenConfig): Record<string, unknown> {
    const model = input.model || cfg.model || 'doubao-seedance-2.0';
    const content: any[] = [{ type: 'text', text: input.prompt }];

    // reference_images → 拼入 content 数组
    if (input.reference_images?.length) {
      for (const img of input.reference_images) {
        content.push({
          type: 'image_url',
          image_url: { url: img },
        });
      }
    }

    const body: Record<string, unknown> = {
      model,
      content,
    };

    // 视频输出规格（新方式：顶层参数）
    if (input.resolution) body.resolution = input.resolution;
    if (input.ratio) body.ratio = input.ratio;
    if (input.duration !== undefined) body.duration = input.duration;
    else if (cfg.defaultDuration !== undefined) body.duration = cfg.defaultDuration;
    else body.duration = 15; // 默认 15s，充分利用模型能力

    // 质量控制
    if (input.seed !== undefined) body.seed = input.seed;
    if (input.watermark !== undefined) body.watermark = input.watermark;
    else if (cfg.watermark !== undefined) body.watermark = cfg.watermark;
    else body.watermark = false;

    // 音频
    if (input.generate_audio !== undefined) body.generate_audio = input.generate_audio;

    // 尾帧返回 — 连续生成的核心
    if (input.return_last_frame !== undefined) body.return_last_frame = input.return_last_frame;

    // 相机控制
    if (input.camera_fixed !== undefined) body.camera_fixed = input.camera_fixed;

    // 样片模式
    if (input.draft) body.draft = true;

    // 离线推理
    if (input.service_tier) body.service_tier = input.service_tier;
    if (input.execution_expires_after !== undefined) {
      body.execution_expires_after = input.execution_expires_after;
    }

    // Webhook 回调
    if (input.callback_url) body.callback_url = input.callback_url;

    return body;
  }

  /**
   * 文生视频 / 图生视频（同步）
   */
  async generateVideo(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
  ): Promise<VideoGenResult> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const body = this.buildVideoBody(input, cfg);

    const taskId = await this.createVideoTask(baseURL, cfg, body);
    const result = await this.pollVideoTask(baseURL, cfg, taskId);

    const videoUrl: string = result?.content?.video_url || '';
    if (!videoUrl) {
      throw new Error('视频生成完成但未返回有效 URL');
    }

    // 提取尾帧 URL（如果请求了 return_last_frame）
    const lastFrameUrl: string | undefined = result?.content?.last_frame_url;

    return {
      contentBlocks: [{
        type: 'video',
        mimeType: 'video/mp4',
        data: '',
        url: videoUrl,
      }],
      videoUrl,
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
    };
  }

  // ============================================================
  // 视频异步任务管理（公开，供 QueryVideoTaskTool / CancelVideoTaskTool 调用）
  // ============================================================

  /** 提交视频生成任务（异步模式入口）*/
  async submitVideoTask(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<string> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const body = this.buildVideoBody(input, cfg);
    return this.createVideoTask(baseURL, cfg, body);
  }

  /** 提交视频生成任务（内部 — 返回 Ark task_id）*/
  async createVideoTask(
    baseURL: string,
    cfg: ToolMediaGenConfig,
    body: Record<string, unknown>,
  ): Promise<string> {
    const data = await apiPost(
      `${baseURL}/contents/generations/tasks`,
      cfg,
      body,
      cfg.pollTimeout || 600_000,
    );
    if (data?.id) return data.id;
    throw new Error('视频生成任务提交失败：未返回任务 ID');
  }

  /** 查询视频任务状态（公开）*/
  async queryVideoTask(taskId: string, cfg: ToolMediaGenConfig): Promise<VideoTaskStatus> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    try {
      const data = await apiGet(
        `${baseURL}/contents/generations/tasks/${taskId}`,
        cfg,
        30_000,
      );
      return {
        taskId,
        status: data?.status || 'running',
        videoUrl: data?.content?.video_url || undefined,
        error: data?.error || undefined,
      };
    } catch (err: any) {
      return { taskId, status: 'failed', error: err.message };
    }
  }

  /** 取消视频任务（公开）*/
  async cancelVideoTask(taskId: string, cfg: ToolMediaGenConfig): Promise<{ cancelled: boolean }> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    try {
      await apiDelete(`${baseURL}/contents/generations/tasks/${taskId}`, cfg);
      return { cancelled: true };
    } catch (err: any) {
      throw new Error(`取消视频任务失败: ${err.message}`);
    }
  }

  /** 轮询等待视频任务完成（内部使用 — 同步 generateVideo 调用）*/
  private async pollVideoTask(
    baseURL: string,
    cfg: ToolMediaGenConfig,
    taskId: string,
  ): Promise<any> {
    const interval = cfg.pollInterval || 5000;
    const timeout = cfg.pollTimeout || 600_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const status = await apiGet(
        `${baseURL}/contents/generations/tasks/${taskId}`,
        cfg,
        30_000,
      );
      if (status?.status === 'succeeded') {
        return status;
      }
      if (status?.status === 'failed') {
        throw new Error(status?.error || '视频生成任务失败');
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`视频生成超时 (${timeout / 1000}s)`);
  }

  // ============================================================
  // 文生音频 / TTS 语音合成
  // ============================================================

  /**
   * 文生音频 / TTS 语音合成
   *
   * OpenAI TTS 兼容格式，POST {baseURL}/audio/speech
   * 支持多种音色和纯音乐模式
   */
  async generateAudio(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
  ): Promise<ContentBlockResult[]> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const model = input.model || cfg.model || 'doubao-tts';
    const voice = input.voice || 'zh_female_qingxin';
    const format = input.output_format || 'mp3';

    const body: Record<string, unknown> = {
      model,
      input: input.prompt,
      voice,
      response_format: format,
    };

    if (input.instrumental) {
      body.instrumental = true;
    }

    try {
      const data = await apiPost(`${baseURL}/audio/speech`, cfg, body, 120_000);

      // 同步返回: b64_json 或 url
      if (data?.data?.[0]?.b64_json) {
        return [{
          type: 'audio',
          mimeType: `audio/${format}`,
          data: data.data[0].b64_json,
        }];
      }
      if (data?.data?.[0]?.url) {
        return [{
          type: 'audio',
          mimeType: `audio/${format}`,
          data: '',
          url: data.data[0].url,
        }];
      }
      // 某些实现直接返回 audio base64
      if (data?.audio) {
        return [{
          type: 'audio',
          mimeType: `audio/${format}`,
          data: typeof data.audio === 'string' ? data.audio : '',
        }];
      }

      throw new Error('音频生成响应格式异常');
    } catch (err: any) {
      throw new Error(`音频生成失败: ${err.message}`);
    }
  }
}
