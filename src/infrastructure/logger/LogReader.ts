/**
 * Logger System — 日志读取器（JSONL 格式）
 *
 * 读取 .xuanji/logs/xuanji.jsonl 文件，每行一个 JSON。
 * 支持按 execId、时间、级别、关键词过滤。
 *
 * 查询示例：
 *   grep '"execId":"exec-abc"' xuanji.jsonl         ← 查某次执行的全部日志
 *   grep '"depth":1' xuanji.jsonl                     ← 查所有子 agent 日志
 *   grep '"level":"error"' xuanji.jsonl | tail -5     ← 查最近5条错误
 */

import { promises as fs } from 'fs';
import { watch } from 'fs';
import path from 'path';

export interface LogRecord {
  time: string;
  level: string;
  ns: string;
  msg: string;
  execId?: string;
  depth?: number;
  err?: { message?: string; stack?: string };
  raw: string;
}

export interface LogQuery {
  levels?: string[];
  execId?: string;
  startTime?: string;
  endTime?: string;
  keyword?: string;
  minDepth?: number;
  maxDepth?: number;
  limit?: number;
  offset?: number;
}

export interface LogWatchCallback {
  (record: LogRecord): void;
}

export class LogReader {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 获取所有日志文件路径（按日期排序，最新的在前面）
   */
  private async getLogFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.baseDir);
      return files
        .filter(f => /^xuanji-\d{4}-\d{2}-\d{2}(-\d+)?\.jsonl$/.test(f))
        .sort()
        .reverse()
        .map(f => path.join(this.baseDir, f));
    } catch {
      return [];
    }
  }

  /**
   * 解析 JSONL 行
   */
  private parseLine(line: string): LogRecord | null {
    try {
      const parsed = JSON.parse(line);
      return {
        time: parsed.time || '',
        level: parsed.level || 'info',
        ns: parsed.ns || '',
        msg: parsed.msg || '',
        execId: parsed.execId,
        depth: parsed.depth,
        err: parsed.err,
        raw: line,
      };
    } catch {
      return null;
    }
  }

  /**
   * 查询日志
   */
  async query(query?: LogQuery): Promise<LogRecord[]> {
    try {
      const files = await this.getLogFiles();
      if (files.length === 0) return [];

      let allRecords: LogRecord[] = [];

      for (const filePath of files) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const records = content
            .split('\n')
            .filter(l => l.trim())
            .map(l => this.parseLine(l))
            .filter((r): r is LogRecord => r !== null);
          allRecords.push(...records);
        } catch {
          // skip unreadable files
        }
      }

      allRecords = this.applyFilters(allRecords, query);
      return allRecords;
    } catch {
      return [];
    }
  }

  /**
   * 按 execId 查询（一次完整执行链路）
   */
  async findByExecId(execId: string, query?: Omit<LogQuery, 'execId'>): Promise<LogRecord[]> {
    return this.query({ ...query, execId });
  }

  /**
   * 获取最新的 N 条日志
   */
  async readLatest(count: number = 100, levels?: string[]): Promise<LogRecord[]> {
    return this.query({ levels, limit: count });
  }

  /**
   * 应用过滤条件
   */
  private applyFilters(records: LogRecord[], query?: LogQuery): LogRecord[] {
    if (!query) return records;

    let filtered = records;

    if (query.levels && query.levels.length > 0) {
      const levelSet = new Set(query.levels);
      filtered = filtered.filter(r => levelSet.has(r.level));
    }

    if (query.execId) {
      filtered = filtered.filter(r => r.execId === query.execId);
    }

    if (query.startTime) {
      filtered = filtered.filter(r => r.time >= query.startTime!);
    }

    if (query.endTime) {
      filtered = filtered.filter(r => r.time <= query.endTime!);
    }

    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      filtered = filtered.filter(r =>
        r.msg.toLowerCase().includes(kw) ||
        r.ns.toLowerCase().includes(kw) ||
        (r.execId && r.execId.toLowerCase().includes(kw))
      );
    }

    if (query.minDepth !== undefined) {
      filtered = filtered.filter(r => r.depth !== undefined && r.depth >= query.minDepth!);
    }

    if (query.maxDepth !== undefined) {
      filtered = filtered.filter(r => r.depth !== undefined && r.depth <= query.maxDepth!);
    }

    // 按时间排序
    filtered.sort((a, b) => a.time.localeCompare(b.time));

    // 分页
    if (query.offset !== undefined || query.limit !== undefined) {
      const offset = query.offset || 0;
      const limit = query.limit || filtered.length;
      return filtered.slice(offset, offset + limit);
    }

    return filtered;
  }

  /**
   * 监听日志文件变化（实时追踪当前日期的日志文件）
   */
  watchLogs(callback: LogWatchCallback): () => void {
    let lastSize = 0;
    let currentWatcher: ReturnType<typeof watch> | null = null;
    let cleanup = false;

    const watchCurrentFile = async () => {
      const files = await this.getLogFiles();
      const latestFile = files[0]; // 最新的文件
      if (!latestFile) return;

      lastSize = 0;
      try {
        const stats = await fs.stat(latestFile);
        lastSize = stats.size;
      } catch { lastSize = 0; }

      currentWatcher?.close();
      currentWatcher = watch(latestFile, async (eventType) => {
        if (eventType !== 'change' || cleanup) return;
        try {
          const stats = await fs.stat(latestFile);
          if (stats.size <= lastSize) { lastSize = stats.size; return; }
          const fd = await fs.open(latestFile, 'r');
          const buffer = Buffer.alloc(stats.size - lastSize);
          await fd.read(buffer, 0, buffer.length, lastSize);
          await fd.close();
          for (const line of buffer.toString('utf-8').split('\n').filter(l => l.trim())) {
            const record = this.parseLine(line);
            if (record) callback(record);
          }
          lastSize = stats.size;
        } catch { /* ignore */ }
      });
    };

    watchCurrentFile();
    // 每分钟检查是否有新文件（日期切换或大小轮转）
    const timer = setInterval(watchCurrentFile, 60_000);

    return () => {
      cleanup = true;
      currentWatcher?.close();
      clearInterval(timer);
    };
  }

  /**
   * 清空所有日志文件
   */
  async clearAll(): Promise<void> {
    const files = await this.getLogFiles();
    await Promise.all(files.map(f => fs.writeFile(f, '').catch(() => {})));
  }

  /**
   * 获取所有日志文件的统计信息
   */
  async getStats(): Promise<{ size: number; lines: number; files: number }> {
    const files = await this.getLogFiles();
    let totalSize = 0;
    let totalLines = 0;

    for (const f of files) {
      try {
        const stat = await fs.stat(f);
        totalSize += stat.size;
        const content = await fs.readFile(f, 'utf-8');
        totalLines += content.split('\n').filter(l => l.trim()).length;
      } catch { /* skip */ }
    }

    return { size: totalSize, lines: totalLines, files: files.length };
  }
}
