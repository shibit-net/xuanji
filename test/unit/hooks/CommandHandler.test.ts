import { describe, it, expect } from 'vitest';
import { executeCommandHandler } from '@/hooks/handlers/CommandHandler';
import type { CommandHookHandler, HookEventContext } from '@/hooks/types';

function createHandler(script: string): CommandHookHandler {
  return {
    type: 'command',
    script,
    timeout: 5000,
  };
}

function createContext(overrides?: Partial<HookEventContext>): HookEventContext {
  return {
    event: 'PreToolUse',
    timestamp: Date.now(),
    toolName: 'bash',
    toolInput: { command: 'ls' },
    ...overrides,
  };
}

describe('CommandHandler', () => {
  describe('基础执行', () => {
    it('成功脚本应返回 success=true', async () => {
      const result = await executeCommandHandler(
        createHandler('echo hello'),
        createContext(),
      );
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout?.trim()).toBe('hello');
      expect(result.blocked).toBe(false);
    });

    it('失败脚本应返回 blocked=true', async () => {
      const result = await executeCommandHandler(
        createHandler('exit 1'),
        createContext(),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.blocked).toBe(true);
    });
  });

  describe('JSON 输出解析', () => {
    it('应解析 modifiedInput', async () => {
      const script = `echo '{"blocked": false, "modifiedInput": {"command": "echo modified"}}'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.modifiedInput).toEqual({ command: 'echo modified' });
    });

    it('应解析 replaceTool', async () => {
      const script = `echo '{"blocked": false, "replaceTool": "read_file"}'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.replaceTool).toBe('read_file');
    });

    it('应解析 mockResult', async () => {
      const script = `echo '{"blocked": false, "mockResult": {"content": "mocked output", "isError": false}}'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.mockResult).toBeDefined();
      expect(result.mockResult?.content).toBe('mocked output');
      expect(result.mockResult?.isError).toBe(false);
    });

    it('应解析 blocked=true 覆盖', async () => {
      const script = `echo '{"blocked": true}'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.success).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it('非 JSON 输出应忽略', async () => {
      const script = `echo 'plain text output'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.success).toBe(true);
      expect(result.modifiedInput).toBeUndefined();
      expect(result.replaceTool).toBeUndefined();
      expect(result.mockResult).toBeUndefined();
    });

    it('无效 JSON 应忽略', async () => {
      const script = `echo '{invalid json'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.success).toBe(true);
      expect(result.modifiedInput).toBeUndefined();
    });

    it('JSON 数组应忽略（非对象）', async () => {
      const script = `echo '[1, 2, 3]'`;
      const result = await executeCommandHandler(createHandler(script), createContext());
      expect(result.modifiedInput).toBeUndefined();
    });
  });

  describe('环境变量传递', () => {
    it('TOOL_NAME 应通过环境变量传递', async () => {
      const script = `echo $TOOL_NAME`;
      const result = await executeCommandHandler(
        createHandler(script),
        createContext({ toolName: 'bash' }),
      );
      expect(result.stdout?.trim()).toBe('bash');
    });

    it('TOOL_INPUT 应通过环境变量传递 JSON', async () => {
      const script = `echo $TOOL_INPUT`;
      const result = await executeCommandHandler(
        createHandler(script),
        createContext({ toolInput: { command: 'ls' } }),
      );
      expect(result.stdout?.trim()).toBe('{"command":"ls"}');
    });
  });
});
