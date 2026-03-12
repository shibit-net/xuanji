// ============================================================
// M5 权限控制 — 决策持久化存储
// ============================================================
//
// 将用户的 Always/Never 决策持久化到文件，重启后不需重新确认
//

import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DecisionStore' });

/**
 * 持久化决策记录
 */
interface PersistedDecision {
  /** 缓存 key */
  cacheKey: string;
  /** 是否允许 */
  allowed: boolean;
  /** 工具名称 */
  toolName: string;
  /** 记录时间戳 (ISO 8601) */
  timestamp: string;
  /** 可选过期时间 (ISO 8601) */
  expiresAt?: string;
}

/**
 * 决策存储文件格式
 */
interface DecisionStoreData {
  version: number;
  decisions: PersistedDecision[];
}

/**
 * DecisionStore — 权限决策持久化存储
 *
 * 将用户的 Always/Never 决策保存到 .xuanji/permission-decisions.json
 */
export class DecisionStore {
  private filePath: string;
  private decisions: Map<string, PersistedDecision> = new Map();
  /** 串行化保存锁（防止并发写入冲突） */
  private saveLock: Promise<void> = Promise.resolve();
  private loaded: boolean = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * 从文件加载决策
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const data: DecisionStoreData = JSON.parse(content);

      if (!data.decisions || !Array.isArray(data.decisions)) {
        log.warn('Invalid decision store format, resetting');
        this.decisions = new Map();
        this.loaded = true;
        return;
      }

      // 加载并过滤过期决策
      const now = new Date();
      let expiredCount = 0;

      for (const decision of data.decisions) {
        // 检查是否过期
        if (decision.expiresAt && new Date(decision.expiresAt) < now) {
          expiredCount++;
          continue;
        }

        this.decisions.set(decision.cacheKey, decision);
      }

      this.loaded = true;
      log.debug(`Loaded ${this.decisions.size} permission decisions (${expiredCount} expired)`);

      // 如果有过期的决策，自动清理文件（走 saveLock 防并发）
      if (expiredCount > 0) {
        this.saveLock = this.saveLock
          .then(() => this.save())
          .catch(() => {});
      }
    } catch (err) {
      // 文件不存在或格式错误时创建空存储
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        log.debug('Decision store file not found, will create on first save');
      } else {
        log.warn(`Failed to load decision store: ${(err as Error).message}`);
      }
      this.decisions = new Map();
      this.loaded = true;
    }
  }

  /**
   * 获取决策
   *
   * @returns true=允许, false=拒绝, undefined=未记录
   */
  get(cacheKey: string): boolean | undefined {
    const decision = this.decisions.get(cacheKey);
    if (!decision) {
      return undefined;
    }

    // 检查是否过期
    if (decision.expiresAt && new Date(decision.expiresAt) < new Date()) {
      this.decisions.delete(cacheKey);
      // 过期清理走 saveLock，避免与 set() 并发写入
      this.saveLock = this.saveLock
        .then(() => this.save())
        .catch(() => {});
      return undefined;
    }

    return decision.allowed;
  }

  /**
   * 设置决策（立即触发异步保存）
   */
  async set(cacheKey: string, allowed: boolean, toolName: string, ttlDays?: number): Promise<void> {
    const decision: PersistedDecision = {
      cacheKey,
      allowed,
      toolName,
      timestamp: new Date().toISOString(),
    };

    // 如果指定了 TTL，计算过期时间
    if (ttlDays && ttlDays > 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + ttlDays);
      decision.expiresAt = expiresAt.toISOString();
    }

    this.decisions.set(cacheKey, decision);

    // 异步保存（串行化，防止并发冲突）
    this.saveLock = this.saveLock
      .then(() => this.save())
      .catch((err) => {
        log.error('Failed to save decision store:', err);
      });
  }

  /**
   * 删除决策
   */
  async delete(cacheKey: string): Promise<void> {
    this.decisions.delete(cacheKey);
    this.saveLock = this.saveLock
      .then(() => this.save())
      .catch(() => {});
  }

  /**
   * 清空所有决策
   */
  async clear(): Promise<void> {
    this.decisions.clear();
    this.saveLock = this.saveLock
      .then(() => this.save())
      .catch(() => {});
  }

  /**
   * 获取所有决策（用于调试）
   */
  getAll(): PersistedDecision[] {
    return Array.from(this.decisions.values());
  }

  /**
   * 是否已加载
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 保存到文件（私有，通过 saveLock 串行化）
   */
  private async save(): Promise<void> {
    try {
      // 确保目录存在
      await mkdir(dirname(this.filePath), { recursive: true });

      // 构建数据
      const data: DecisionStoreData = {
        version: 1,
        decisions: Array.from(this.decisions.values()),
      };

      // 原子写入（写临时文件 → rename）
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

      try {
        await rename(tmpPath, this.filePath);
      } catch {
        // rename 失败时直接写入（并清理临时文件）
        await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        await unlink(tmpPath).catch(() => {});
      }

      log.debug(`Saved ${this.decisions.size} permission decisions to ${this.filePath}`);
    } catch (err) {
      log.error(`Failed to save decision store: ${(err as Error).message}`);
      throw err;
    }
  }
}
