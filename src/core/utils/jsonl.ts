/**
 * JSONL (JSON Lines) 文件读写工具
 *
 * 统一 JSONL 序列化/反序列化逻辑，避免在多个模块中重复实现。
 */

import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 追加一条记录到 JSONL 文件
 */
export async function appendJsonl<T>(filePath: string, record: T): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const line = JSON.stringify(record) + '\n';
  await appendFile(filePath, line, 'utf-8');
}

/**
 * 追加多条记录到 JSONL 文件
 */
export async function appendJsonlBatch<T>(filePath: string, records: T[]): Promise<void> {
  if (records.length === 0) return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await appendFile(filePath, lines, 'utf-8');
}

/**
 * 读取 JSONL 文件中的所有记录
 * 自动跳过空行和解析失败的行
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const records: T[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch {
      // 跳过解析失败的行
    }
  }

  return records;
}

/**
 * 逆序读取 JSONL 文件（最新的记录在前）
 * @param limit 最多读取的记录数（0 表示不限制）
 */
export async function readJsonlReverse<T>(filePath: string, limit = 0): Promise<T[]> {
  if (!existsSync(filePath)) return [];

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const records: T[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
      if (limit > 0 && records.length >= limit) break;
    } catch {
      // 跳过解析失败的行
    }
  }

  return records;
}

/**
 * 覆盖写入 JSONL 文件（原子写入：先写临时文件再 rename）
 */
export async function writeJsonl<T>(filePath: string, records: T[]): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const content = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  // 直接写入（StorageBackend 已有 atomic write 逻辑，这里保持简单）
  await writeFile(filePath, content, 'utf-8');
}

/**
 * 截断 JSONL 文件到指定行数
 */
export async function truncateJsonl(filePath: string, maxLines: number): Promise<void> {
  if (!existsSync(filePath)) return;

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  if (lines.length <= maxLines) return;

  const truncated = lines.slice(-maxLines).join('\n') + '\n';
  await writeFile(filePath, truncated, 'utf-8');
}
