// ============================================================
// M1 终端 UI — 日志系统
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import type { LogEntry } from '../types';
import { formatShortTime } from '../../../shared/utils/time/formatters.js';

type LogSource = LogEntry['source'];

const LOGS_DIR = join(process.cwd(), '.xuanji', 'logs');

/** 日志文件保留天数 */
const LOG_RETENTION_DAYS = 30;

/**
 * CLI 日志系统
 * 支持 JSONL 格式文件存储和内存缓存（环形缓冲区）
 */
export class LogSystem {
  private static readonly LEVEL_ORDER: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  /** 环形缓冲区，避免 shift() O(n) 开销 */
  private memoryCache: (LogEntry | undefined)[];
  private cacheWriteIndex = 0;
  private cacheCount = 0;
  private maxCacheSize = 500;
  private logCallbacks: Array<(entry: LogEntry) => void> = [];
  private minLevel: string = 'debug';

  constructor() {
    // 支持环境变量控制日志级别
    const envLevel = process.env.XUANJI_LOG_LEVEL;
    if (envLevel && LogSystem.LEVEL_ORDER[envLevel] !== undefined) {
      this.minLevel = envLevel;
    }

    this.memoryCache = new Array(this.maxCacheSize);

    // 初始化日志目录
    this.ensureLogsDir().catch(() => {
      // 忽略创建失败
    });
  }

  /**
   * 设置最低日志级别（低于此级别的日志将被丢弃）
   */
  setMinLevel(level: string): void {
    this.minLevel = level;
  }

  private async ensureLogsDir(): Promise<void> {
    await mkdir(LOGS_DIR, { recursive: true });
  }

  /**
   * 追加日志到文件和内存缓存
   */
  async appendLog(entry: LogEntry): Promise<void> {
    // 级别过滤
    const entryLevel = LogSystem.LEVEL_ORDER[entry.level] ?? 0;
    const minLevel = LogSystem.LEVEL_ORDER[this.minLevel] ?? 0;
    if (entryLevel < minLevel) return;

    // 添加到内存缓存（环形缓冲区，O(1) 写入）
    this.memoryCache[this.cacheWriteIndex] = entry;
    this.cacheWriteIndex = (this.cacheWriteIndex + 1) % this.maxCacheSize;
    if (this.cacheCount < this.maxCacheSize) {
      this.cacheCount++;
    }

    // 触发回调
    for (const callback of this.logCallbacks) {
      callback(entry);
    }

    // 异步写入文件
    try {
      await this.writeToFile(entry);
    } catch (error) {
      // 日志写入失败：fallback 到 stderr（避免递归调用 logger）
      process.stderr.write(`[LogSystem] Failed to write log: ${error}\n`);
    }
  }

  /**
   * 记录 info 级别日志
   */
  async info(source: LogSource, message: string): Promise<void> {
    const entry: LogEntry = {
      timestamp: formatShortTime(new Date()),
      source,
      message,
      level: 'info',
    };
    await this.appendLog(entry);
  }

  /**
   * 记录 warn 级别日志
   */
  async warn(source: LogSource, message: string): Promise<void> {
    const entry: LogEntry = {
      timestamp: formatShortTime(new Date()),
      source,
      message,
      level: 'warn',
    };
    await this.appendLog(entry);
  }

  /**
   * 记录 error 级别日志
   */
  async error(source: LogSource, message: string): Promise<void> {
    const entry: LogEntry = {
      timestamp: formatShortTime(new Date()),
      source,
      message,
      level: 'error',
    };
    await this.appendLog(entry);
  }

  /**
   * 加载最近 N 天的日志
   * @param days 天数（默认 3）
   * @param maxLines 最大行数（默认 500）
   */
  async loadRecentLogs(days = 3, maxLines = 500): Promise<LogEntry[]> {
    const logs: LogEntry[] = [];
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      const files = await readdir(LOGS_DIR);
      const logFiles = files
        .filter(f => f.endsWith('.log'))
        .map(f => {
          const date = this.parseLogFilename(f);
          return { name: f, date };
        })
        .filter(f => f.date && f.date >= startDate)
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

      for (const file of logFiles) {
        const content = await readFile(join(LOGS_DIR, file.name), 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (line) {
            try {
              const entry = JSON.parse(line) as LogEntry;
              // 按当前 minLevel 过滤
              const entryLevel = LogSystem.LEVEL_ORDER[entry.level] ?? 0;
              const minLevelVal = LogSystem.LEVEL_ORDER[this.minLevel] ?? 0;
              if (entryLevel < minLevelVal) continue;
              logs.push(entry);
              if (logs.length >= maxLines) {
                return logs.slice(0, maxLines);
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      }
    } catch {
      // 加载失败返回空列表
    }

    return logs.slice(0, maxLines);
  }

  /**
   * 注册日志回调
   */
  onLog(callback: (entry: LogEntry) => void): () => void {
    this.logCallbacks.push(callback);
    // 返回取消函数
    return () => {
      const idx = this.logCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.logCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * 清空内存缓存
   */
  clearMemoryCache(): void {
    this.memoryCache = new Array(this.maxCacheSize);
    this.cacheWriteIndex = 0;
    this.cacheCount = 0;
  }

  /** 从环形缓冲区获取有序日志 */
  getMemoryCacheLogs(): LogEntry[] {
    if (this.cacheCount === 0) return [];
    const result: LogEntry[] = [];
    const start = this.cacheCount < this.maxCacheSize ? 0 : this.cacheWriteIndex;
    for (let i = 0; i < this.cacheCount; i++) {
      const entry = this.memoryCache[(start + i) % this.maxCacheSize];
      if (entry) result.push(entry);
    }
    return result;
  }

  /**
   * 清理超过保留期的旧日志文件
   */
  async cleanupOldFiles(retentionDays = LOG_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().split('T')[0]!;

    try {
      const files = await readdir(LOGS_DIR);
      let deleted = 0;

      for (const file of files) {
        const match = file.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
        if (match && match[1]! < cutoffStr) {
          try {
            await unlink(join(LOGS_DIR, file));
            deleted++;
          } catch {
            // 删除失败跳过
          }
        }
      }

      return deleted;
    } catch {
      return 0;
    }
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    await this.ensureLogsDir();
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const logPath = join(LOGS_DIR, `${dateStr}.log`);

    const line = JSON.stringify(entry) + '\n';
    try {
      await writeFile(logPath, line, { flag: 'a' }); // 追加模式（自动创建文件）
    } catch {
      // 写入失败静默处理，避免日志系统自身错误影响主流程
    }
  }

  private parseLogFilename(filename: string): Date | null {
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.log$/);
    if (match) {
      return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    }
    return null;
  }
}
