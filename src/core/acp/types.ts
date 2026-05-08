/**
 * ACP（Agent Communication Protocol）— 进程间 Agent 通信协议
 *
 * 主进程通过 child_process.fork() 启动子进程运行子 Agent，
 * 子进程的 AgentLoop 事件通过 stdin/stdout JSON 消息流回主进程。
 */

// ── 主进程 → 子进程（请求） ──────────────────────────

export interface AcpRunRequest {
  type: 'run';
  requestId: string;
  payload: {
    /** Agent ID 或角色名 */
    agentId: string;
    /** 任务描述 */
    task: string;
    /** 系统提示词 */
    systemPrompt?: string;
    /** 场景 prompt */
    scenePrompt?: string;
    /** 允许的工具列表 */
    tools?: string[];
    /** 超时（毫秒） */
    timeout?: number;
    /** 最大迭代次数 */
    maxIterations?: number;
    /** 工作目录 */
    workingDir?: string;
    /** 父 agent 配置（model, apiKey, baseURL 等） */
    parentConfig?: {
      model?: string;
      apiKey?: string;
      baseURL?: string;
      maxTokens?: number;
      temperature?: number;
    };
  };
}

export interface AcpCancelRequest {
  type: 'cancel';
  requestId: string;
}

export type AcpRequest = AcpRunRequest | AcpCancelRequest;

// ── 子进程 → 主进程（响应 + 事件流） ────────────────

export interface AcpRunResult {
  type: 'result';
  requestId: string;
  payload: {
    success: boolean;
    output: string;
    duration: number;
    tokensUsed: { input: number; output: number };
    iterations: number;
    timedOut: boolean;
    error?: string;
  };
}

export interface AcpError {
  type: 'error';
  requestId: string;
  payload: { message: string };
}

/** 子 agent 流式事件 */
export interface AcpEvent {
  type: 'event';
  requestId: string;
  payload: {
    eventType: 'text' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_delta';
    data: any;
  };
}

export type AcpMessage = AcpRunResult | AcpError | AcpEvent;

// ── 进程管理配置 ────────────────────────────────────

export interface AcpProcessConfig {
  /** 子进程可执行路径（默认 fork 当前入口） */
  workerPath?: string;
  /** 最大并发子进程数 */
  maxConcurrent: number;
  /** 子进程空闲超时后自动终止（毫秒） */
  idleTimeoutMs: number;
}

export const DEFAULT_ACP_CONFIG: AcpProcessConfig = {
  maxConcurrent: 3,
  idleTimeoutMs: 300_000, // 5 分钟
};
