/**
 * SubAgentLoop 和 TaskTool 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentContext, MAX_NESTING_DEPTH, ALWAYS_RESTRICTED_TOOLS } from '@/core/agent/SubAgentContext';
import { TaskTool } from '@/core/tools/TaskTool';
import { ToolRegistry } from '@/core/tools/ToolRegistry';
import type { AgentConfig, Tool, ToolResult, ToolSchema, IToolRegistry, ILLMProvider } from '@/core/types';

describe('SubAgentContext', () => {
  it('应该使用默认配置创建上下文', () => {
    const ctx = new SubAgentContext({ task: 'test task' });

    expect(ctx.task).toBe('test task');
    expect(ctx.timeout).toBe(300_000);
    expect(ctx.maxIterations).toBe(30);
    expect(ctx.depth).toBe(0);
    expect(ctx.parentContext).toBeUndefined();
  });

  it('应该合并受限工具列表', () => {
    const ctx = new SubAgentContext({
      task: 'test',
      restrictedTools: ['custom_tool'],
    });

    expect(ctx.restrictedTools).toContain('task');
    expect(ctx.restrictedTools).toContain('custom_tool');
    expect(ctx.isToolRestricted('task')).toBe(true);
    expect(ctx.isToolRestricted('custom_tool')).toBe(true);
    expect(ctx.isToolRestricted('read_file')).toBe(false);
  });

  it('嵌套深度检查', () => {
    const ctx0 = new SubAgentContext({ task: 'test', depth: 0 });
    expect(ctx0.isDepthExceeded()).toBe(false);

    const ctx2 = new SubAgentContext({ task: 'test', depth: 2 });
    expect(ctx2.isDepthExceeded()).toBe(false);

    const ctx3 = new SubAgentContext({ task: 'test', depth: MAX_NESTING_DEPTH });
    expect(ctx3.isDepthExceeded()).toBe(true);
  });

  it('buildAgentConfig 应该追加子代理说明', () => {
    const ctx = new SubAgentContext({
      task: 'test',
      parentContext: 'Working on a refactoring task',
      depth: 1,
    });

    const parentConfig: AgentConfig = {
      model: 'test-model',
      apiKey: 'key',
      systemPrompt: 'You are a helpful assistant.',
    };

    const config = ctx.buildAgentConfig(parentConfig);

    expect(config.systemPrompt).toContain('[SubAgent Mode');
    expect(config.systemPrompt).toContain('Depth: 1');
    expect(config.systemPrompt).toContain('[Parent Context]');
    expect(config.systemPrompt).toContain('Working on a refactoring task');
    expect(config.maxIterations).toBe(30);
  });
});

describe('ToolRegistry.cloneForSubAgent', () => {
  it('应该克隆并排除指定工具', () => {
    const registry = new ToolRegistry();
    const mockTool: Tool = {
      name: 'test_tool',
      description: 'test',
      input_schema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'ok', isError: false }),
    };
    const taskTool: Tool = {
      name: 'task',
      description: 'task tool',
      input_schema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'ok', isError: false }),
    };

    registry.register(mockTool);
    registry.register(taskTool);

    const cloned = registry.cloneForSubAgent(['task']);

    expect(cloned.has('test_tool')).toBe(true);
    expect(cloned.has('task')).toBe(false);
    expect(cloned.getAll()).toHaveLength(1);
  });

  it('不排除任何工具时应该完全复制', () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      name: 'test',
      description: 'test',
      input_schema: { type: 'object', properties: {} },
      execute: async () => ({ content: 'ok', isError: false }),
    };
    registry.register(tool);

    const cloned = registry.cloneForSubAgent();
    expect(cloned.has('test')).toBe(true);
    expect(cloned.getAll()).toHaveLength(1);
  });
});

describe('TaskTool', () => {
  let taskTool: TaskTool;

  beforeEach(() => {
    taskTool = new TaskTool();
  });

  it('应该有正确的元数据', () => {
    expect(taskTool.name).toBe('task');
    expect(taskTool.description).toContain('sub-agent');
    expect(taskTool.input_schema.required).toContain('description');
    expect(taskTool.readonly).toBe(true);
  });

  it('未注入依赖时应该返回错误', async () => {
    const result = await taskTool.execute({
      description: 'test task',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not initialized');
  });

  it('深度超限时应该返回错误', async () => {
    // 创建一个 mock provider
    const mockProvider = {
      stream: vi.fn(),
    } as unknown as ILLMProvider;

    const mockRegistry = new ToolRegistry();

    taskTool.setDependencies({
      provider: mockProvider,
      registry: mockRegistry,
      agentConfig: { model: 'test', apiKey: 'key' },
      depth: MAX_NESTING_DEPTH, // 已达最大深度
    });

    const result = await taskTool.execute({
      description: 'test task',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('nesting depth exceeded');
  });

  it('getActiveCount 初始为 0', () => {
    expect(taskTool.getActiveCount()).toBe(0);
  });
});

describe('ALWAYS_RESTRICTED_TOOLS', () => {
  it('应该包含 task 工具', () => {
    expect(ALWAYS_RESTRICTED_TOOLS).toContain('task');
  });
});
