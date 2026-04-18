// ============================================================
// ConfigService - 统一配置管理
// ============================================================
// 统一的配置访问接口，支持多层配置源和优先级
//
// 配置优先级（从低到高）:
// 1. 默认配置 (priority: 0)
// 2. 全局配置 (priority: 10)
// 3. 项目配置 (priority: 20)
// 4. 环境变量 (priority: 30)
// 5. 运行时配置 (priority: 40)
//
// 特性:
// - 统一的配置访问接口
// - 支持配置监听（watch）
// - 支持热更新（reload）
// - 类型安全
// ============================================================

import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfigService' });

/**
 * 配置源接口
 */
export interface IConfigSource {
  /** 配置源名称 */
  name: string;
  /** 优先级（数字越大优先级越高） */
  priority: number;
  /** 加载配置 */
  load(): Promise<Record<string, any>>;
  /** 保存配置（可选） */
  save?(config: Record<string, any>): Promise<void>;
}

/**
 * 配置监听器
 */
export type ConfigWatcher = (value: any) => void;

/**
 * ConfigService - 统一配置服务
 */
export class ConfigService {
  private sources: IConfigSource[] = [];
  private merged: Record<string, any> = {};
  private watchers = new Map<string, Set<ConfigWatcher>>();
  private loaded = false;

  constructor(sources: IConfigSource[]) {
    // 按优先级排序（低到高）
    this.sources = sources.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 加载所有配置源
   */
  async load(): Promise<void> {
    log.info('Loading configuration...');

    this.merged = {};
    for (const source of this.sources) {
      try {
        log.debug(`Loading config from: ${source.name}`);
        const config = await source.load();
        this.merged = this.deepMerge(this.merged, config);
      } catch (error) {
        log.warn(`Failed to load config from ${source.name}:`, error);
      }
    }

    this.loaded = true;
    log.info('Configuration loaded successfully');
  }

  /**
   * 获取配置值
   */
  get<T = any>(key: string, defaultValue?: T): T {
    if (!this.loaded) {
      throw new Error('ConfigService not loaded. Call load() first.');
    }

    const value = this.getByPath(this.merged, key);
    return value !== undefined ? value : defaultValue as T;
  }

  /**
   * 设置配置值（运行时）
   */
  set(key: string, value: any): void {
    if (!this.loaded) {
      throw new Error('ConfigService not loaded. Call load() first.');
    }

    this.setByPath(this.merged, key, value);
    this.notifyWatchers(key, value);
  }

  /**
   * 检查配置是否存在
   */
  has(key: string): boolean {
    return this.getByPath(this.merged, key) !== undefined;
  }

  /**
   * 监听配置变化
   */
  watch(key: string, callback: ConfigWatcher): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key)!.add(callback);

    // 返回取消监听函数
    return () => {
      this.watchers.get(key)?.delete(callback);
    };
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    log.info('Reloading configuration...');

    await this.load();

    // 通知所有监听器
    for (const [key, callbacks] of this.watchers) {
      const value = this.get(key);
      for (const callback of callbacks) {
        try {
          callback(value);
        } catch (error) {
          log.error(`Error in config watcher for ${key}:`, error);
        }
      }
    }

    log.info('Configuration reloaded');
  }

  /**
   * 获取完整配置（只读）
   */
  getAll(): Readonly<Record<string, any>> {
    return { ...this.merged };
  }

  /**
   * 保存配置到指定源
   */
  async save(sourceName: string, config: Record<string, any>): Promise<void> {
    const source = this.sources.find(s => s.name === sourceName);
    if (!source) {
      throw new Error(`Config source not found: ${sourceName}`);
    }

    if (!source.save) {
      throw new Error(`Config source ${sourceName} does not support saving`);
    }

    await source.save(config);
    log.info(`Configuration saved to ${sourceName}`);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 通知监听器
   */
  private notifyWatchers(key: string, value: any): void {
    const callbacks = this.watchers.get(key);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(value);
        } catch (error) {
          log.error(`Error in config watcher for ${key}:`, error);
        }
      }
    }
  }

  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    if (!source) return target;
    if (!target) return source;

    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * 通过路径获取值
   */
  private getByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * 通过路径设置值
   */
  private setByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current = obj;

    for (const key of keys) {
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
  }
}
