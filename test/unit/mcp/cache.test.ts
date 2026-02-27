import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryCache, createCache } from '@/mcp/cache';

describe('MemoryCache', () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    // 禁用自动清理
    cache = new MemoryCache({ cleanupInterval: 0 });
  });

  afterEach(() => {
    cache.destroy();
  });

  // ---- set/get ----

  it('set() 和 get() 应正确存取值', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('get() 不存在的 key 应返回 undefined', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  // ---- TTL ----

  it('过期条目应返回 undefined', () => {
    cache.set('short', 'value', 1); // 1ms TTL
    // 等待过期
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get('short')).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it('TTL=0 表示永不过期', () => {
    cache.set('forever', 'value', 0);
    expect(cache.get('forever')).toBe('value');
  });

  // ---- has ----

  it('has() 应正确判断是否存在', () => {
    cache.set('exists', 'value');
    expect(cache.has('exists')).toBe(true);
    expect(cache.has('nope')).toBe(false);
  });

  // ---- delete ----

  it('delete() 应删除条目', () => {
    cache.set('del', 'value');
    expect(cache.delete('del')).toBe(true);
    expect(cache.get('del')).toBeUndefined();
  });

  it('delete() 不存在的 key 应返回 false', () => {
    expect(cache.delete('nonexistent')).toBe(false);
  });

  // ---- clear ----

  it('clear() 应清空所有条目', () => {
    cache.set('a', 'a');
    cache.set('b', 'b');
    cache.clear();
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });

  // ---- maxSize ----

  it('超过 maxSize 应淘汰最早的条目', () => {
    const limitedCache = new MemoryCache<string>({ maxSize: 2, cleanupInterval: 0 });
    limitedCache.set('a', 'a');
    limitedCache.set('b', 'b');
    limitedCache.set('c', 'c'); // 应淘汰 'a'
    expect(limitedCache.has('a')).toBe(false);
    expect(limitedCache.has('b')).toBe(true);
    expect(limitedCache.has('c')).toBe(true);
    limitedCache.destroy();
  });

  // ---- keys ----

  it('keys() 应返回所有未过期的 key', () => {
    cache.set('x', 'x');
    cache.set('y', 'y');
    const keys = cache.keys();
    expect(keys).toContain('x');
    expect(keys).toContain('y');
  });

  // ---- stats ----

  it('stats() 应返回缓存统计信息', () => {
    const stats = cache.stats();
    expect(stats).toHaveProperty('size');
    expect(stats).toHaveProperty('maxSize');
    expect(stats).toHaveProperty('defaultTTL');
  });

  // ---- createCache factory ----

  it('createCache() 应创建缓存实例', () => {
    const c = createCache<number>({ defaultTTL: 5000 });
    c.set('num', 42);
    expect(c.get('num')).toBe(42);
    c.destroy();
  });
});
