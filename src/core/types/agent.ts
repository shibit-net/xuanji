// ============================================================
// Agent 核心类型定义
// ============================================================

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
