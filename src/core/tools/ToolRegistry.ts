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

/**
 * 工具注册表
 * 管理所有已注册工具，提供发现和执行能力
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private permissionController?: IPermissionController;

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

  /**
   * 执行工具
   */
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `未知工具: ${name}`,
        isError: true,
      };
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
      return await tool.execute(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
  return registry;
}
