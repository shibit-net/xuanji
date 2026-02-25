// ============================================================
// M10 遥测 — 会话统计持久化 (JSONL)
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * 会话记录
 */
export interface SessionRecord {
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 模型名称 */
  model: string;
  /** 输入 token */
  input: number;
  /** 输出 token */
  output: number;
  /** 缓存读取 token (可选) */
  cacheRead?: number;
  /** 缓存写入 token (可选) */
  cacheWrite?: number;
  /** 会话总耗时 (毫秒) */
  durationMs: number;
}

/**
 * SessionRecorder — 会话统计持久化到 JSONL 文件
 *
 * 特性:
 * - 使用 JSONL 格式 (每行一个 JSON 对象)
 * - 追加友好,流式分析,崩溃安全
 * - 默认存储到 ~/.xuanji/sessions.jsonl
 * - 写入失败静默处理,不影响主流程
 */
export class SessionRecorder {
  private filePath: string;

  /**
   * @param filePath 存储路径 (默认: ~/.xuanji/sessions.jsonl)
   */
  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.xuanji', 'sessions.jsonl');
  }

  /**
   * 记录会话统计
   */
  async record(record: SessionRecord): Promise<void> {
    try {
      // 确保目录存在
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });

      // 追加 JSONL 行 (每条记录一行)
      const line = JSON.stringify(record) + '\n';
      await appendFile(this.filePath, line, 'utf-8');
    } catch (err) {
      // 静默失败,不影响主流程
      // 可选:记录到 logger (如果需要调试)
      // console.error('[SessionRecorder] Failed to record:', err);
    }
  }

  /**
   * 读取最近的 N 条记录 (从后往前)
   * @param limit 最大条数 (默认: 所有记录)
   */
  async readRecords(limit?: number): Promise<SessionRecord[]> {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }

      const text = await readFile(this.filePath, 'utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      const records: SessionRecord[] = [];

      // 从后往前解析 (最新的记录在文件末尾)
      for (let i = lines.length - 1; i >= 0; i--) {
        if (limit && records.length >= limit) break;
        try {
          const record = JSON.parse(lines[i]) as SessionRecord;
          records.push(record);
        } catch {
          // 跳过格式错误的行
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * 清空所有记录
   */
  async clear(): Promise<void> {
    try {
      if (existsSync(this.filePath)) {
        await unlink(this.filePath);
      }
    } catch {
      // 静默失败
    }
  }
}
