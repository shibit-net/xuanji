import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '@/core/agent/CostTracker';
import type { TokenUsage } from '@/core/types';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker('claude-sonnet-4');
  });

  // ---- calculateCost() ----

  it('calculateCost() 应按 Sonnet 定价计算', () => {
    const usage: TokenUsage = { input: 1_000_000, output: 1_000_000 };
    const cost = tracker.calculateCost(usage);
    // Sonnet: input $3/M, output $15/M → 3 + 15 = 18
    expect(cost).toBe(18);
  });

  it('calculateCost() 应计算 cache token 费用', () => {
    const usage: TokenUsage = {
      input: 1_000_000,
      output: 0,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    };
    const cost = tracker.calculateCost(usage);
    // input: 3 + cacheRead: 0.3 + cacheWrite: 3.75 = 7.05
    expect(cost).toBeCloseTo(7.05, 2);
  });

  it('calculateCost() 未知模型应返回 0', () => {
    const unknownTracker = new CostTracker('unknown-model');
    const cost = unknownTracker.calculateCost({ input: 1000, output: 1000 });
    expect(cost).toBe(0);
  });

  it('calculateCost() 应支持前缀模型匹配', () => {
    // "claude-sonnet-4" 是精确键, 带时间戳的应走前缀匹配
    const tracker2 = new CostTracker('claude-haiku-3.5-20250514');
    const cost = tracker2.calculateCost({ input: 1_000_000, output: 1_000_000 });
    // Haiku: input $0.8/M, output $4/M → 0.8 + 4 = 4.8
    expect(cost).toBeCloseTo(4.8, 2);
  });

  it('calculateCost() 小用量应返回较小费用', () => {
    const usage: TokenUsage = { input: 100, output: 50 };
    const cost = tracker.calculateCost(usage);
    // 100/1M * 3 + 50/1M * 15 = 0.0003 + 0.00075 = 0.00105
    expect(cost).toBeCloseTo(0.00105, 5);
  });

  // ---- record() ----

  it('record() 应记录费用并返回本次费用', () => {
    const cost = tracker.record({ input: 1000, output: 500 });
    expect(cost).toBeGreaterThan(0);
    expect(tracker.getTotalCost()).toBe(cost);
  });

  it('record() 应累计多次调用费用', () => {
    const cost1 = tracker.record({ input: 1000, output: 500 });
    const cost2 = tracker.record({ input: 2000, output: 1000 });
    expect(tracker.getTotalCost()).toBeCloseTo(cost1 + cost2, 10);
  });

  // ---- getSessionUsage() ----

  it('getSessionUsage() 应累计 token 用量', () => {
    tracker.record({ input: 100, output: 50 });
    tracker.record({ input: 200, output: 100 });
    const usage = tracker.getSessionUsage();
    expect(usage.input).toBe(300);
    expect(usage.output).toBe(150);
  });

  // ---- formatCost() ----

  it('formatCost() 小于 $0.01 应显示 4 位小数', () => {
    tracker.record({ input: 100, output: 50 });
    const formatted = tracker.formatCost();
    expect(formatted).toMatch(/^\$0\.\d{4}$/);
  });

  it('formatCost() 大于 $0.01 应显示 2 位小数', () => {
    tracker.record({ input: 1_000_000, output: 1_000_000 });
    const formatted = tracker.formatCost();
    expect(formatted).toMatch(/^\$\d+\.\d{2}$/);
  });

  it('formatCost() 应接受自定义费用参数', () => {
    expect(tracker.formatCost(0.005)).toBe('$0.0050');
    expect(tracker.formatCost(1.5)).toBe('$1.50');
  });

  // ---- setModel() ----

  it('setModel() 应更新模型并影响后续计算', () => {
    const sonnetCost = tracker.calculateCost({ input: 1_000_000, output: 1_000_000 });
    tracker.setModel('claude-opus-4');
    const opusCost = tracker.calculateCost({ input: 1_000_000, output: 1_000_000 });
    // Opus 比 Sonnet 贵
    expect(opusCost).toBeGreaterThan(sonnetCost);
    // Opus: 15 + 75 = 90
    expect(opusCost).toBe(90);
  });
});
