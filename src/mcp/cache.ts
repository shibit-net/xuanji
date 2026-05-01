/**
 * ============================================================
 * MCP Cache - Simple In-Memory Cache with TTL
 * ============================================================
 * 提供简单的内存缓存实现，支持 TTL 过期
 */

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  /** 缓存值 */
  value: T;
  /** 过期时间戳（毫秒） */
  expiresAt: number;
}

/**
 * 缓存配置
 */
export interface CacheOptions {
  /** 默认 TTL（毫秒，0 表示永不过期） */
  defaultTTL?: number;
  /** 最大条目数（0 表示无限制） */
  maxSize?: number;
  /** 过期清理间隔（毫秒，0 表示不自动清理） */
  cleanupInterval?: number;
}

/**
 * 简单内存缓存实现
 */
export class MemoryCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private defaultTTL: number;
  private maxSize: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: CacheOptions = {}) {
    this.defaultTTL = options.defaultTTL ?? 15 * 60 * 1000; // 默认 15 分钟
    this.maxSize = options.maxSize ?? 0; // 默认无限制
    const cleanupInterval = options.cleanupInterval ?? 60 * 1000; // 默认 1 分钟清理一次

    // 启动自动清理
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
      // 不阻止进程退出
      this.cleanupTimer.unref();
    }
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl TTL（毫秒，可选，默认使用 defaultTTL）
   */
  set(key: string, value: T, ttl?: number): void {
    const effectiveTTL = ttl ?? this.defaultTTL;
    const expiresAt = effectiveTTL > 0 ? Date.now() + effectiveTTL : Infinity;

    // 检查容量限制（LRU 淘汰：删除最久未访问的条目）
    if (this.maxSize > 0 && this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
  }

  /**
   * 获取缓存（同时更新为最近使用）
   * @param key 缓存键
   * @returns 缓存值，未找到或已过期返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    // 更新为最近使用（delete + re-set 使条目移到 Map 末尾）
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  /**
   * 判断是否存在（且未过期）
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    // 只统计未过期的条目
    this.cleanup();
    return this.cache.size;
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    this.cleanup();
    return Array.from(this.cache.keys());
  }

  /**
   * 清理过期条目
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 销毁缓存（清理定时器）
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }

  /**
   * 获取缓存统计信息
   */
  stats(): {
    size: number;
    maxSize: number;
    defaultTTL: number;
  } {
    return {
      size: this.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
    };
  }
}

/**
 * 创建缓存实例的工厂函数
 */
export function createCache<T = unknown>(options?: CacheOptions): MemoryCache<T> {
  return new MemoryCache<T>(options);
}
