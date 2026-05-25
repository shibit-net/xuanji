// ============================================================
// LLM Provider 类型定义
// ============================================================

import type { Message, TokenUsage } from './agent';
import type { ToolCall, ToolSchema } from './tools';

/**
 * 流事件类型
 */
export type StreamEventType =
  | 'text_delta'
  | 'thinking_start'
  | 'thinking_delta'
  | 'reasoning_delta'
  | 'image_delta'
  | 'tool_use_start'
  | 'tool_use_delta'
  | 'tool_use_end'
  | 'usage'
  | 'end'
  | 'error';

/**
 * 停止原因
 */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'interrupted';

/**
 * 流事件
 */
export interface StreamEvent {
  type: StreamEventType;
  /** 文本增量 */
  text?: string;
  /** 思考增量 */
  thinking?: string;
  /** thinking 块签名（Anthropic API 要求传回） */
  signature?: string;
  /** 推理增量（DeepSeek thinking 模式） */
  reasoning?: string;
  /** 图片增量（模型生成的图片，GPT-4o 等） */
  image?: {
    /** base64 编码的图片数据 */
    data?: string;
    /** MIME 类型 */
    mimeType?: string;
    /** 远程图片 URL */
    imageUrl?: string;
  };
  /** 工具调用信息 */
  toolCall?: Partial<ToolCall>;
  /** Token 用量 */
  usage?: TokenUsage;
  /** 停止原因 */
  stopReason?: StopReason;
  /** 错误信息 */
  error?: Error;
}

/**
 * Extended Thinking 配置（Anthropic Claude 4.5+）
 */
export interface ThinkingConfig {
  /** 模式：adaptive（自适应深度）或 enabled（固定 token 预算） */
  type: 'adaptive' | 'enabled';
  /** adaptive 模式的深度等级（low/medium/high） */
  effort?: 'low' | 'medium' | 'high';
  /** enabled 模式的 token 预算 */
  budgetTokens?: number;
}

/**
 * Provider 配置
 */
export interface ProviderConfig {
  /** 模型标识 */
  model: string;
  /** Extended Thinking 配置（Anthropic Claude 4.5+，可选） */
  thinking?: ThinkingConfig;
  /** 最大输出 token（不设置则由 API 端决定） */
  maxTokens?: number;
  /** 温度参数 */
  temperature?: number;
  /** 请求超时时间 (ms) */
  timeout?: number;
  /** API Key */
  apiKey?: string;
  /** API Base URL */
  baseURL?: string;
  /** 指定 Provider 适配器（anthropic / openai / openai-responses），不指定则按模型名自动匹配 */
  adapter?: string;
  /** 🔧 AbortSignal：用于取消正在进行的请求 */
  signal?: AbortSignal;
  /** 上下文窗口大小（tokens），仅本地模型使用 */
  contextSize?: number;
}

/**
 * LLM Provider 接口
 */
export interface ILLMProvider {
  /** Provider 名称 */
  readonly name: string;
  /** 支持的模型列表 */
  readonly models: string[];

  /**
   * 流式调用 LLM
   * @param messages 消息数组
   * @param tools 工具 Schema 列表
   * @param config Provider 配置
   * @returns 流事件异步迭代器
   */
  stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig
  ): AsyncIterable<StreamEvent>;

  /**
   * 检查模型是否受支持
   */
  isSupported(model: string): boolean;
}

/**
 * 重试策略配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟 (ms) */
  initialDelay: number;
  /** 最大延迟 (ms) */
  maxDelay: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 可重试的 HTTP 状态码 */
  retryableStatusCodes: number[];
}
