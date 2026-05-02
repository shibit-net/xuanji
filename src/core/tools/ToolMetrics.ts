/**
 * ToolMetrics — 工具调用指标追踪
 *
 * 独立于 ToolGateway 的轻量级指标收集器。
 */
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ToolMetrics' });

export interface ToolCallMetrics {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgDurationMs: number;
  lastCalled: number;
  lastError?: string;
}

export class ToolMetricsCollector {
  private metrics = new Map<string, ToolCallMetrics>();

  recordCall(toolName: string, durationMs: number): void {
    const m = this.getOrCreate(toolName);
    m.callCount++;
    m.totalDurationMs += durationMs;
    m.minDurationMs = Math.min(m.minDurationMs, durationMs);
    m.maxDurationMs = Math.max(m.maxDurationMs, durationMs);
    m.avgDurationMs = Math.round(m.totalDurationMs / m.callCount);
    m.lastCalled = Date.now();
  }

  recordError(toolName: string, error: string): void {
    const m = this.getOrCreate(toolName);
    m.errorCount++;
    m.lastError = error;
  }

  getMetrics(): ToolCallMetrics[] {
    return Array.from(this.metrics.values())
      .sort((a, b) => b.callCount - a.callCount);
  }

  getToolMetrics(toolName: string): ToolCallMetrics | undefined {
    return this.metrics.get(toolName);
  }

  reset(): void {
    this.metrics.clear();
  }

  resetTool(toolName: string): void {
    this.metrics.delete(toolName);
  }

  private getOrCreate(toolName: string): ToolCallMetrics {
    if (!this.metrics.has(toolName)) {
      this.metrics.set(toolName, {
        toolName,
        callCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: 0,
        avgDurationMs: 0,
        lastCalled: 0,
      });
    }
    return this.metrics.get(toolName)!;
  }
}
