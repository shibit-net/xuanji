import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retry } from '@/shared/utils/retry';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: 创建一个在第 N 次调用时成功的 mock 函数
  function mockFnThatSucceedsAfter<T>(failures: number, successValue: T) {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls <= failures) {
        throw new Error(`模拟失败 #${calls}`);
      }
      return successValue;
    });
    return { fn, getCalls: () => calls };
  }

  // Helper: 推进所有待处理的异步延迟
  async function advanceAllTimers() {
    vi.advanceTimersByTime(1_000_000);
    // flush microtask queue
    await vi.runAllTimersAsync();
  }

  // ============================================================
  // 正常路径
  // ============================================================

  it('首次成功：不重试，直接返回结果', async () => {
    const fn = vi.fn(async () => 'hello');

    const promise = retry(fn);
    await advanceAllTimers();
    const result = await promise;

    expect(result).toBe('hello');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('失败后成功：前2次失败，第3次成功', async () => {
    const { fn } = mockFnThatSucceedsAfter(2, 'success');

    const promise = retry(fn, { maxRetries: 3, initialDelay: 100 });
    await advanceAllTimers();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3); // 2 fail + 1 success
  });

  it('重试次数等于 maxRetries：最后一次成功', async () => {
    const { fn } = mockFnThatSucceedsAfter(2, 'ok');

    const promise = retry(fn, { maxRetries: 2, initialDelay: 10 });
    await advanceAllTimers();
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
  });

  // ============================================================
  // 边界条件
  // ============================================================

  it('全部失败：超过最大重试次数，抛出最后一次错误', async () => {
    const fn = vi.fn(async () => {
      throw new Error('持续失败');
    });

    const promise = retry(fn, { maxRetries: 2, initialDelay: 10 });
    promise.catch(() => {}); // 提前绑定 catch，避免 fake timers 下的 unhandled rejection
    await advanceAllTimers();

    await expect(promise).rejects.toThrow('持续失败');
    expect(fn).toHaveBeenCalledTimes(3); // 初始 1 + 重试 2
  });

  it('maxRetries=0：不重试，失败直接抛出', async () => {
    const fn = vi.fn(async () => {
      throw new Error('失败');
    });

    const promise = retry(fn, { maxRetries: 0 });
    promise.catch(() => {}); // 提前绑定 catch，避免 fake timers 下的 unhandled rejection
    await advanceAllTimers();

    await expect(promise).rejects.toThrow('失败');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('初始延迟为 0：立即重试不等待', async () => {
    const { fn } = mockFnThatSucceedsAfter(1, 'fast');

    const promise = retry(fn, { initialDelay: 0, maxRetries: 2 });
    await advanceAllTimers();
    const result = await promise;

    expect(result).toBe('fast');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ============================================================
  // retryIf 过滤
  // ============================================================

  it('retryIf 返回 false：不重试，直接抛出', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('类型错误');
    });

    const retryIf = vi.fn((error: Error) => error.message.includes('网络'));

    const promise = retry(fn, { retryIf, maxRetries: 3, initialDelay: 10 });
    promise.catch(() => {}); // 提前绑定 catch，避免 fake timers 下的 unhandled rejection
    await advanceAllTimers();

    await expect(promise).rejects.toThrow('类型错误');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(retryIf).toHaveBeenCalledTimes(1);
  });

  it('retryIf 返回 true：继续重试', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('网络超时');
      if (call === 2) throw new Error('网络超时');
      return 'ok';
    });

    const retryIf = vi.fn((error: Error) => error.message.includes('网络'));

    const promise = retry(fn, { retryIf, maxRetries: 3, initialDelay: 10 });
    await advanceAllTimers();
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('非 Error 对象转换为 Error 并正常重试', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call === 1) throw '字符串错误'; // 非 Error 类型
      return 'recovered';
    });

    const promise = retry(fn, { maxRetries: 2, initialDelay: 10 });
    await advanceAllTimers();
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ============================================================
  // 延迟行为
  // ============================================================

  it('延迟按指数退避递增', async () => {
    const fn = vi.fn(async () => {
      throw new Error('失败');
    });

    const onRetry = vi.fn();

    const promise = retry(fn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffFactor: 3,
      maxDelay: 10_000,
      onRetry,
    });
    promise.catch(() => {}); // 提前绑定 catch

    // 跑完所有定时器，让所有重试完成
    await vi.advanceTimersByTimeAsync(100_000);
    await promise.catch(() => {});

    // 4 次调用: 初始 + 3 次重试
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);

    // 验证退避延迟: attempt=1→100, attempt=2→300, attempt=3→900
    expect(onRetry.mock.calls[0]?.[2]).toBe(100);  // 100 * 3^0
    expect(onRetry.mock.calls[1]?.[2]).toBe(300);  // 100 * 3^1
    expect(onRetry.mock.calls[2]?.[2]).toBe(900);  // 100 * 3^2
  });

  it('延迟达到 maxDelay 上限不再增长', async () => {
    const fn = vi.fn(async () => {
      throw new Error('失败');
    });

    const onRetry = vi.fn();

    const promise = retry(fn, {
      maxRetries: 3,
      initialDelay: 1000,
      backoffFactor: 10,     // 快速膨胀: 1000, 10000, 100000
      maxDelay: 5000,         // 上限 5000
      onRetry,
    });
    promise.catch(() => {}); // 提前绑定 catch，避免 fake timers 下的 unhandled rejection

    await vi.advanceTimersByTimeAsync(100_000);
    await promise.catch(() => {});

    // 验证所有重试延迟都 <= maxDelay
    for (const call of onRetry.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(5000);
    }

    // 第2次重试应该被上限截断
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls[0]?.[2]).toBe(1000);   // 1000 * 10^0 = 1000
    expect(onRetry.mock.calls[1]?.[2]).toBe(5000);   // min(1000*10^1, 5000) = 5000
    expect(onRetry.mock.calls[2]?.[2]).toBe(5000);   // min(1000*10^2, 5000) = 5000
  });

  // ============================================================
  // onRetry 回调
  // ============================================================

  it('onRetry 回调参数正确', async () => {
    const fn = vi.fn(async () => {
      throw new Error('callback-test-error');
    });

    const onRetry = vi.fn();

    const promise = retry(fn, {
      maxRetries: 2,
      initialDelay: 50,
      onRetry,
    });
    promise.catch(() => {}); // 提前绑定 catch，避免 fake timers 下的 unhandled rejection

    await vi.advanceTimersByTimeAsync(10_000);
    await promise.catch(() => {});

    expect(onRetry).toHaveBeenCalledTimes(2);

    // 第一次回调
    const [err1, attempt1, delay1] = onRetry.mock.calls[0]!;
    expect(err1).toBeInstanceOf(Error);
    expect(err1.message).toBe('callback-test-error');
    expect(attempt1).toBe(1);
    expect(delay1).toBe(50);

    // 第二次回调
    const [err2, attempt2, delay2] = onRetry.mock.calls[1]!;
    expect(attempt2).toBe(2);
    expect(delay2).toBe(100); // 50 * 2^1
  });

  // ============================================================
  // 自定义参数
  // ============================================================

  it('自定义 maxRetries=5、initialDelay=200 正常生效', async () => {
    const { fn } = mockFnThatSucceedsAfter(4, 'custom');

    const onRetry = vi.fn();

    const promise = retry(fn, {
      maxRetries: 5,
      initialDelay: 200,
      backoffFactor: 2,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(100_000);
    const result = await promise;

    expect(result).toBe('custom');
    expect(fn).toHaveBeenCalledTimes(5); // 4 fail + 1 success
    expect(onRetry).toHaveBeenCalledTimes(4);
  });

  // ============================================================
  // 默认值
  // ============================================================

  it('不传 options 使用默认值：maxRetries=3', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call <= 3) throw new Error(`fail ${call}`);
      return 'default-ok';
    });

    const promise = retry(fn);
    await vi.advanceTimersByTimeAsync(1_000_000);
    const result = await promise;

    expect(result).toBe('default-ok');
    expect(fn).toHaveBeenCalledTimes(4); // 初始 + 3 次重试 = 4
  });
});
