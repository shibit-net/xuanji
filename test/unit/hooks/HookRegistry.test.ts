/**
 * HookRegistry 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRegistry } from '@/hooks/HookRegistry';
import { HookEventEmitter } from '@/hooks/EventEmitter';
import type { HookConfig, HookEventContext, HookHandlerResult } from '@/hooks/types';

describe('HookEventEmitter', () => {
  let emitter: HookEventEmitter;

  beforeEach(() => {
    emitter = new HookEventEmitter(1000);
  });

  it('应该注册和触发异步事件', async () => {
    const listener = vi.fn().mockResolvedValue({ success: true });
    emitter.on('PostToolUse', listener);

    const context: HookEventContext = {
      event: 'PostToolUse',
      timestamp: Date.now(),
      toolName: 'read_file',
    };

    const results = await emitter.emit('PostToolUse', context);

    expect(listener).toHaveBeenCalledWith(context);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it('应该并行执行多个异步 listener', async () => {
    const order: number[] = [];

    emitter.on('PostToolUse', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return { success: true };
    });

    emitter.on('PostToolUse', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
      return { success: true };
    });

    const results = await emitter.emit('PostToolUse', {
      event: 'PostToolUse',
      timestamp: Date.now(),
    });

    expect(results).toHaveLength(2);
    // listener 2 应该先完成（10ms < 50ms），证明是并行执行
    expect(order).toEqual([2, 1]);
  });

  it('应该串行执行同步事件并支持阻塞', async () => {
    emitter.on('PreToolUse', async () => ({
      success: false,
      blocked: true,
      error: 'Blocked by hook',
    }));

    emitter.on('PreToolUse', async () => ({
      success: true,
    }));

    const result = await emitter.emitSync('PreToolUse', {
      event: 'PreToolUse',
      timestamp: Date.now(),
    });

    expect(result.blocked).toBe(true);
    expect(result.results).toHaveLength(1); // 第二个没执行
    expect(result.results[0].blocked).toBe(true);
  });

  it('应该处理超时', async () => {
    const slowEmitter = new HookEventEmitter(100); // 100ms 超时

    slowEmitter.on('PostToolUse', async () => {
      await new Promise((r) => setTimeout(r, 500)); // 500ms，会超时
      return { success: true };
    });

    const results = await slowEmitter.emit('PostToolUse', {
      event: 'PostToolUse',
      timestamp: Date.now(),
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('timeout');
  });

  it('没有 listener 时返回空数组', async () => {
    const results = await emitter.emit('PostToolUse', {
      event: 'PostToolUse',
      timestamp: Date.now(),
    });

    expect(results).toEqual([]);
  });

  it('hasListeners 和 listenerCount 正确', () => {
    expect(emitter.hasListeners('PostToolUse')).toBe(false);
    expect(emitter.listenerCount('PostToolUse')).toBe(0);

    emitter.on('PostToolUse', async () => ({ success: true }));

    expect(emitter.hasListeners('PostToolUse')).toBe(true);
    expect(emitter.listenerCount('PostToolUse')).toBe(1);
  });

  it('off 应该移除监听器', async () => {
    const listener = vi.fn().mockResolvedValue({ success: true });
    emitter.on('PostToolUse', listener);
    emitter.off('PostToolUse', listener);

    await emitter.emit('PostToolUse', {
      event: 'PostToolUse',
      timestamp: Date.now(),
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  it('应该加载配置并注册 Handler', () => {
    const config: HookConfig = {
      PostToolUse: [
        {
          type: 'prompt',
          content: 'Tool ${TOOL_NAME} done.',
          scope: 'global',
        },
      ],
    };

    registry.loadConfig(config);
    expect(registry.hasHandlers('PostToolUse')).toBe(true);
    expect(registry.hasHandlers('PreToolUse')).toBe(false);
  });

  it('应该跳过 enabled: false 的 Handler', () => {
    const config: HookConfig = {
      PostToolUse: [
        {
          type: 'prompt',
          content: 'test',
          enabled: false,
        },
      ],
    };

    registry.loadConfig(config);
    expect(registry.hasHandlers('PostToolUse')).toBe(false);
  });

  it('作用域过滤 - parent scope 不在子代理中执行', () => {
    const subAgentRegistry = new HookRegistry({ isSubAgent: true });

    const config: HookConfig = {
      PostToolUse: [
        {
          type: 'prompt',
          content: 'parent only',
          scope: 'parent',
        },
      ],
    };

    subAgentRegistry.loadConfig(config);
    expect(subAgentRegistry.hasHandlers('PostToolUse')).toBe(false);
  });

  it('作用域过滤 - subagent scope 只在子代理中执行', () => {
    const config: HookConfig = {
      PostToolUse: [
        {
          type: 'prompt',
          content: 'subagent only',
          scope: 'subagent',
        },
      ],
    };

    // 非子代理
    registry.loadConfig(config);
    expect(registry.hasHandlers('PostToolUse')).toBe(false);

    // 子代理
    const subAgentRegistry = new HookRegistry({ isSubAgent: true });
    subAgentRegistry.loadConfig(config);
    expect(subAgentRegistry.hasHandlers('PostToolUse')).toBe(true);
  });

  it('disabled 模式不触发事件', async () => {
    const disabledRegistry = new HookRegistry({ disabled: true });

    disabledRegistry.loadConfig({
      PostToolUse: [
        { type: 'prompt', content: 'test' },
      ],
    });

    const results = await disabledRegistry.emit('PostToolUse');
    expect(results).toEqual([]);
  });

  it('setDisabled 动态禁用/启用', async () => {
    registry.loadConfig({
      PostToolUse: [
        { type: 'prompt', content: 'test' },
      ],
    });

    registry.setDisabled(true);
    let results = await registry.emit('PostToolUse');
    expect(results).toEqual([]);

    registry.setDisabled(false);
    results = await registry.emit('PostToolUse');
    expect(results).toHaveLength(1);
  });

  it('Prompt Handler 应该通过 injector 注入内容', async () => {
    const injector = vi.fn();
    registry.setPromptInjector(injector);

    registry.loadConfig({
      PostToolUse: [
        {
          type: 'prompt',
          content: 'Tool ${TOOL_NAME} completed.',
        },
      ],
    });

    await registry.emit('PostToolUse', {
      toolName: 'read_file',
    });

    expect(injector).toHaveBeenCalledWith('Tool read_file completed.');
  });

  it('Command Handler match.toolName 过滤正确', async () => {
    registry.loadConfig({
      PreToolUse: [
        {
          type: 'command',
          script: 'echo "matched"',
          match: { toolName: '^edit_' },
        },
      ],
    });

    // 不匹配的工具名
    const result1 = await registry.emitSync('PreToolUse', {
      toolName: 'read_file',
    });
    expect(result1.blocked).toBe(false);
  });

  it('clear 应该清空所有监听器和配置', () => {
    registry.loadConfig({
      PostToolUse: [
        { type: 'prompt', content: 'test' },
      ],
    });

    expect(registry.hasHandlers('PostToolUse')).toBe(true);

    registry.clear();

    expect(registry.hasHandlers('PostToolUse')).toBe(false);
    expect(registry.getConfig()).toEqual({});
  });

  it('addListener 手动添加监听器', async () => {
    const listener = vi.fn().mockResolvedValue({ success: true });
    registry.addListener('SessionStart', listener);

    const results = await registry.emit('SessionStart');
    expect(listener).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('getLastResults 返回最近的执行结果', async () => {
    registry.loadConfig({
      PostToolUse: [
        { type: 'prompt', content: 'test result' },
      ],
    });

    await registry.emit('PostToolUse');

    const lastResults = registry.getLastResults('PostToolUse');
    expect(lastResults).toHaveLength(1);
    expect(lastResults[0].success).toBe(true);

    // 未触发的事件返回空
    expect(registry.getLastResults('PreToolUse')).toEqual([]);
  });
});
