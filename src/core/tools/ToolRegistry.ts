// ============================================================
// M6 工具系统 — 工具注册表
// ============================================================

import type { Tool, ToolResult, ToolSchema, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { ReadTool } from './ReadTool';
import { WriteTool } from './WriteTool';
import { EditTool } from './EditTool';
import { BashTool } from './BashTool';
import { GlobTool } from './GlobTool';
import { GrepTool } from './GrepTool';
import { PlanReviewTool } from './PlanReviewTool';
import { AskUserTool } from './AskUserTool';
import { TaskOutputTool } from './TaskOutputTool';
import { WebFetchTool } from './WebFetchTool';
import { TodoStorageTool } from './TodoStorageTool';
import { TodoListTool } from './TodoListTool';
import { TodoUpdateTool } from './TodoUpdateTool';
import { SleepTool } from './SleepTool';
import { EnterPlanModeTool } from './EnterPlanModeTool';
import { ExitPlanModeTool } from './ExitPlanModeTool';
import { NotebookEditTool } from './NotebookEditTool';
import { WorktreeTool } from './WorktreeTool';
import { LSTool } from './LSTool';
import { MultiEditTool } from './MultiEditTool';
// TeamTool 和 QuickTeamTool 在 ChatSession.initTaskTool() 中动态注册
import { getToolTimeouts } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';

/** 工具执行默认超时（5 分钟） */
const DEFAULT_TOOL_TIMEOUT = 300_000;

/**
 * 工具注册表
 * 管理所有已注册工具，提供发现和执行能力
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private permissionController?: IPermissionController;
  private _planMode: boolean = false;

  /**
   * 注入权限控制器 (可选)
   */
  setPermissionController(controller: IPermissionController): void {
    this.permissionController = controller;
    // 同步注入到 PlanReviewTool
    const planTool = this.tools.get('plan_review');
    if (planTool && planTool instanceof PlanReviewTool) {
      (planTool as PlanReviewTool).setPermissionController(controller);
    }
  }

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具已注册: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 注销工具
   */
  unregister(name: string): void {
    this.tools.delete(name);
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
  }

  /**
   * 退出 Plan Mode
   */
  exitPlanMode(): void {
    this._planMode = false;
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
  async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `未知工具: ${name}`,
        isError: true,
      };
    }

    // 如果外部已中止，直接返回
    if (signal?.aborted) {
      return { content: '[Aborted] Tool execution was cancelled.', isError: true };
    }

    // 📋 Plan Mode 检查：拦截写操作
    if (this._planMode) {
      const isWrite = 'isWriteOperation' in tool
        ? (tool as { isWriteOperation(): boolean }).isWriteOperation()
        : !tool.readonly;

      if (isWrite) {
        return {
          content: `[Plan Mode] 写操作被拦截: ${name}。使用 /exit-plan 退出 Plan Mode 后再执行。`,
          isError: true,
          metadata: { planModeBlocked: true },
        };
      }
    }

    // 🔐 权限检查
    if (this.permissionController) {
      const request = {
        requestId: `${name}-${Date.now()}`,
        toolName: name,
        input,
      };
      const perm = await this.permissionController.check(request);
      if (!perm.allowed) {
        return {
          content: `[Permission Denied] ${perm.reason ?? '操作被拒绝'}`,
          isError: true,
          metadata: { permissionDenied: true },
        };
      }
    }

    try {
      const timeout = (tool as { timeout?: number }).timeout ?? getToolTimeouts()?.default ?? DEFAULT_TOOL_TIMEOUT;
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeout);

      // 链式中止：外部 signal 中止时，自动中止此工具的 controller
      const onAbort = () => abortController.abort();
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const result = await Promise.race([
          tool.execute(input, abortController.signal),
          new Promise<ToolResult>((_, reject) => {
            abortController.signal.addEventListener('abort', () => {
              // 区分超时中止 vs 外部中止
              if (signal?.aborted) {
                reject(new Error(`工具 "${name}" 被外部中止`));
              } else {
                reject(new Error(`工具 "${name}" 执行超时 (${Math.round(timeout / 1000)}s)`));
              }
            });
          }),
        ]);
        return result;
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
      }
    } catch (err) {
      // 外部中止（用户 Ctrl+C / stop()）时返回友好的中止消息
      if (signal?.aborted) {
        return { content: '[Aborted] Tool execution was cancelled.', isError: true };
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.child({ module: 'ToolRegistry' }).warn(`Tool "${name}" execution error: ${message}`);
      return {
        content: `工具执行异常: ${message}`,
        isError: true,
      };
    }
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
  registry.register(new PlanReviewTool());
  registry.register(new AskUserTool());
  registry.register(new TaskOutputTool());
  registry.register(new WebFetchTool());
  registry.register(new TodoStorageTool());
  registry.register(new TodoListTool());
  registry.register(new TodoUpdateTool());
  registry.register(new SleepTool());
  registry.register(new EnterPlanModeTool());
  registry.register(new ExitPlanModeTool());
  registry.register(new NotebookEditTool());
  registry.register(new WorktreeTool());
  registry.register(new LSTool());
  registry.register(new MultiEditTool());
  // TeamTool 和 QuickTeamTool 在 ChatSession.initTaskTool() 中动态注册（需要注入依赖）
  return registry;
}
