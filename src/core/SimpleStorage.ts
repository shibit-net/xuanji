// ============================================================
// SimpleStorage — 轻量 JSONL 文件存储工具
// ============================================================
// 供 ReminderEngine、ProactiveButler 等非记忆系统模块使用
// 替代已删除的 StorageBackend

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 轻量 JSONL 文件存储
 *
 * 每行一个 JSON 对象，支持追加写入和全量覆盖。
 */
export class SimpleStorage {
  /** 读取 JSONL 文件，返回所有记录 */
  async readAll<T>(filePath: string): Promise<T[]> {
    if (!existsSync(filePath)) return [];
    try {
      const content = readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as T);
    } catch {
      return [];
    }
  }

  /** 追加一条记录到 JSONL 文件 */
  async append<T>(filePath: string, record: T): Promise<void> {
    this.ensureDir(filePath);
    appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  }

  /** 覆盖写入全部记录（用于更新状态） */
  async overwrite<T>(filePath: string, records: T[]): Promise<void> {
    this.ensureDir(filePath);
    const content = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
    writeFileSync(filePath, content, 'utf-8');
  }

  private ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
