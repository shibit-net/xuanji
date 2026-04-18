// ============================================================
// FileStorage - 文件存储实现
// ============================================================
// 基于文件系统的存储，每个条目一个 JSON 文件
//
// 特性:
// - 简单、易于调试
// - 支持基础 IStorage 接口
// - 适合小规模数据
// - 不支持事务和复杂查询
// ============================================================

import type { IStorage, QueryFilter, ISerializer } from './interfaces';
import { JSONSerializer } from './interfaces';
import { readFile, writeFile, readdir, unlink, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'FileStorage' });

/**
 * FileStorage - 文件存储实现
 */
export class FileStorage<T> implements IStorage<T> {
  private serializer: ISerializer<T>;

  constructor(
    private baseDir: string,
    serializer?: ISerializer<T>
  ) {
    this.serializer = serializer || new JSONSerializer<T>();
    this.ensureDir();
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    try {
      await access(this.baseDir);
    } catch {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  /**
   * 获取文件路径
   */
  private getFilePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  // ============================================================
  // IStorage 接口实现
  // ============================================================

  async save(id: string, data: T): Promise<void> {
    await this.ensureDir();
    const filePath = this.getFilePath(id);
    const serialized = this.serializer.serialize(data);
    await writeFile(filePath, serialized, 'utf-8');
  }

  async load(id: string): Promise<T | null> {
    const filePath = this.getFilePath(id);
    try {
      const content = await readFile(filePath, 'utf-8');
      return this.serializer.deserialize(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async query(filter: QueryFilter): Promise<T[]> {
    await this.ensureDir();
    const files = await readdir(this.baseDir);
    const results: T[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const id = file.replace('.json', '');
      const data = await this.load(id);

      if (data && this.matchFilter(data, filter.where || {})) {
        results.push(data);
      }
    }

    // orderBy 排序
    if (filter.orderBy && filter.orderBy.length > 0) {
      results.sort((a, b) => {
        for (const order of filter.orderBy!) {
          const aVal = (a as any)[order.field];
          const bVal = (b as any)[order.field];
          if (aVal < bVal) return order.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return order.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    // offset + limit
    const offset = filter.offset || 0;
    const limit = filter.limit || results.length;
    return results.slice(offset, offset + limit);
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getFilePath(id);
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(id: string): Promise<boolean> {
    const filePath = this.getFilePath(id);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // 文件存储无需关闭
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 匹配过滤条件
   */
  private matchFilter(item: any, where: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (item[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取所有 ID
   */
  async getAllIds(): Promise<string[]> {
    await this.ensureDir();
    const files = await readdir(this.baseDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    const ids = await this.getAllIds();
    for (const id of ids) {
      await this.delete(id);
    }
  }
}
