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
 * - 写入失败静默处理
 */
export class FileWriter {
  private fileHandle: fs.FileHandle | null = null;
  private ready: Promise<void>;

  constructor(filePath: string) {
    this.ready = this.init(filePath);
  }

  private async init(filePath: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      this.fileHandle = await fs.open(filePath, 'a');
    } catch {
      // 文件初始化失败不影响控制台日志
    }
  }

  /**
   * 写入一行日志（异步，不阻塞）
   */
  write(level: LogLevel, namespace: string, message: string, args: unknown[]): void {
    if (!this.fileHandle && !this.ready) return;

    const argsStr = args.length > 0
      ? ' ' + args.map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(' ')
      : '';

    const logLine = `[${new Date().toISOString()}] [${level.toUpperCase().padEnd(5)}] [${namespace}] ${message}${argsStr}\n`;

    const doWrite = async () => {
      await this.ready;
      await this.fileHandle?.write(logLine);
    };
    doWrite().catch(() => {});
  }

  /**
   * 关闭文件句柄
   */
  async close(): Promise<void> {
    await this.ready;
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }
}

// ── 全局单例 ─────────────────────────────────────────────

let globalWriter: FileWriter | null = null;

/**
 * 获取全局共享 FileWriter
 *
 * 所有 Logger 实例（包括 child）共用同一个文件句柄，
 * 避免重复打开文件。
 */
export function getFileWriter(filePath: string): FileWriter {
  if (!globalWriter) {
    globalWriter = new FileWriter(filePath);
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
