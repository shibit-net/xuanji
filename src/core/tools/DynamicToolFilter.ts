// ============================================================
// M6 工具系统 — 动态工具过滤器（已废弃场景过滤）
// ============================================================
//
// @deprecated 场景不再控制工具可用性，此类现在仅作为透传包装器。
// 所有工具对 LLM 可见，权限由 PermissionController 统一管控。
// 保留此类以向后兼容，将在下一大版本移除。

import type { IToolRegistry, Tool, ToolSchema, ToolResult } from '@/core/types';
import type { SceneType } from '@/core/prompt/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DynamicToolFilter' });

/**
 * 动态工具过滤器（已废弃场景过滤功能）
 *
 * 职责：
 * 1. 作为 ToolRegistry 的透传包装器，实现 IToolRegistry 接口
 * 2. setScene() 已废弃为无操作，不再过滤工具
 * 3. 所有方法直接透传给底层 registry
 */
export class DynamicToolFilter implements IToolRegistry {
  private baseRegistry: IToolRegistry;

  constructor(registry: IToolRegistry) {
    this.baseRegistry = registry;
    log.debug('DynamicToolFilter initialized (scene filtering disabled)');
  }

  /**
   * @deprecated 场景不再控制工具可用性，此方法已废弃为无操作。
   * 工具可用性现在完全由权限系统统一管控。
   */
  setScene(_scene: SceneType, _extraTools?: string[]): void {
    log.debug('[DEPRECATED] setScene() called but scene filtering is disabled. All tools are available.');
  }

  // ===== 实现 IToolRegistry 接口（直接透传） =====

  getSchemas(): ToolSchema[] {
    return this.baseRegistry.getSchemas();
  }

  get(name: string): Tool | undefined {
    return this.baseRegistry.get(name);
  }

  getAll(): Tool[] {
    return this.baseRegistry.getAll();
  }

  has(name: string): boolean {
    return this.baseRegistry.has(name);
  }

  async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    return this.baseRegistry.execute(name, input, signal);
  }

  register(tool: Tool): void {
    throw new Error('Cannot register tools through DynamicToolFilter. Use baseRegistry instead.');
  }

  unregister(name: string): void {
    throw new Error('Cannot unregister tools through DynamicToolFilter. Use baseRegistry instead.');
  }

  // ===== 可选方法（代理到 baseRegistry） =====

  setPermissionController?(controller: unknown): void {
    if (this.baseRegistry.setPermissionController) {
      this.baseRegistry.setPermissionController(controller);
    }
  }

  enterPlanMode?(): void {
    if (this.baseRegistry.enterPlanMode) {
      this.baseRegistry.enterPlanMode();
    }
  }

  exitPlanMode?(): void {
    if (this.baseRegistry.exitPlanMode) {
      this.baseRegistry.exitPlanMode();
    }
  }

  isPlanMode?(): boolean {
    if (this.baseRegistry.isPlanMode) {
      return this.baseRegistry.isPlanMode();
    }
    return false;
  }
}
