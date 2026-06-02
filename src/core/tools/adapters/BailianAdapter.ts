// ============================================================
// 媒体生成适配器 — 阿里云百炼 (千问)
// ============================================================

import type { ToolMediaGenConfig } from '@/shared/types/config';
import type { PlatformAdapter, ContentBlockResult, MediaGenInput, VideoGenResult, VideoTaskStatus } from './PlatformAdapter';
import { apiPost, apiGet, apiDelete, parseB64Images, resolveSize } from './adapter-utils';

/**
 * 阿里云百炼 / 千问适配器
 *
 * 文生图: POST {baseURL}/images/generations，OpenAI 兼容格式
 * 图片编辑: 支持 repaint / background / expand / erase / style 等多种操作
 * 文生视频: 异步任务模式，提交 → 轮询 → 获取视频 URL
 * 文生音频: TTS 语音合成，OpenAI TTS 兼容格式
 *
 * 相比豆包，千问图片编辑支持更多操作类型。
 */
export class BailianAdapter implements PlatformAdapter {
  readonly name = 'bailian';
  readonly defaultBaseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

  /**
   * 文生图
   *
   * 使用通义万相 (wanx) 或 qwen 图像生成模型
   */
  async generateImage(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
  ): Promise<ContentBlockResult[]> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const n = Math.max(1, Math.min(input.n || 1, 4));
    const body = {
      model: input.model || cfg.model || 'wanx2.0-t2i-turbo',
      prompt: input.prompt,
      size: resolveSize(input.size || cfg.defaultSize),
      n,
      response_format: 'b64_json',
      ...(input.reference_images?.length
        ? { image: input.reference_images.slice(0, 2) }
        : {}),
    };
    const data = await apiPost(`${baseURL}/images/generations`, cfg, body);
    return parseB64Images(data);
  }

  /**
   * 图片编辑
   *
   * 千问支持多种编辑操作：
   * - repaint: 局部重绘（需 mask）
   * - background: 背景替换
   * - expand: 画面扩展
   * - erase: 物体擦除
   * - style: 风格迁移
   */
  async editImage(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
    operation: string,
  ): Promise<ContentBlockResult[]> {
    const validOps = ['repaint', 'background', 'expand', 'erase', 'style'];
    if (!validOps.includes(operation)) {
      throw new Error(
        `千问平台不支持 ${operation} 操作。支持: ${validOps.join(', ')}`,
      );
    }

    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const body: Record<string, unknown> = {
      model: input.model || cfg.model || 'wanx2.0-t2i-turbo',
      prompt: input.prompt,
      response_format: 'b64_json',
      operation,
    };

    if (input.source_image) {
      body.image = [input.source_image];
    }
    if (input.mask && operation === 'repaint') {
      body.mask = input.mask;
    }

    const data = await apiPost(`${baseURL}/images/generations`, cfg, body);
    return parseB64Images(data);
  }

  /**
   * 文生视频 / 图生视频
   *
   * 使用通义万相视频模型，异步任务模式
   */
  async generateVideo(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
  ): Promise<VideoGenResult> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const model = input.model || cfg.model || 'wanx2.0-t2v-turbo';
    const duration = input.duration || cfg.defaultDuration || 5;

    const createBody: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      size: resolveSize(input.size || cfg.defaultSize),
      n: Math.max(1, Math.min(input.n || 1, 2)),
      duration,
      response_format: 'url',
    };

    if (input.style) {
      createBody.style = input.style;
    }
    if (input.reference_images?.length) {
      createBody.image = input.reference_images.slice(0, 1);
    }

    // 提交异步任务
    const taskData = await apiPost(
      `${baseURL}/videos/generations`,
      cfg,
      createBody,
      cfg.pollTimeout || 600_000,
    );

    const taskId = taskData?.task_id || taskData?.id;
    if (!taskId) {
      // 非异步模式：直接返回结果
      if (taskData?.data?.[0]?.url || taskData?.video_url) {
        const url = taskData?.data?.[0]?.url || taskData?.video_url;
        return {
          contentBlocks: [{ type: 'video', mimeType: 'video/mp4', data: '', url }],
          videoUrl: url,
        };
      }
      throw new Error('视频生成任务提交失败：未返回 task_id');
    }

    // 轮询任务状态
    const interval = cfg.pollInterval || 5000;
    const timeout = cfg.pollTimeout || 600_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const statusData = await apiGet(
        `${baseURL}/videos/generations/${taskId}`,
        cfg,
        30_000,
      );
      if (statusData?.status === 'succeeded' || statusData?.data?.[0]?.url) {
        const url = statusData?.data?.[0]?.url || statusData?.video_url || '';
        if (!url) throw new Error('视频生成完成但未返回有效 URL');
        return {
          contentBlocks: [{ type: 'video', mimeType: 'video/mp4', data: '', url }],
          videoUrl: url,
        };
      }
      if (statusData?.status === 'failed') {
        throw new Error(statusData?.error || '视频生成任务失败');
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`视频生成超时 (${timeout / 1000}s)`);
  }

  // ============================================================
  // 视频异步任务管理
  // ============================================================

  /** 提交视频任务（异步 — 仅提交，返回 task_id）*/
  async submitVideoTask(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<string> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const model = input.model || cfg.model || 'wanx2.0-t2v-turbo';
    const createBody: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      size: resolveSize(input.size || cfg.defaultSize),
      n: Math.max(1, Math.min(input.n || 1, 2)),
      duration: input.duration || cfg.defaultDuration || 5,
      response_format: 'url',
    };
    if (input.style) createBody.style = input.style;
    if (input.reference_images?.length) createBody.image = input.reference_images.slice(0, 1);

    const taskData = await apiPost(
      `${baseURL}/videos/generations`,
      cfg,
      createBody,
      cfg.pollTimeout || 600_000,
    );
    const taskId = taskData?.task_id || taskData?.id;
    if (!taskId) throw new Error('视频任务提交失败：未返回 task_id');
    return taskId;
  }

  /** 查询视频任务状态 */
  async queryVideoTask(taskId: string, cfg: ToolMediaGenConfig): Promise<VideoTaskStatus> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    try {
      const data = await apiGet(
        `${baseURL}/videos/generations/${taskId}`,
        cfg,
        30_000,
      );
      const status = data?.status || 'running';
      const url = data?.data?.[0]?.url || data?.video_url || undefined;
      return { taskId, status, videoUrl: url, error: data?.error || undefined };
    } catch (err: any) {
      return { taskId, status: 'failed', error: err.message };
    }
  }

  /** 取消视频任务 */
  async cancelVideoTask(taskId: string, cfg: ToolMediaGenConfig): Promise<{ cancelled: boolean }> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    try {
      await apiDelete(`${baseURL}/videos/generations/${taskId}`, cfg);
      return { cancelled: true };
    } catch (err: any) {
      throw new Error(`取消视频任务失败: ${err.message}`);
    }
  }

  /**
   * 文生音频 / TTS 语音合成
   *
   * 使用 cosyvoice 或 qwen-tts 模型
   */
  async generateAudio(
    input: MediaGenInput,
    cfg: ToolMediaGenConfig,
  ): Promise<ContentBlockResult[]> {
    const baseURL = cfg.baseURL || this.defaultBaseURL;
    const model = input.model || cfg.model || 'cosyvoice-v1';
    const voice = input.voice || 'longxiaochun';
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
