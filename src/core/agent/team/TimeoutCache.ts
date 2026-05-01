/**
 * TimeoutCache — 泛型 LRU 缓存工具，基于 Map 实现
 *
 * 用于消除 TeamManager 中 calculateMemberTimeout 的冗余计算。
 * 核心约定：缓存 key 由调用方通过 `computeKey` 函数生成，
 * Cache 本身不关心 key 的语义。
 *
 * ## LRU 淘汰策略
 *
 * 利用 JavaScript `Map` 的插入顺序保证：
 * - **get 命中时**：delete-then-reinsert 将条目移至 Map 末尾（最近使用）
 * - **set 写入时**：若超过 `maxSize`，淘汰 Map 头部条目（最久未使用）
 * - **getOrCompute 未命中时**：计算后写入，自动触发容量检查
 *
 * @typeParam K - 缓存键类型
 * @typeParam V - 缓存值类型
 *
 * @example
 * ```ts
 * // 基本用法
 * const cache = new TimeoutCache<string, number>('member-timeout', 100);
 * cache.set('member-a|0', 300000);
 * cache.get('member-a|0'); // 300000 (hit, 提升至 MRU)
 * cache.stats();           // { name: 'member-timeout', hits: 1, misses: 0, ... }
 *
 * // getOrCompute 模式（推荐）
 * const timeout = cache.getOrCompute('member-a|0', () => calculateExpensive());
 * ```
 *
 * @example
 * ```ts
 * // LRU 淘汰示例
 * const cache = new TimeoutCache<string, number>('lru-demo', 3);
 * cache.set('a', 1).set('b', 2).set('c', 3);
 * cache.get('a');          // 命中，a 提升至 MRU
 * cache.set('d', 4);       // b 被淘汰（最久未使用）
 * cache.has('b');          // false
 * cache.has('a');          // true（因 get 提升而存活）
 * ```
 */
export class TimeoutCache<K, V> {
  /** 底层存储。Map 的插入顺序保证 LRU 语义 */
  private readonly store: Map<K, V>;

  /** 缓存名称（用于 stats 标识和调试） */
  readonly name: string;

  /** 最大容量。超出时触发 LRU 淘汰。Infinity 表示无限制 */
  readonly maxSize: number;

  // ─── 统计计数器 ───

  /** 命中次数（get 或 getOrCompute 命中） */
  private hits = 0;

  /** 未命中次数（get 返回 undefined 或 getOrCompute 触发 factory） */
  private misses = 0;

  /** 设置次数（含覆盖写入） */
  private sets = 0;

  /** 清空次数（clear 调用次数） */
  private clears = 0;

  /** LRU 淘汰次数（因容量满而被驱逐的条目数） */
  private evictions = 0;

  /**
   * 创建 TimeoutCache 实例
   *
   * @param name     - 缓存名称，用于 stats 标识和调试日志
   * @param maxSize  - 最大容量，超出时触发 LRU 淘汰。默认 Infinity（无限制）
   */
  constructor(name: string, maxSize: number = Infinity) {
    this.name = name;
    this.maxSize = maxSize;
    this.store = new Map<K, V>();
  }

  // ─── 核心方法 ───

