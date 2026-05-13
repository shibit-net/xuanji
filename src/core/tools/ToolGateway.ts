/**
 * ToolGateway — 工具网关
 *
 * 职责：工具注册、发现、权限控制、执行的统一入口。
 */

import type { IToolRegistry, Tool, ToolSchema, ToolCall, ToolResult } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ToolGateway' });

export interface ExecutionContext {
  signal?: AbortSignal;
  agentId?: string;
  depth?: number;
  workingDir?: string;
}

export interface ToolMetrics {
  name: string;
  calls: number;
  errors: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export class ToolGateway {
  private registry: IToolRegistry;
  private permissionController: PermissionController | null = null;
  private metrics = new Map<string, { calls: number; errors: number; totalDurationMs: number }>();
  private activeControllers = new Set<AbortController>();

  constructor(registry: IToolRegistry) {
    this.registry = registry;
  }

  getBaseRegistry(): IToolRegistry {
    return this.registry;
  }

  setRegistry(registry: IToolRegistry): void {
    this.registry = registry;
  }

  setPermissionController(controller: PermissionController): void {
    this.permissionController = controller;
    if (this.registry.setPermissionController) {
      this.registry.setPermissionController(controller);
    }
  }

  register(tool: Tool): void {
    this.registry.register(tool);
  }

  unregister(name: string): void {
    this.registry.unregister(name);
  }

  async discover(): Promise<ToolSchema[]> {
    return this.registry.getSchemas();
  }

  createFilteredRegistry(allowedTools: string[], context: { agentId: string; workingDir?: string }): IToolRegistry {
    const { FilteredToolRegistry } = require('./FilteredToolRegistry');
    return new FilteredToolRegistry(
      this.registry,
      allowedTools,
      { agentId: context.agentId, agentName: context.agentId },
      context.workingDir || process.cwd(),
    );
  }

  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const tool = this.registry.get(toolCall.name);

    if (!tool) {
      return { content: `Tool not found: ${toolCall.name}`, isError: true };
    }

    // 如果 context 没有 signal，创建一个用于 abortAll 追踪
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const signal = context.signal ?? controller.signal;

    try {
      const result = await this.registry.execute(toolCall.name, toolCall.input, signal);
      this.recordMetric(toolCall.name, Date.now() - start, false);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      this.recordMetric(toolCall.name, duration, true);
      log.warn(`Tool ${toolCall.name} failed (${duration}ms): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  async executeBatch(
    toolCalls: ToolCall[],
    context: ExecutionContext,
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();
    const parallel: ToolCall[] = [];
    const serial: ToolCall[] = [];

    for (const tc of toolCalls) {
      const tool = this.registry.get(tc.name);
      (tool?.readonly ? parallel : serial).push(tc);
    }

    // 并行执行只读工具
    if (parallel.length > 0) {
      const parallelResults = await Promise.all(
        parallel.map(async tc => {
          try {
            return [tc.id, await this.execute(tc, context)] as const;
          } catch (err) {
            return [tc.id, { content: String(err), isError: true }] as const;
          }
        })
      );
      for (const [id, result] of parallelResults) {
        results.set(id, result);
      }
    }

    // 串行执行非只读工具
    for (const tc of serial) {
      try {
        results.set(tc.id, await this.execute(tc, context));
      } catch (err) {
        results.set(tc.id, { content: String(err), isError: true });
      }
    }

    return results;
  }

  /** 获取工具 schema（同步，委托给 registry） */
  getSchemas(): ToolSchema[] {
    return this.registry.getSchemas();
  }

  /** 中止所有正在执行的工具 */
  abortAll(): void {
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  getMetrics(): ToolMetrics[] {
    const result: ToolMetrics[] = [];
    for (const [name, m] of this.metrics) {
      result.push({
        name,
        calls: m.calls,
        errors: m.errors,
        totalDurationMs: m.totalDurationMs,
        avgDurationMs: m.calls > 0 ? Math.round(m.totalDurationMs / m.calls) : 0,
      });
    }
    return result.sort((a, b) => b.calls - a.calls);
  }

  private recordMetric(name: string, durationMs: number, isError: boolean): void {
    const m = this.metrics.get(name) ?? { calls: 0, errors: 0, totalDurationMs: 0 };
    m.calls++;
    if (isError) m.errors++;
    m.totalDurationMs += durationMs;
    this.metrics.set(name, m);
  }
}

export interface PermissionController {
  check(toolName: string, input: Record<string, unknown>): 'allow' | 'deny' | 'confirm';
  requestConfirmation(toolCall: ToolCall): Promise<boolean>;
}
