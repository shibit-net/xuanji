/**
 * Hook 系统类型定义
 */

// ─── 事件类型 ──────────────────────────────────────────

/**
 * 14 种 Hook 事件
 */
export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'
  | 'PreMemorySave'
  | 'PostMemorySave'
  | 'ErrorOccurred'
  | 'SubAgentStart'
  | 'SubAgentEnd'
  | 'SubAgentToolUse'
  | 'CheckpointCreated'
  | 'CheckpointRestored';

/**
 * 同步事件（可阻塞主流程）
 * Handler 返回 false 或抛出异常时阻塞后续执行
 */
export const SYNC_EVENTS: HookEvent[] = ['PreToolUse', 'PreMemorySave'];

/**
 * 所有已支持的事件列表
 */
export const ALL_EVENTS: HookEvent[] = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'PreMemorySave',
  'PostMemorySave',
  'ErrorOccurred',
  'SubAgentStart',
  'SubAgentEnd',
  'SubAgentToolUse',
  'CheckpointCreated',
  'CheckpointRestored',
];

// ─── Handler 类型 ──────────────────────────────────────

/**
 * Handler 类型枚举
 */
export type HookHandlerType = 'command' | 'prompt' | 'agent';

/**
 * 作用域
 */
export type HookScope = 'global' | 'parent' | 'subagent';

/**
 * 基础 Handler 配置
 */
export interface BaseHookHandler {
  /** Handler 类型 */
  type: HookHandlerType;
  /** 超时（毫秒），默认 5000 */
  timeout?: number;
  /** 作用域，默认 global */
  scope?: HookScope;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 可选的匹配条件（如只对特定工具触发） */
  match?: {
    /** 工具名称正则匹配 */
    toolName?: string;
  };
}

/**
 * Command Handler — 执行 shell 脚本
 */
export interface CommandHookHandler extends BaseHookHandler {
  type: 'command';
  /** Shell 脚本内容，支持环境变量替换（${TOOL_NAME} 等） */
  script: string;
}

/**
 * Prompt Handler — 动态注入 system prompt
 */
export interface PromptHookHandler extends BaseHookHandler {
  type: 'prompt';
  /** 注入的 prompt 内容，支持环境变量替换 */
  content: string;
}

/**
 * Agent Handler — LLM 分析（Phase 4 实现）
 */
export interface AgentHookHandler extends BaseHookHandler {
  type: 'agent';
  /** LLM 分析的 prompt */
  prompt: string;
  /** 使用的模型（可选，默认使用当前模型） */
  model?: string;
}

/**
 * 所有 Handler 联合类型
 */
export type HookHandler = CommandHookHandler | PromptHookHandler | AgentHookHandler;

// ─── 事件上下文 ────────────────────────────────────────

/**
 * 事件上下文（传递给 Handler 的数据）
 */
export interface HookEventContext {
  /** 事件名称 */
  event: HookEvent;
  /** 时间戳 */
  timestamp: number;
  /** 工具名称（PreToolUse/PostToolUse） */
  toolName?: string;
  /** 工具输入参数（PreToolUse） */
  toolInput?: Record<string, unknown>;
  /** 工具执行结果（PostToolUse） */
  toolResult?: string;
  /** 工具是否出错（PostToolUse） */
  toolIsError?: boolean;
  /** 工具执行耗时（PostToolUse） */
  toolDuration?: number;
  /** 错误信息（ErrorOccurred） */
  errorMessage?: string;
  /** 错误堆栈（ErrorOccurred） */
  errorStack?: string;
  /** 压缩前 token 数（PreCompact/PostCompact） */
  originalTokens?: number;
  /** 压缩后 token 数（PostCompact） */
  compressedTokens?: number;
  /** 会话 ID */
  sessionId?: string;
  /** checkpoint ID（CheckpointCreated/CheckpointRestored） */
  checkpointId?: string;
  /** checkpoint 标签 */
  checkpointLabel?: string;
  /** 子代理 ID（SubAgent* 事件） */
  subAgentId?: string;
  /** 记忆内容（PreMemorySave） */
  memoryContent?: string;
  /** 自定义数据 */
  data?: Record<string, unknown>;
  /** AbortSignal，Hook 超时时会触发 abort（供 Hook 实现者检测取消） */
  signal?: AbortSignal;
}

// ─── Handler 执行结果 ──────────────────────────────────

/**
 * Handler 执行结果
 */
export interface HookHandlerResult {
  /** 是否成功 */
  success: boolean;
  /** Command Handler 退出码 */
  exitCode?: number;
  /** Command Handler stdout */
  stdout?: string;
  /** Command Handler stderr */
  stderr?: string;
  /** Prompt Handler 注入的内容 */
  promptContent?: string;
  /** Agent Handler 的 LLM 分析结果（Phase 4） */
  agentResponse?: string;
  /** 错误信息 */
  error?: string;
  /** 执行耗时（毫秒） */
  duration?: number;
  /** 是否应阻塞后续执行（仅同步事件） */
  blocked?: boolean;
}

// ─── 配置结构 ──────────────────────────────────────────

/**
 * hooks.json 配置结构
 * Key 为事件名称，Value 为 Handler 数组
 */
export type HookConfig = Partial<Record<HookEvent, HookHandler[]>>;

/**
 * HookRegistry 选项
 */
export interface HookRegistryOptions {
  /** 默认超时（毫秒） */
  defaultTimeout?: number;
  /** 当前是否为子代理 */
  isSubAgent?: boolean;
  /** 是否禁用所有 hooks */
  disabled?: boolean;
}
