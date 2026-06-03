import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BashTool } from '@/tools/BashTool';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('BashTool', () => {
  let tool: BashTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new BashTool();
    testDir = join(tmpdir(), `xuanji-test-bash-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('bash');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('command');
  });

  it('应成功执行简单命令', async () => {
    const result = await tool.execute({ command: 'echo "hello xuanji"' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('hello xuanji');
  });

  it('应返回命令输出', async () => {
    const result = await tool.execute({ command: 'echo -n "1 2 3"' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('1 2 3');
  });

  it('命令失败时应返回错误', async () => {
    const result = await tool.execute({ command: 'exit 1' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('退出码: 1');
  });

  it('无输出命令应返回 (无输出)', async () => {
    const result = await tool.execute({ command: 'true' });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('(无输出)');
  });

  it('应捕获 stderr 输出', async () => {
    const result = await tool.execute({ command: 'echo "err msg" >&2; exit 0' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('err msg');
    expect(result.content).toContain('[stderr]');
  });

  it('应支持超时参数', async () => {
    const result = await tool.execute({
      command: 'sleep 10',
      timeout: 500, // 500ms 超时
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('超时');
  }, 10_000);

  it('应截断过长输出', async () => {
    // 生成 > 30000 字符的输出
    const result = await tool.execute({
      command: 'python3 -c "print(\'x\' * 40000)"',
    });
    expect(result.isError).toBe(false);
    if (result.content.length > 30100) {
      expect(result.content).toContain('已截断');
    }
  }, 15_000);

  it('命令不存在时应返回错误', async () => {
    const result = await tool.execute({ command: 'nonexistent_command_xyz_12345' });
    expect(result.isError).toBe(true);
  });

  it('exitCode 应在 metadata 中', async () => {
    const result = await tool.execute({ command: 'echo ok' });
    expect(result.metadata?.exitCode).toBe(0);
  });
});
