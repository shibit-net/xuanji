// ============================================================
// PermissionCache - 权限缓存实现
// ============================================================

import type { IPermissionCache } from './interfaces';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PermissionCache' });

interface CacheEntry {
  value: boolean;
  expireAt: number;
}

/**
 * PermissionCache - 权限缓存
 */
export class PermissionCache implements IPermissionCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get(key: string): boolean | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // 检查是否过期
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: boolean, ttl = 3600000): void {
    // 检查容量
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expireAt: Date.now() + ttl
    });
  }

  clear(): void {
    this.cache.clear();
    log.debug('Cache cleared');
  }

  /**
   * 淘汰最旧的条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.expireAt < oldestTime) {
        oldestTime = entry.expireAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
}
