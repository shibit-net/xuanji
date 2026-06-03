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
  /** 视频尾帧图片 URL（return_last_frame=true 时返回，用于连续生成） */
  lastFrameUrl?: string;
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

// ============================================================
// Image Reference — 支持首帧/尾帧角色标注
// ============================================================
export interface ImageRef {
  url: string;                       // 图片 URL 或 base64
  role?: 'first_frame' | 'last_frame'; // 首尾帧模式角色标注
}

/**
 * 媒体生成输入参数（由 LLM tool_use 传入）
 */
export interface MediaGenInput {
  prompt: string;
  model?: string;

  // ---- 图片生成专用 ----
  size?: string;                         // "1K" | "2K" | "4K" 或 "宽x高"（如 "2048x2048"）
  n?: number;                            // 生成数量
  reference_images?: string[];           // 参考图 (base64，最多2张) — 已废弃，请用 image
  image?: string | string[];             // 参考图：单张或多张 URL/base64。Seedream 支持最多14张
  output_format?: string;                // "png" | "jpeg"（仅 5.0；4.0/4.5 固定 jpeg）
  response_format?: string;             // "url" | "b64_json"，默认 url
  sequential_image_generation?: string;  // "disabled"(默认) | "auto" — 组图模式
  max_images?: number;                   // 组图模式下的图片数量
  source_image?: string;                 // 编辑源图
  mask?: string;                         // 编辑蒙版

  // ---- 视频生成专用 ----
  duration?: number;                     // 视频时长（秒）。2.0: 4-15, 1.5 pro: 4-12, 1.0: 2-12。设 -1 智能选择
  style?: string;                        // 视觉风格（如 cinematic, anime, realistic）
  resolution?: string;                   // "480p" | "720p" | "1080p"。默认 720p
  ratio?: string;                        // "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive"
  seed?: number;                         // 随机种子。固定 seed 可复现相同结果
  generate_audio?: boolean;              // 是否生成音画同步视频。2.0 / 1.5 pro 支持
  return_last_frame?: boolean;           // 是否返回视频尾帧 URL。连续生成的核心参数
  camera_fixed?: boolean;                // 是否固定机位。默认 false（运镜）
  watermark?: boolean;                   // 是否加水印。默认 false
  draft?: boolean;                       // 样片模式，仅 1.5 pro。生成低成本预览
  service_tier?: string;                 // "default"(在线) | "flex"(离线推理，价格50%)
  execution_expires_after?: number;      // 任务超时（秒），默认 172800（48h），仅 flex 模式
  callback_url?: string;                 // Webhook 回调地址

  // ---- 通用 ----
  web_search?: boolean;                  // 联网搜索，仅 Seedream 5.0 lite
  optimize_prompt?: string;              // "standard"(默认) | "fast" — 仅 Seedream 4.0 支持 fast

  // ---- 音频生成专用 ----
  voice?: string;                        // 音频语音
  instrumental?: boolean;                // 是否纯音乐
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
