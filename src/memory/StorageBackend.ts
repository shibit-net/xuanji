// ============================================================
// M4 记忆系统 — JSONL 存储后端
// ============================================================

import { appendFile, readFile, mkdir, unlink, rename, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'storage-backend' });

/**
 * JSONL 文件存储后端
 *
 * 参考 SessionRecorder / AuditLogger 的模式：
 * - 追加写入（appendFile）
 * - 容错解析（逐行 JSON.parse）
 * - 原子性覆盖（先写 .tmp 再 rename）
 */
export class StorageBackend {
  /** 追加一条记录到 JSONL 文件（失败时抛出异常） */
  async append<T>(filePath: string, record: T): Promise<void> {
    const dir = join(filePath, '..');
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(record) + '\n';
    await appendFile(filePath, line, 'utf-8');
  }

  /** 读取所有记录 */
  async readAll<T>(filePath: string): Promise<T[]> {
    try {
      if (!existsSync(filePath)) return [];
      const text = await readFile(filePath, 'utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      const records: T[] = [];
      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as T);
        } catch {
          // 跳过格式错误的行
        }
      }
      return records;
    } catch {
      return [];
    }
  }

  /** 从文件末尾读取最近 N 条记录（滑动窗口，避免全量解析；返回时间正序：最旧在前，最新在后） */
  async readRecent<T>(filePath: string, limit: number): Promise<T[]> {
    try {
      if (!existsSync(filePath)) return [];
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });
      const window: T[] = [];
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          window.push(JSON.parse(line) as T);
          if (window.length > limit) window.shift();
        } catch {
          // 跳过格式错误的行
        }
      }
      return window;
    } catch {
      return [];
    }
  }

  /** 原子性覆盖文件（先写 .tmp，成功后 rename） */
  async overwrite<T>(filePath: string, records: T[]): Promise<void> {
    try {
      const dir = join(filePath, '..');
      await mkdir(dir, { recursive: true });
      const tmpPath = filePath + '.tmp';
      const content = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
      await writeFile(tmpPath, content, 'utf-8');
      await rename(tmpPath, filePath);
    } catch (err) {
      log.warn(`Failed to overwrite ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** 删除文件 */
  async clear(filePath: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch (err) {
      log.warn(`Failed to clear ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** 检查文件是否存在 */
  exists(filePath: string): boolean {
    return existsSync(filePath);
  }
}
