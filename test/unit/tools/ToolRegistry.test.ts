import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry, createDefaultRegistry } from '@/core/tools/ToolRegistry';
import type { Tool, ToolResult, JSONSchema } from '@/core/types';

/** 创建一个 mock 工具 */
function createMockTool(name: string): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    input_schema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    execute: vi.fn(async (input: Record<string, unknown>) => ({
      content: `executed ${name} with ${JSON.stringify(input)}`,
      isError: false,
    })),
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ---- register() ----

  it('register() 应注册工具', () => {
    const tool = createMockTool('test_tool');
    registry.register(tool);
    expect(registry.has('test_tool')).toBe(true);
  });

  it('register() 重复注册应抛出异常', () => {
    const tool = createMockTool('dup_tool');
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow('工具已注册');
  });

  // ---- unregister() ----

  it('unregister() 应注销工具', () => {
    const tool = createMockTool('removable');
    registry.register(tool);
    expect(registry.has('removable')).toBe(true);
    registry.unregister('removable');
    expect(registry.has('removable')).toBe(false);
  });

  // ---- get() ----

  it('get() 应返回已注册工具', () => {
    const tool = createMockTool('my_tool');
    registry.register(tool);
    expect(registry.get('my_tool')).toBe(tool);
  });

  it('get() 未注册工具应返回 undefined', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  // ---- getAll() ----

  it('getAll() 应返回所有工具', () => {
    registry.register(createMockTool('tool_a'));
    registry.register(createMockTool('tool_b'));
    const all = registry.getAll();
    expect(all.length).toBe(2);
    expect(all.map(t => t.name).sort()).toEqual(['tool_a', 'tool_b']);
  });

  // ---- getSchemas() ----

  it('getSchemas() 应返回所有工具的 Schema', () => {
    registry.register(createMockTool('schema_tool'));
    const schemas = registry.getSchemas();
    expect(schemas.length).toBe(1);
    expect(schemas[0].name).toBe('schema_tool');
    expect(schemas[0].input_schema).toBeDefined();
    expect(schemas[0].description).toBeTruthy();
  });

  // ---- has() ----

  it('has() 应正确判断工具是否已注册', () => {
    expect(registry.has('not_here')).toBe(false);
    registry.register(createMockTool('check_me'));
    expect(registry.has('check_me')).toBe(true);
  });

  // ---- execute() ----

  it('execute() 应正确调用工具', async () => {
    const tool = createMockTool('exec_tool');
    registry.register(tool);
    const result = await registry.execute('exec_tool', { value: 'hello' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('exec_tool');
    expect(tool.execute).toHaveBeenCalledWith({ value: 'hello' });
  });

  it('execute() 未知工具应返回错误', async () => {
    const result = await registry.execute('unknown_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('未知工具');
  });

  it('execute() 工具抛出异常应返回错误', async () => {
    const failTool: Tool = {
      name: 'fail_tool',
      description: 'always fails',
      input_schema: { type: 'object' },
      execute: vi.fn(async () => { throw new Error('工具内部错误'); }),
    };
    registry.register(failTool);

    const result = await registry.execute('fail_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('工具执行异常');
    expect(result.content).toContain('工具内部错误');
  });
});

describe('createDefaultRegistry()', () => {
  it('应注册 4 个核心工具', () => {
    const registry = createDefaultRegistry();
    expect(registry.has('read_file')).toBe(true);
    expect(registry.has('write_file')).toBe(true);
    expect(registry.has('edit_file')).toBe(true);
    expect(registry.has('bash')).toBe(true);
    expect(registry.getAll().length).toBe(4);
  });

  it('所有工具都应有合法的 Schema', () => {
    const registry = createDefaultRegistry();
    const schemas = registry.getSchemas();
    for (const schema of schemas) {
      expect(schema.name).toBeTruthy();
      expect(schema.description).toBeTruthy();
      expect(schema.input_schema).toBeDefined();
      expect(schema.input_schema.type).toBe('object');
    }
  });
});
