// ============================================================
// Agent 核心类型定义
// ============================================================

import type { RetryConfig, ThinkingConfig } from './provider';

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * 内容块类型
 */
export type ContentBlockType = 'text' | 'thinking' | 'tool_use' | 'tool_result';

/**
 * 内容块
 */
export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

/**
 * 消息
 */
export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
}

/**
 * 上下文压缩器配置
 */
export interface CompressorConfig {
  /** 是否启用压缩 */
  enabled: boolean;
  /** 保留最近 N 轮完整对话 */
  keepRecentRounds: number;
  /** 触发压缩的 token 占比（0-1） */
  compressionThreshold: number;
  /** 最少消息数才压缩 */
  minMessagesToCompress: number;
  /** 单条摘要最大长度 */
  summaryMaxLength: number;
}

/**
 * 消息分组类型
 */
export type MessageGroupType = 'conversation' | 'tool_sequence' | 'system';

/**
 * 消息分组
 */
export interface MessageGroup {
  type: MessageGroupType;
  startIndex: number;
  endIndex: number;
  messages: Message[];
}

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 压缩后的消息数组 */
  compressed: Message[];
  /** 压缩前 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 压缩率 (0-1) */
  compressionRatio: number;
  /** 人类可读的压缩报告 */
  summary: string;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 模型标识 (e.g. "claude-sonnet-4-20250514") */
  model: string;
  /** API Key */
  apiKey?: string;
  /** API Base URL (自定义端点) */
  baseURL?: string;
  /** 最大输出 token（不设置则由 API 端决定） */
  maxTokens?: number;
  /** 温度参数 */
  temperature?: number;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 最大 ReAct 循环次数 */
  maxIterations?: number;
  /** 上下文压缩器配置 */
  compressor?: Partial<CompressorConfig>;
  /** API 调用重试配置 */
  retry?: RetryConfig;
  /** Extended Thinking 配置（Anthropic Claude 4.5+） */
  thinking?: ThinkingConfig;
}

/**
 * Agent 状态
 */
export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting_input';

/**
 * Agent 运行状态
 */
export interface AgentState {
  status: AgentStatus;
  messages: Message[];
  tokenUsage: TokenUsage;
  cost: number;
  currentIteration: number;
  /** 当前使用的模型名称 */
  model?: string;
  /** 当前激活的 Skill */
  currentSkill?: {
    name: string;
    icon?: string;
  };
}

/**
 * Token 用量
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Agent 事件类型
 */
export type AgentEventType = 'text' | 'thinking' | 'tool' | 'error' | 'end';

/**
 * Agent 事件映射
 */
export interface AgentEventMap {
  text: (text: string) => void;
  thinking: (thinking: string) => void;
  tool: (toolCall: import('./tools').ToolCall, result: import('./tools').ToolResult) => void;
  error: (error: Error) => void;
  end: (state: AgentState) => void;
}
