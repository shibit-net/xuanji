/**
 * ============================================================
 * MCP (Model Context Protocol) - Type Definitions
 * ============================================================
 * 定义 MCP 协议的核心类型和接口
 * 参考: https://spec.modelcontextprotocol.io/specification/architecture/
 */

// ============================================================
// JSON-RPC 2.0 Types
// ============================================================

/**
 * JSON-RPC 2.0 请求
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

/**
 * JSON-RPC 2.0 响应（成功）
 */
export interface JSONRPCSuccessResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result: T;
}

/**
 * JSON-RPC 2.0 响应（错误）
 */
export interface JSONRPCErrorResponse {
  jsonrpc: '2.0';
  id: number | string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 响应（联合类型）
 */
export type JSONRPCResponse<T = unknown> = JSONRPCSuccessResponse<T> | JSONRPCErrorResponse;

/**
 * 判断是否为错误响应
 */
export function isJSONRPCError(response: JSONRPCResponse): response is JSONRPCErrorResponse {
  return 'error' in response;
}

// ============================================================
// MCP Tool Types
// ============================================================

/**
 * MCP 工具定义（对应 tools/list 返回值）
 */
export interface MCPTool {
  /** 工具名称（唯一标识） */
  name: string;

  /** 工具描述 */
  description?: string;

  /** 工具输入参数的 JSON Schema */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/**
 * tools/list 响应
 */
export interface ListToolsResult {
  tools: MCPTool[];
}

/**
 * tools/call 请求参数
 */
export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * tools/call 响应
 */
export interface CallToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
}

// ============================================================
// MCP Prompt Types
// ============================================================

/**
 * MCP Prompt 定义（对应 prompts/list 返回值）
 */
export interface MCPPrompt {
  /** Prompt 名称（唯一标识） */
  name: string;

  /** Prompt 描述 */
  description?: string;

  /** Prompt 参数定义 */
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * prompts/list 响应
 */
export interface ListPromptsResult {
  prompts: MCPPrompt[];
}

/**
 * prompts/get 请求参数
 */
export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

/**
 * prompts/get 响应
 */
export interface GetPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: {
      type: 'text' | 'image' | 'resource';
      text?: string;
      data?: string;
      mimeType?: string;
      [key: string]: unknown;
    };
  }>;
}

// ============================================================
// MCP Server Config
// ============================================================

/**
 * MCP 服务器配置
 */
export interface MCPServerConfig {
  /** 服务器名称（用于工具前缀，如 market:stock_price） */
  name: string;

  /** 传输类型（默认 'stdio'） */
  transport?: 'stdio' | 'sse';

  /** 启动命令（如 node）— stdio 模式必填 */
  command: string;

  /** 命令参数（如 ["/path/to/server.js"]） */
  args?: string[];

  /** 环境变量 */
  env?: Record<string, string>;

  /** 是否禁用 */
  disabled?: boolean;

  /** 工作目录 */
  cwd?: string;

  /** SSE 端点 URL — sse 模式必填 */
  sseUrl?: string;

  /** HTTP RPC 端点 URL — sse 模式必填 */
  httpUrl?: string;
}

/**
 * MCP 总配置
 */
export interface MCPConfig {
  /** MCP 服务器列表 */
  servers: MCPServerConfig[];

  /** 全局超时时间（毫秒，默认 30000） */
  timeout?: number;

  /** 全局环境变量 */
  env?: Record<string, string>;
}

// ============================================================
// MCP Server State
// ============================================================

/**
 * MCP 服务器状态
 */
export type MCPServerState =
  | 'uninitialized'  // 未初始化
  | 'starting'       // 启动中
  | 'ready'          // 就绪
  | 'error'          // 错误
  | 'closed';        // 已关闭

/**
 * MCP 服务器运行时信息
 */
export interface MCPServerRuntime {
  /** 服务器名称 */
  name: string;

  /** 配置 */
  config: MCPServerConfig;

  /** 当前状态 */
  state: MCPServerState;

  /** 进程 ID */
  pid?: number;

  /** 启动时间 */
  startedAt?: Date;

  /** 错误信息 */
  error?: string;

  /** 工具列表（缓存） */
  tools?: MCPTool[];

  /** Prompt 列表（缓存） */
  prompts?: MCPPrompt[];
}

// ============================================================
// Utility Types
// ============================================================

/**
 * MCP 客户端公共接口
 *
 * MCPClient (stdio) 和 MCPSSEClient (SSE) 都实现此接口。
 */
export interface IMCPClient {
  /** 启动连接 */
  start(): Promise<void>;
  /** 获取工具列表 */
  listTools(): Promise<MCPTool[]>;
  /** 获取 Prompt 列表 */
  listPrompts(): Promise<MCPPrompt[]>;
  /** 调用工具 */
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** 获取 Prompt */
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
  /** 关闭连接 */
  close(): Promise<void>;
  /** 获取当前状态 */
  getState(): MCPServerState;
  /** 获取服务器名称 */
  getName(): string;
  /** 获取服务器信息 */
  getServerInfo(): { name: string; version: string } | undefined;
  /** 获取服务器能力 */
  getServerCapabilities(): Record<string, unknown> | undefined;
  /** 获取当前重连尝试次数 */
  getReconnectAttempts(): number;
}

/**
 * 延迟启动的 Promise
 */
export interface LazyPromise<T> {
  /** 获取或启动 Promise */
  get: () => Promise<T>;
  /** 是否已启动 */
  started: boolean;
}
