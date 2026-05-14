// ============================================================
// M6 工具系统 — 工具注册表
// ============================================================
// 使用 MiddlewarePipeline 替代重复的横切逻辑

import type { Tool, ToolResult, ToolSchema, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import {
  MiddlewarePipeline,
  PermissionMiddleware,
  LoggingMiddleware,
  ErrorHandlingMiddleware,
  TimeoutMiddleware,
  type IMiddleware,
  type NextFunction
} from '@/infrastructure/middleware';
import { ReadTool } from './ReadTool';
import { WriteTool } from './WriteTool';
import { EditTool } from './EditTool';
import { BashTool } from './BashTool';
import { GlobTool } from './GlobTool';
import { GrepTool } from './GrepTool';
import { PlanReviewTool } from './PlanReviewTool';
import { AskUserTool } from './AskUserTool';
import { TaskOutputTool } from './TaskOutputTool';
import { EnhancedWebSearchTool } from '@/mcp/search/EnhancedWebSearchTool';
import { TodoCreateTool, TodoListTool, TodoUpdateTool, TodoClearTool } from './TodoTool';
import { TodoArchiveTool } from './TodoArchiveTool';
import { SleepTool } from './SleepTool';
import { EnterPlanModeTool } from './EnterPlanModeTool';
import { ExitPlanModeTool } from './ExitPlanModeTool';
import { NotebookEditTool } from './NotebookEditTool';
import { WorktreeTool } from './WorktreeTool';
import { LSTool } from './LSTool';
import { MultiEditTool } from './MultiEditTool';
import { MatchAgentTool } from './MatchAgentTool';
import { ListAgentsTool } from './ListAgentsTool';
import { ListScenesTool } from './ListScenesTool';
import { TaskControlTool } from './TaskControlTool';
import { ChangeDirectoryTool } from './ChangeDirectoryTool';
import { getToolTimeouts } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';

/** 工具执行默认超时（5 分钟） */
const DEFAULT_TOOL_TIMEOUT = 300_000;

/**
 * 工具执行上下文
 */
export interface ToolContext {
  toolName: string;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  timestamp: Date;
  tool: Tool;
  planMode: boolean;
}

/**
 * Plan Mode 中间件
 * 拦截写操作
 */
class PlanModeMiddleware implements IMiddleware<ToolContext, ToolResult> {
  private log = logger.child({ module: 'PlanModeMiddleware' });

  async execute(context: ToolContext, next: NextFunction<ToolResult>): Promise<ToolResult> {
    if (!context.planMode) {
      return next();
    }

    const isWrite = 'isWriteOperation' in context.tool
      ? (context.tool as { isWriteOperation(): boolean }).isWriteOperation()
      : !context.tool.readonly;

    if (isWrite) {
      this.log.warn(`Write operation blocked in Plan Mode: ${context.toolName}`);
      return {
        content: `[Plan Mode] 写操作被拦截: ${context.toolName}。使用 /exit-plan 退出 Plan Mode 后再执行。`,
        isError: true,
        metadata: { planModeBlocked: true },
      };
    }

    return next();
  }
}

/**
 * Abort 检查中间件
 * 在工具执行前检查是否已中止
 */
class AbortCheckMiddleware implements IMiddleware<ToolContext, ToolResult> {
  private log = logger.child({ module: 'AbortCheckMiddleware' });

  async execute(context: ToolContext, next: NextFunction<ToolResult>): Promise<ToolResult> {
    if (context.signal?.aborted) {
      this.log.warn(`Tool execution aborted before start: ${context.toolName}`);
      return {
        content: `工具执行已中止: ${context.toolName}`,
        isError: true,
        metadata: { aborted: true },
      };
    }
    return next();
  }
}

/**
 * 工具注册表
 * 管理所有已注册工具，提供发现和执行能力
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private permissionController?: IPermissionController;
  private _planMode: boolean = false;
  private pipeline: MiddlewarePipeline<ToolContext, ToolResult>;
  private log = logger.child({ module: 'ToolRegistry' });

  constructor() {
    this.pipeline = new MiddlewarePipeline<ToolContext, ToolResult>();
    this.pipeline
      .use(new ErrorHandlingMiddleware())
      .use(new LoggingMiddleware())
      .use(new TimeoutMiddleware(DEFAULT_TOOL_TIMEOUT))
      .use(new AbortCheckMiddleware())
      .use(new PlanModeMiddleware());
  }

  /**
   * 注入权限控制器 (可选)
   */
  setPermissionController(controller: IPermissionController): void {
    this.permissionController = controller;
    this.log.debug('Permission controller injected');

    // 重建 pipeline，加入 PermissionMiddleware
    this.pipeline = new MiddlewarePipeline<ToolContext, ToolResult>();
    this.pipeline
      .use(new ErrorHandlingMiddleware())
      .use(new LoggingMiddleware())
      .use(new TimeoutMiddleware(DEFAULT_TOOL_TIMEOUT))
      .use(new AbortCheckMiddleware())
      .use(new PlanModeMiddleware())
      .use(new PermissionMiddleware(controller));

    // 同步注入到 PlanReviewTool 和 AskUserTool
    const planTool = this.tools.get('plan_review');
    if (planTool && planTool instanceof PlanReviewTool) {
      (planTool as PlanReviewTool).setPermissionController(controller);
    }

    const askUserTool = this.tools.get('ask_user');
    if (askUserTool && askUserTool instanceof AskUserTool) {
      (askUserTool as AskUserTool).setPermissionController(controller);
    }
  }

  /**
   * 获取权限控制器
   */
  getPermissionController(): IPermissionController | undefined {
    return this.permissionController;
  }

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.log.warn(`Tool already registered: ${tool.name}`);
      throw new Error(`工具已注册: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.log.debug(`Tool registered: ${tool.name}`);
  }

  /**
   * 注销工具
   */
  unregister(name: string): void {
    if (this.tools.delete(name)) {
      this.log.debug(`Tool unregistered: ${name}`);
    }
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有已注册工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 导出工具 Schema 列表 (提供给 LLM API)
   */
  getSchemas(): ToolSchema[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  /**
   * 检查工具是否已注册
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  // ─── Plan Mode ─────────────────────────────────────

  /**
   * 进入 Plan Mode（只读模式）
   */
  enterPlanMode(): void {
    this._planMode = true;
    this.log.info('Entered Plan Mode (read-only)');
  }

  /**
   * 退出 Plan Mode
   */
  exitPlanMode(): void {
    this._planMode = false;
    this.log.info('Exited Plan Mode');
  }

  /**
   * 是否处于 Plan Mode
   */
  isPlanMode(): boolean {
    return this._planMode;
  }

  /**
   * 克隆注册表（排除指定工具，用于子代理）
   */
  cloneForSubAgent(excludeTools: string[] = []): ToolRegistry {
    const cloned = new ToolRegistry();
    const excludeSet = new Set(excludeTools);

    for (const [name, tool] of this.tools) {
      if (!excludeSet.has(name)) {
        cloned.tools.set(name, tool);
      }
    }

    // 复制权限控制器
    if (this.permissionController) {
      cloned.setPermissionController(this.permissionController);
    }

    return cloned;
  }

  /**
   * 执行工具
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.log.error(`Tool not found: ${toolName}`);
      return {
        content: `工具未找到: ${toolName}`,
        isError: true,
      };
    }

    // 获取工具特定的超时配置
    const timeouts = getToolTimeouts();
    let toolTimeout = DEFAULT_TOOL_TIMEOUT;

    if (timeouts) {
      // 优先使用工具特定的超时配置
      if (toolName === 'agent_team' && timeouts.agent_team) {
        toolTimeout = timeouts.agent_team;
      } else if (toolName === 'task' && timeouts.task) {
        toolTimeout = timeouts.task;
      } else if (toolName === 'bash' && timeouts.bash) {
        toolTimeout = timeouts.bash;
      } else if (toolName === 'web_search' && timeouts.webFetch) {
        toolTimeout = timeouts.webFetch;
      } else if (toolName === 'web_fetch' && timeouts.webFetch) {
        toolTimeout = timeouts.webFetch;
      } else if (toolName === 'ask_user' || toolName === 'plan_review' || toolName === 'enter_plan_mode' || toolName === 'exit_plan_mode') {
        toolTimeout = timeouts.interactive ?? 1800000; // 默认 30 分钟
      } else if (timeouts.default) {
        toolTimeout = timeouts.default;
      }
    }

    const context: ToolContext = {
      toolName,
      input,
      signal,
      timestamp: new Date(),
      tool,
      planMode: this._planMode,
    };

    // 为此次执行创建临时的 pipeline，使用工具特定的超时
    // agent_team 内部有自己的超时控制，工具级不再叠加
    const tempPipeline = new MiddlewarePipeline<ToolContext, ToolResult>();
    tempPipeline
      .use(new ErrorHandlingMiddleware())
      .use(new LoggingMiddleware());

    if (toolName !== 'agent_team') {
      tempPipeline.use(new TimeoutMiddleware(toolTimeout));
    }

    tempPipeline
      .use(new AbortCheckMiddleware())
      .use(new PlanModeMiddleware());

    if (this.permissionController) {
      tempPipeline.use(new PermissionMiddleware(this.permissionController));
    }

    return tempPipeline.execute(context, async () => {
      return tool.execute(input, signal);
    });
  }
}

/**
 * 创建默认工具注册表 (包含 P0 阶段 6 个核心工具)
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadTool());
  registry.register(new WriteTool());
  registry.register(new EditTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new ChangeDirectoryTool());
  registry.register(new PlanReviewTool());
  registry.register(new AskUserTool());
  registry.register(new TaskOutputTool());
  registry.register(new TodoCreateTool());
  registry.register(new TodoListTool());
  registry.register(new TodoUpdateTool());
  registry.register(new TodoClearTool());
  registry.register(new TodoArchiveTool());
  registry.register(new SleepTool());
  registry.register(new EnterPlanModeTool());
  registry.register(new ExitPlanModeTool());
  registry.register(new NotebookEditTool());
  registry.register(new WorktreeTool());
  registry.register(new LSTool());
  registry.register(new MultiEditTool());
  registry.register(new TaskControlTool());
  // 注册统一 web_search 工具（替代原来的 web_fetch）
  registry.register(new EnhancedWebSearchTool());
  // TaskTool, TeamTool, MatchAgentTool, ListAgentsTool 在 SessionFactory.registerAdvancedTools() 中动态注册（需要注入依赖）
  return registry;
}
