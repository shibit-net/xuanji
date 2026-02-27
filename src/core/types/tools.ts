// ============================================================
// 工具系统类型定义
// ============================================================

/**
 * JSON Schema 类型 (工具输入参数描述)
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string }>;
  required?: string[];
  description?: string;
  enum?: string[];
  items?: JSONSchema;
  default?: unknown;
}

/**
 * 工具 Schema (提交给 LLM API 的工具描述)
 */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

/**
 * 工具接口
 */
export interface Tool {
  /** 工具唯一名称 */
  name: string;
  /** 工具描述 (给 LLM 看的) */
  description: string;
  /** 输入参数 JSON Schema */
  input_schema: JSONSchema;
  /**
   * 工具是否为只读（无副作用）
   * - true: 可并行执行（如 ReadTool）
   * - false: 必须串行执行（如 WriteTool, BashTool）
   * - 默认: false（保守策略）
   */
  readonly?: boolean;
  /** 执行工具 */
  execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 结果内容 */
  content: string;
  /** 是否出错 */
  isError: boolean;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 多模态内容块（如图片），用于 Vision API */
  contentBlocks?: Array<{
    type: 'image';
    source: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

/**
 * 工具调用 (来自 LLM 的 tool_use)
 */
export interface ToolCall {
  /** 调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 输入参数 */
  input: Record<string, unknown>;
}

// ============================================================
// 工具注册表接口
// ============================================================

/**
 * 工具注册表接口
 */
export interface IToolRegistry {
  /** 注册工具 */
  register(tool: Tool): void;
  /** 注销工具 */
  unregister(name: string): void;
  /** 获取工具 */
  get(name: string): Tool | undefined;
  /** 获取所有工具 */
  getAll(): Tool[];
  /** 导出工具 Schema (供 LLM API 使用) */
  getSchemas(): ToolSchema[];
  /** 检查工具是否已注册 */
  has(name: string): boolean;
  /** 执行工具 */
  execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
  /** 注入权限控制器 */
  setPermissionController?(controller: unknown): void;
  /** 进入 Plan Mode（只读模式） */
  enterPlanMode?(): void;
  /** 退出 Plan Mode */
  exitPlanMode?(): void;
  /** 查询是否处于 Plan Mode */
  isPlanMode?(): boolean;
}
