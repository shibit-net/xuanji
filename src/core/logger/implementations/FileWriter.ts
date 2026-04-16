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
export class FileWriter {
  private fileHandles: Map<LogLevel, fs.FileHandle> = new Map();
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
        const handle = await fs.open(filePath, 'a');
        this.fileHandles.set(level, handle);
      }
    } catch {
      // 文件初始化失败不影响控制台日志
    }
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

    const logLine = `[${new Date().toISOString()}] [${level.toUpperCase().padEnd(5)}] [${namespace}] ${message}${argsStr}\n`;

    const doWrite = async () => {
      await this.ready;
      const handle = this.fileHandles.get(level);
      if (handle) {
        await handle.write(logLine);
      }
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
export function resetFileWriter(): void {
  globalWriter = null;
}
