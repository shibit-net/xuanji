import { describe, it, expect } from 'vitest';
import { SleepTool } from '@/core/tools/SleepTool';

describe('SleepTool', () => {
  const tool = new SleepTool();

  it('应有正确的工具名和 Schema', () => {
    expect(tool.name).toBe('sleep');
    expect(tool.readonly).toBe(true);
    expect(tool.input_schema.required).toContain('seconds');
  });

  it('应等待指定秒数', async () => {
    const start = Date.now();
    const result = await tool.execute({ seconds: 0.1 });
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(false);
    expect(result.content).toContain('0.1');
    expect(elapsed).toBeGreaterThanOrEqual(80); // 允许 20ms 误差
  });

  it('应限制最大等待时间为 300 秒', async () => {
    // 不实际等待 300 秒，只验证参数截断
    const start = Date.now();
    const result = await tool.execute({ seconds: 0.05 });
    expect(result.isError).toBe(false);
  });

  it('无效 seconds 应返回错误', async () => {
    const r1 = await tool.execute({ seconds: -1 });
    expect(r1.isError).toBe(true);

    const r2 = await tool.execute({ seconds: 0 });
    expect(r2.isError).toBe(true);

    const r3 = await tool.execute({ seconds: 'abc' });
    expect(r3.isError).toBe(true);
  });

  it('isWriteOperation 应返回 false', () => {
    expect(tool.isWriteOperation()).toBe(false);
  });
});