  /**
   * 获取缓存值，未命中返回 `undefined`。
   *
   * **LRU 行为**：命中时执行 delete-then-reinsert，将条目提升至 MRU 位置。
   * 命中递增 `hits`，未命中递增 `misses`。
   *
   * @param key - 缓存键
   * @returns 缓存值，未命中返回 `undefined`
   *
   * @example
   * ```ts
   * const value = cache.get('key-1');
   * if (value !== undefined) {
   *   // 缓存命中，'key-1' 已提升至 MRU 位置
   * }
   * ```
   */
  get(key: K): V | undefined {
    if (!this.store.has(key)) {
      this.misses++;
      return undefined;
    }

    this.hits++;
    // LRU: delete-then-reinsert — 将条目移至 Map 末尾（MRU）
    const value = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  /**
   * 设置缓存值。已存在的 key 会被覆盖（覆盖时不会触发淘汰）。
   *
   * **LRU 行为**：写入前检查容量，若已满则淘汰最久未使用的条目。
   * 每次调用递增 `sets` 计数器。
   *
   * @param key   - 缓存键
   * @param value - 缓存值
   * @returns `this`，支持链式调用
   *
   * @example
   * ```ts
   * cache.set('key-1', 100).set('key-2', 200);
   * ```
   */
  set(key: K, value: V): this {
    // 若 key 已存在，先删除旧条目（避免在淘汰检查时误算容量）
    if (this.store.has(key)) {
      this.store.delete(key);
    } else {
      // 仅在新增条目时检查容量并淘汰
      this.evictIfNeeded();
    }

    this.store.set(key, value);
    this.sets++;
    return this;
  }

  /**
   * 检查 key 是否存在。
   *
   * **注意**：此方法不影响 hits/misses 计数器，也不触发 LRU 提升。
   * 仅用于存在性检查，不表示"使用"了该条目。
   *
   * @param key - 缓存键
   * @returns `true` 如果 key 存在
   *
   * @example
   * ```ts
   * if (cache.has('key-1')) {
   *   // key 存在，但未触发 LRU 提升
   *   const val = cache.get('key-1'); // 此时才触发 LRU 提升
   * }
   * ```
   */
  has(key: K): boolean {
    return this.store.has(key);
  }

  /**
   * 获取或计算：如果命中则返回缓存值，否则调用 `factory` 计算、缓存并返回。
   *
   * 这是推荐的高层 API，替代手动的 `if (has) get else set` 模式。
   *
   * **统计行为**：
   * - 命中：递增 `hits`
   * - 未命中：递增 `misses` + `sets`（通过内部 `set` 调用）
   *
   * **LRU 行为**：
   * - 命中：delete-then-reinsert 提升至 MRU
   * - 未命中：`factory` 计算后写入，自动触发容量淘汰
   *
   * @param key     - 缓存键
   * @param factory - 值工厂函数，仅在未命中时调用
   * @returns 缓存值（来自缓存或新计算）
   *
   * @example
   * ```ts
   * // 替代模式：if (cache.has(k)) return cache.get(k); else { const v = calc(); cache.set(k, v); return v; }
   * const timeout = cache.getOrCompute('member-a|0', () => calculateMemberTimeout(member, 0));
   * ```
   */
  getOrCompute(key: K, factory: () => V): V {
    if (this.store.has(key)) {
      this.hits++;
      // LRU 提升
      const value = this.store.get(key)!;
      this.store.delete(key);
      this.store.set(key, value);
      return value;
    }

    this.misses++;
    const value = factory();
    // 使用内部逻辑避免 set() 中重复的 has 检查
    this.evictIfNeeded();
    this.store.set(key, value);
    this.sets++;
    return value;
  }

  /**
   * 删除指定 key。
   *
   * 不会递增 `evictions` 计数器（手动删除与 LRU 淘汰分开统计）。
   *
   * @param key - 缓存键
   * @returns `true` 如果 key 存在并被删除，`false` 如果 key 不存在
   *
   * @example
   * ```ts
   * const removed = cache.delete('key-1');
   * console.log(removed ? '已删除' : '不存在');
   * ```
   */
  delete(key: K): boolean {
    return this.store.delete(key);
  }

  /**
   * 清空所有缓存条目。
   *
   * 递增 `clears` 计数器。所有统计计数器（hits/misses/sets/evictions）
   * 保持不变，仅 `size` 归零。
   *
   * @example
   * ```ts
   * cache.clear();
   * console.log(cache.stats().size); // 0
   * ```
   */
  clear(): void {
    this.store.clear();
    this.clears++;
  }

  // ─── 统计方法 ───

  /**
   * 返回缓存统计快照。
   *
   * `hitRate` 计算公式：`hits / (hits + misses)`。
   * 若没有任何查询（hits + misses === 0），返回 `0`。
   *
   * @returns 不可变的统计快照
   *
   * @example
   * ```ts
   * const s = cache.stats();
   * console.log(`${s.name}: ${s.hitRate * 100}% 命中率`);
   * ```
   */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      clears: this.clears,
      evictions: this.evictions,
      size: this.store.size,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ─── 内部方法 ───

  /**
   * 如果当前容量已达到 `maxSize`，淘汰 Map 头部条目（最久未使用）。
   *
   * 每次淘汰递增 `evictions` 计数器。
   * 此方法仅在新增条目（set 新 key / getOrCompute 未命中）时调用。
   */
  private evictIfNeeded(): void {
    while (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value as K;
      this.store.delete(oldestKey);
      this.evictions++;
    }
  }
}

/**
 * 缓存统计信息（不可变快照）
 */
export interface CacheStats {
  /** 缓存名称 */
  name: string;

  /** 命中次数（get 命中 / getOrCompute 命中） */
  hits: number;

  /** 未命中次数（get 返回 undefined / getOrCompute 触发 factory） */
  misses: number;

  /** 设置次数（含覆盖写入） */
  sets: number;

  /** 清空次数（clear 调用次数） */
  clears: number;

  /** LRU 淘汰次数（因容量满而被驱逐的条目数） */
  evictions: number;

  /** 当前缓存条目数 */
  size: number;

  /**
   * 缓存命中率，范围 [0, 1]。
   *
   * 计算公式：`hits / (hits + misses)`。
   * 若无任何查询记录（hits + misses === 0），返回 `0`。
   */
  hitRate: number;
}
