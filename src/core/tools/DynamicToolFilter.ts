// ============================================================
// M6 工具系统 — 动态工具过滤器
// ============================================================
//
// 根据激活的场景动态过滤传递给 LLM 的工具集
// 使用包装器模式实现 IToolRegistry 接口，零侵入原有架构

import type { IToolRegistry, Tool, ToolSchema, ToolResult } from '@/core/types';
import type { SceneType } from '@/core/prompt/types';
import { computeAllowedToolsByScene } from './ToolCategories';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DynamicToolFilter' });

/**
 * 动态工具过滤器
 *
 * 职责：
 * 1. 根据激活的场景，计算允许的工具集
 * 2. 作为 ToolRegistry 的包装器，实现 IToolRegistry 接口
 * 3. 拦截 getSchemas/get/getAll/has/execute，返回过滤后的结果
 * 4. 拦截 register/unregister，防止通过 Filter 修改基础注册表
 */
export class DynamicToolFilter implements IToolRegistry {
  private baseRegistry: IToolRegistry;
  private currentScene: SceneType | null = null;
  private sceneExtraTools: string[] = [];

  constructor(registry: IToolRegistry) {
    this.baseRegistry = registry;
    log.debug('DynamicToolFilter initialized');
  }

  /**
   * 设置当前场景（由 ChatSession.routeWithLayeredPrompt 调用）
   */
  setScene(scene: SceneType, extraTools?: string[]): void {
    this.currentScene = scene;
    this.sceneExtraTools = extraTools || [];
    const allowedTools = this.getAllowedToolNames();
    log.debug(`Scene set to: ${scene}, allowed tools (${allowedTools.size}): ${Array.from(allowedTools).join(', ')}`);
  }

  /**
   * 计算当前允许的工具名称集合
   */
  private getAllowedToolNames(): Set<string> {
    if (this.currentScene) {
      return computeAllowedToolsByScene(this.currentScene, this.sceneExtraTools);
    }
    // 未设置场景时，返回全量工具
    return new Set(this.baseRegistry.getSchemas().map(s => s.name));
  }

  // ===== 实现 IToolRegistry 接口 =====

  /**
   * 获取工具 Schema 列表（过滤后）
   */
  getSchemas(): ToolSchema[] {
    const allowedNames = this.getAllowedToolNames();
    const allSchemas = this.baseRegistry.getSchemas();
    const filtered = allSchemas.filter(schema => allowedNames.has(schema.name));

    log.debug(`getSchemas: ${filtered.length} / ${allSchemas.length} tools available`);
    return filtered;
  }

  /**
   * 获取工具（过滤后）
   */
  get(name: string): Tool | undefined {
    const allowed = this.getAllowedToolNames();
    if (!allowed.has(name)) {
      log.debug(`get("${name}"): tool not in allowed list`);
      return undefined;
    }
    return this.baseRegistry.get(name);
  }

  /**
   * 获取所有工具（过滤后）
   */
  getAll(): Tool[] {
    const allowedNames = this.getAllowedToolNames();
    return this.baseRegistry.getAll().filter(tool => allowedNames.has(tool.name));
  }

  /**
   * 检查工具是否存在（过滤后）
   */
  has(name: string): boolean {
    const allowed = this.getAllowedToolNames();
    return allowed.has(name) && this.baseRegistry.has(name);
  }

  /**
   * 执行工具（过滤后）
   */
  async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const allowed = this.getAllowedToolNames();
    if (!allowed.has(name)) {
      log.warn(`execute("${name}"): tool not available in current context`);
      return {
        content: `Tool "${name}" is not available in current context. Scene: ${this.currentScene || 'none'}.`,
        isError: true,
      };
    }
    return this.baseRegistry.execute(name, input, signal);
  }

  /**
   * 注册工具（禁止）
   * DynamicToolFilter 不允许修改基础注册表
   */
  register(tool: Tool): void {
    throw new Error('Cannot register tools through DynamicToolFilter. Use baseRegistry instead.');
  }

  /**
   * 注销工具（禁止）
   * DynamicToolFilter 不允许修改基础注册表
   */
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
