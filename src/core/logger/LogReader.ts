// ============================================================
// Logger System — 日志读取器
// ============================================================
// 职责：
// - 读取持久化的日志文件
// - 支持按级别、时间范围、关键词过滤
// - 支持实时监听日志文件变化（tail -f 效果）
// - 解析日志行为结构化数据
// ============================================================

import { promises as fs } from 'fs';
import { watch } from 'fs';
import path from 'path';
import type { LogLevel } from './types';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  namespace: string;
  message: string;
  raw: string;
}

export interface LogQuery {
  levels?: LogLevel[];
  startTime?: Date;
  endTime?: Date;
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface LogWatchCallback {
  (record: LogRecord): void;
}

/**
 * 日志读取器
 *
 * 从 ~/.xuanji/logs/ 读取持久化日志文件
 */
export class LogReader {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 解析日志行
   * 格式: [2026-04-12T10:30:45.123Z] [INFO ] [xuanji:AgentLoop] 开始执行任务
   */
  private parseLine(line: string, level: LogLevel): LogRecord | null {
    const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/);
    if (!match) return null;

    const [, timestamp, , namespace, message] = match;
    return {
      timestamp,
      level,
      namespace,
      message: message.trim(),
      raw: line,
    };
  }

  /**
   * 读取指定级别的日志文件
   */
  async readLevel(level: LogLevel, query?: LogQuery): Promise<LogRecord[]> {
    const filePath = path.join(this.baseDir, `${level}.log`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      let records = lines
        .map(line => this.parseLine(line, level))
        .filter((r): r is LogRecord => r !== null);

      // 应用过滤
      if (query) {
        records = this.applyFilters(records, query);
      }

      return records;
    } catch (error) {
      // 文件不存在或读取失败，返回空数组
      return [];
    }
  }

  /**
   * 读取所有级别的日志
   */
  async readAll(query?: LogQuery): Promise<LogRecord[]> {
    const levels: LogLevel[] = query?.levels || ['debug', 'info', 'warn', 'error'];

    const results = await Promise.all(
      levels.map(level => this.readLevel(level, query))
    );

    // 合并并按时间排序
    const allRecords = results.flat();
    allRecords.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // 应用分页
    if (query?.offset !== undefined || query?.limit !== undefined) {
      const offset = query.offset || 0;
      const limit = query.limit || allRecords.length;
      return allRecords.slice(offset, offset + limit);
    }

    return allRecords;
  }

  /**
   * 获取最新的 N 条日志
   */
  async readLatest(count: number = 100, levels?: LogLevel[]): Promise<LogRecord[]> {
    const allRecords = await this.readAll({ levels });
    return allRecords.slice(-count);
  }

  /**
   * 应用过滤条件
   */
  private applyFilters(records: LogRecord[], query: LogQuery): LogRecord[] {
    let filtered = records;

    // 时间范围过滤
    if (query.startTime) {
      const startISO = query.startTime.toISOString();
      filtered = filtered.filter(r => r.timestamp >= startISO);
    }
    if (query.endTime) {
      const endISO = query.endTime.toISOString();
      filtered = filtered.filter(r => r.timestamp <= endISO);
    }

    // 关键词过滤
    if (query.keyword) {
      const keyword = query.keyword.toLowerCase();
      filtered = filtered.filter(r =>
        r.message.toLowerCase().includes(keyword) ||
        r.namespace.toLowerCase().includes(keyword)
      );
    }

    return filtered;
  }

  /**
   * 监听日志文件变化（实时追踪）
   *
   * @param levels 要监听的日志级别
   * @param callback 新日志回调
   * @returns 停止监听的函数
   */
  watchLogs(levels: LogLevel[], callback: LogWatchCallback): () => void {
    const watchers: ReturnType<typeof watch>[] = [];
    const lastPositions = new Map<LogLevel, number>();

    for (const level of levels) {
      const filePath = path.join(this.baseDir, `${level}.log`);

      // 初始化：记录当前文件大小
      fs.stat(filePath)
        .then(stats => lastPositions.set(level, stats.size))
        .catch(() => lastPositions.set(level, 0));

      // 监听文件变化
      const watcher = watch(filePath, async (eventType) => {
        if (eventType !== 'change') return;

        try {
          const stats = await fs.stat(filePath);
          const lastPos = lastPositions.get(level) || 0;

          if (stats.size <= lastPos) {
            // 文件被截断或重写
            lastPositions.set(level, stats.size);
            return;
          }

          // 读取新增内容
          const fd = await fs.open(filePath, 'r');
          const buffer = Buffer.alloc(stats.size - lastPos);
          await fd.read(buffer, 0, buffer.length, lastPos);
          await fd.close();

          const newContent = buffer.toString('utf-8');
          const newLines = newContent.split('\n').filter(line => line.trim());

          // 解析并回调
          for (const line of newLines) {
            const record = this.parseLine(line, level);
            if (record) {
              callback(record);
            }
          }

          lastPositions.set(level, stats.size);
        } catch (error) {
          // 忽略读取错误
        }
      });

      watchers.push(watcher);
    }

    // 返回清理函数
    return () => {
      watchers.forEach(w => w.close());
    };
  }

  /**
   * 清空所有日志文件
   */
  async clearAll(): Promise<void> {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    await Promise.all(
      levels.map(level => {
        const filePath = path.join(this.baseDir, `${level}.log`);
        return fs.writeFile(filePath, '').catch(() => {});
      })
    );
  }

  /**
   * 获取日志文件统计信息
   */
  async getStats(): Promise<Record<LogLevel, { size: number; lines: number }>> {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const stats: Record<string, { size: number; lines: number }> = {};

    for (const level of levels) {
      const filePath = path.join(this.baseDir, `${level}.log`);
      try {
        const stat = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim()).length;
        stats[level] = { size: stat.size, lines };
      } catch {
        stats[level] = { size: 0, lines: 0 };
      }
    }

    return stats as Record<LogLevel, { size: number; lines: number }>;
  }
}
