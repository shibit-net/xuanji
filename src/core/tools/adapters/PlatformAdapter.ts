// ============================================================
// 媒体生成平台适配器 — 接口定义
// ============================================================

import type { ToolMediaGenConfig } from '@/shared/types/config';

/**
 * 内容块结果（扁平格式，与 ToolResult.contentBlocks 兼容）
 */
export interface ContentBlockResult {
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  /** base64 编码数据，过大时为空字符串 */
  data: string;
  /** 远程 URL（图片前端直接渲染，视频/音频通过 send_file_to_user 投递） */
  url?: string;
}

/**
 * 视频生成结果（含独立 videoUrl 字段用于投递）
 */
export interface VideoGenResult {
  contentBlocks: ContentBlockResult[];
  /** 视频远程 URL */
  videoUrl: string;
}

/**
 * 视频任务状态
 */
export interface VideoTaskStatus {
  taskId: string;
  status: 'submitted' | 'running' | 'succeeded' | 'failed';
  progress?: number;          // 0-100
  videoUrl?: string;          // 成功时返回
  error?: string;             // 失败时返回
}

/**
 * 媒体生成输入参数（由 LLM tool_use 传入）
 */
export interface MediaGenInput {
  prompt: string;
  model?: string;
  size?: string;               // "1K" | "2K" | "4K"
  n?: number;                  // 生成数量 (1-4)
  reference_images?: string[]; // 参考图 (base64，最多2张)
  output_format?: string;      // "png" | "jpg" | "webp"
  source_image?: string;       // 编辑源图
  mask?: string;               // 编辑蒙版
  duration?: number;           // 视频/音频时长（秒）
  style?: string;              // 视频风格
  voice?: string;              // 音频语音
  instrumental?: boolean;      // 是否纯音乐
}

/**
 * 平台适配器接口
 * 所有平台差异封装在接口后面，加新平台只需实现此接口
 */
export interface PlatformAdapter {
  /** 平台唯一标识 */
  readonly name: string;
  /** 默认 API 端点 */
  readonly defaultBaseURL: string;

  /** 文生图 */
  generateImage(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<ContentBlockResult[]>;
  /** 图片编辑 */
  editImage(input: MediaGenInput, cfg: ToolMediaGenConfig, operation: string): Promise<ContentBlockResult[]>;
  /** 文生视频（同步 — 提交 + 轮询等待） */
  generateVideo(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<VideoGenResult>;
  /** 提交视频任务（异步 — 仅提交，返回 task_id） */
  submitVideoTask(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<string>;
  /** 查询视频任务状态 */
  queryVideoTask(taskId: string, cfg: ToolMediaGenConfig): Promise<VideoTaskStatus>;
  /** 取消视频任务 */
  cancelVideoTask(taskId: string, cfg: ToolMediaGenConfig): Promise<{ cancelled: boolean }>;
  /** 文生音频 */
  generateAudio(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<ContentBlockResult[]>;
}
