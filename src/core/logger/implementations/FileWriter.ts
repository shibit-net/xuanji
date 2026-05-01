// ============================================================
// Logger System — 文件写入器（共享组件）
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import type { LogLevel } from '../types';

/**
 * 异步文件写入器
 *
 * 所有 Logger 实现共享此组件，实现日志持久化。
 * - 异步追加写入，不阻塞主流程
 * - 自动创建目录
 * - 按日志级别分文件输出
 * - 写入失败静默处理
 */
/** 单个日志文件最大大小（10MB），超过后截断保留后半部分 */
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

export class FileWriter {
  private fileHandles: Map<LogLevel, fs.FileHandle> = new Map();
  private filePaths: Map<LogLevel, string> = new Map();
  private ready: Promise<void>;
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });

      // 为每个日志级别打开对应的文件句柄
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      for (const level of levels) {
        const filePath = path.join(this.baseDir, `${level}.log`);
        this.filePaths.set(level, filePath);
        const handle = await fs.open(filePath, 'a');
        this.fileHandles.set(level, handle);
      }
    } catch {
      // 文件初始化失败不影响控制台日志
    }
  }

  /**
   * 格式化时间戳为易读格式
   * 格式: 2026-04-17 13:55:08.012
   */
  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * 写入一行日志（异步，不阻塞）
   */
  write(level: LogLevel, namespace: string, message: string, args: unknown[]): void {
    const argsStr = args.length > 0
      ? ' ' + args.map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(' ')
      : '';

    const logLine = `[${this.formatTimestamp()}] [${level.toUpperCase().padEnd(5)}] [${namespace}] ${message}${argsStr}\n`;

    const doWrite = async () => {
      await this.ready;
      const filePath = this.filePaths.get(level);
      const handle = this.fileHandles.get(level);
      if (!handle || !filePath) return;

      // 检查文件大小，超过上限则轮转到日期文件
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > MAX_LOG_FILE_SIZE) {
          await handle.close();
          // 轮转：重命名为 <level>-YYYY-MM-DD.log
          const today = new Date().toISOString().split('T')[0]!;
          const rotatedPath = path.join(this.baseDir, `${level}-${today}.log`);
          await fs.rename(filePath, rotatedPath);
          // 创建新的活跃文件并写入当前日志行
          const newHandle = await fs.open(filePath, 'a');
          this.fileHandles.set(level, newHandle);
          await newHandle.write(logLine);
          return;
        }
      } catch {
        // 大小检查失败不阻塞写入
      }

      await handle.write(logLine);
    };
    doWrite().catch(() => {});
  }

  /**
   * 关闭所有文件句柄
   */
  async close(): Promise<void> {
    await this.ready;
    for (const handle of this.fileHandles.values()) {
      await handle.close();
    }
    this.fileHandles.clear();
  }
}

// ── 全局单例 ─────────────────────────────────────────────

let globalWriter: FileWriter | null = null;

/**
 * 获取全局共享 FileWriter
 *
 * 所有 Logger 实例（包括 child）共用同一组文件句柄，
 * 避免重复打开文件。
 */
export function getFileWriter(baseDir: string): FileWriter {
  if (!globalWriter) {
    globalWriter = new FileWriter(baseDir);
  }
  return globalWriter;
}

/**
 * 关闭全局 FileWriter（进程退出时调用）
 */
export async function closeFileWriter(): Promise<void> {
  if (globalWriter) {
    await globalWriter.close();
    globalWriter = null;
  }
}

/**
 * 重置全局 FileWriter（仅用于测试）
 */
export async function resetFileWriter(): Promise<void> {
  if (globalWriter) {
    await globalWriter.close();
    globalWriter = null;
  }
}
