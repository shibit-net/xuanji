import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorRecovery } from '@/core/agent/ErrorRecovery';

describe('ErrorRecovery', () => {
  let recovery: ErrorRecovery;

  beforeEach(() => {
    recovery = new ErrorRecovery(3);
  });

  // ---- recordError() ----

  it('recordError() 第一次应不触发终止', () => {
    const shouldStop = recovery.recordError(new Error('test'));
    expect(shouldStop).toBe(false);
    expect(recovery.getConsecutiveErrors()).toBe(1);
  });

  it('recordError() 达到阈值时应触发终止', () => {
    recovery.recordError(new Error('1'));
    recovery.recordError(new Error('2'));
    const shouldStop = recovery.recordError(new Error('3'));
    expect(shouldStop).toBe(true);
  });

  it('recordError() 未达阈值时不触发终止', () => {
    recovery.recordError(new Error('1'));
    const shouldStop = recovery.recordError(new Error('2'));
    expect(shouldStop).toBe(false);
  });

  // ---- reset() ----

  it('reset() 应重置错误计数', () => {
    recovery.recordError(new Error('1'));
    recovery.recordError(new Error('2'));
    expect(recovery.getConsecutiveErrors()).toBe(2);
    recovery.reset();
    expect(recovery.getConsecutiveErrors()).toBe(0);
  });

  it('reset() 后应重新计数', () => {
    recovery.recordError(new Error('1'));
    recovery.recordError(new Error('2'));
    recovery.reset();
    // 重新开始计数
    const shouldStop = recovery.recordError(new Error('new-1'));
    expect(shouldStop).toBe(false);
    expect(recovery.getConsecutiveErrors()).toBe(1);
  });

  // ---- 自定义阈值 ----

  it('应支持自定义最大连续错误数', () => {
    const custom = new ErrorRecovery(1);
    const shouldStop = custom.recordError(new Error('first'));
    expect(shouldStop).toBe(true);
  });

  // ---- formatError() 静态方法 ----

  it('formatError() 应处理认证错误', () => {
    const result = ErrorRecovery.formatError(new Error('api_key is invalid'));
    expect(result).toContain('认证失败');
    expect(result).toContain('API Key');
  });

  it('formatError() 应处理网络错误', () => {
    const result = ErrorRecovery.formatError(new Error('ECONNREFUSED'));
    expect(result).toContain('网络连接失败');
  });

  it('formatError() 应处理限流错误', () => {
    const result = ErrorRecovery.formatError(new Error('rate_limit exceeded'));
    expect(result).toContain('频率超限');
  });

  it('formatError() 应处理余额不足错误', () => {
    const result = ErrorRecovery.formatError(new Error('insufficient credit'));
    expect(result).toContain('余额不足');
  });

  it('formatError() 应透传普通错误消息', () => {
    const result = ErrorRecovery.formatError(new Error('some random error'));
    expect(result).toBe('some random error');
  });

  it('formatError() 应处理非 Error 类型', () => {
    const result = ErrorRecovery.formatError('string error');
    expect(result).toBe('string error');
  });

  it('formatError() 应处理认证关键词 authentication', () => {
    const result = ErrorRecovery.formatError(new Error('authentication failed'));
    expect(result).toContain('认证失败');
  });

  it('formatError() 应处理 fetch failed 网络错误', () => {
    const result = ErrorRecovery.formatError(new Error('fetch failed'));
    expect(result).toContain('网络连接失败');
  });

  it('formatError() 应处理 429 限流', () => {
    const result = ErrorRecovery.formatError(new Error('status 429'));
    expect(result).toContain('频率超限');
  });

  it('formatError() 应处理 billing 余额', () => {
    const result = ErrorRecovery.formatError(new Error('billing issue'));
    expect(result).toContain('余额不足');
  });
});
