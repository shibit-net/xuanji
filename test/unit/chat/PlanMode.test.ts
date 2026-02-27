import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry, createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { BaseTool } from '@/core/tools/BaseTool';
import type { JSONSchema, ToolResult } from '@/core/types';

/** Mock 只读工具 */
class MockReadTool extends BaseTool {
  readonly name = 'mock_read';
  readonly description = 'Mock read tool';
  readonly input_schema: JSONSchema = { type: 'object', properties: {} };
  readonly readonly = true;

  async execute(): Promise<ToolResult> {
    return this.success('read result');
  }
}

/** Mock 写工具 */
class MockWriteTool extends BaseTool {
  readonly name = 'mock_write';
  readonly description = 'Mock write tool';
  readonly input_schema: JSONSchema = { type: 'object', properties: {} };
  readonly readonly = false;

  async execute(): Promise<ToolResult> {
    return this.success('write result');
  }
}

describe('Plan Mode', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(new MockReadTool());
    registry.register(new MockWriteTool());
  });

  it('默认不在 Plan Mode', () => {
    expect(registry.isPlanMode()).toBe(false);
  });

  it('enterPlanMode 应启用 Plan Mode', () => {
    registry.enterPlanMode();
    expect(registry.isPlanMode()).toBe(true);
  });

  it('exitPlanMode 应退出 Plan Mode', () => {
    registry.enterPlanMode();
    registry.exitPlanMode();
    expect(registry.isPlanMode()).toBe(false);
  });

  it('Plan Mode 下只读工具应正常执行', async () => {
    registry.enterPlanMode();
    const result = await registry.execute('mock_read', {});
    expect(result.isError).toBe(false);
    expect(result.content).toBe('read result');
  });

  it('Plan Mode 下写工具应被拦截', async () => {
    registry.enterPlanMode();
    const result = await registry.execute('mock_write', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Plan Mode');
    expect(result.content).toContain('mock_write');
    expect(result.metadata?.planModeBlocked).toBe(true);
  });

  it('退出 Plan Mode 后写工具应恢复执行', async () => {
    registry.enterPlanMode();
    const blocked = await registry.execute('mock_write', {});
    expect(blocked.isError).toBe(true);

    registry.exitPlanMode();
    const allowed = await registry.execute('mock_write', {});
    expect(allowed.isError).toBe(false);
    expect(allowed.content).toBe('write result');
  });

  it('非 Plan Mode 下写工具应正常执行', async () => {
    const result = await registry.execute('mock_write', {});
    expect(result.isError).toBe(false);
    expect(result.content).toBe('write result');
  });

  it('BaseTool.isWriteOperation 应根据 readonly 返回', () => {
    const readTool = new MockReadTool();
    const writeTool = new MockWriteTool();
    expect(readTool.isWriteOperation()).toBe(false);
    expect(writeTool.isWriteOperation()).toBe(true);
  });
});
