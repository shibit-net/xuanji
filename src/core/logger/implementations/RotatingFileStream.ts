/**
 * RotatingFileStream — 按天轮转的日志文件写入流
 *
 * 每天一个文件：xuanji-2026-05-02.jsonl
 * 每文件最大 50MB，超过后自动创建新文件（带序号）
 *
 * 实现 pino 的 DestinationStream 接口
 */

import fs from 'fs';
import path from 'path';
import { getUTC8DateString } from '@/shared/utils/time/formatters';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB total disk quota
const MAX_RETENTION_DAYS = 30;

export class RotatingFileStream {
  private baseDir: string;
  private stream: fs.WriteStream | null = null;
  private currentDate = '';
  private currentSeq = 0;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    fs.mkdirSync(baseDir, { recursive: true });
    this.rotate();
  }

  write(data: string): void {
    // 检查是否需要按天轮转（按 UTC+8 日期）
    const today = getUTC8DateString();
    if (today !== this.currentDate) {
      this.rotate();
    }

    // 检查是否需要按大小轮转
    if (this.stream && (this.stream.bytesWritten || 0) > MAX_FILE_SIZE) {
      this.rotateSeq();
    }

    if (this.stream) {
      this.stream.write(data);
    }
  }

  private getFilePath(date: string, seq: number): string {
    const base = `xuanji-${date}`;
    return seq === 0
      ? path.join(this.baseDir, `${base}.jsonl`)
      : path.join(this.baseDir, `${base}-${seq}.jsonl`);
  }

  private rotate(): void {
    this.close();
    this.currentDate = getUTC8DateString();
    this.currentSeq = this.findNextSeq(this.currentDate);
    const filePath = this.getFilePath(this.currentDate, this.currentSeq);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.cleanupOldLogs();
  }

  private rotateSeq(): void {
    this.close();
    this.currentSeq++;
    const filePath = this.getFilePath(this.currentDate, this.currentSeq);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  private findNextSeq(date: string): number {
    let seq = 0;
    while (fs.existsSync(this.getFilePath(date, seq))) {
      seq++;
    }
    // 用最后一个已存在的文件（追加不覆盖）
    return Math.max(0, seq - 1);
  }

  private cleanupOldLogs(): void {
    try {
      const files = fs.readdirSync(this.baseDir)
        .filter(f => f.startsWith('xuanji-') && f.endsWith('.jsonl'))
        .map(f => {
          const filePath = path.join(this.baseDir, f);
          try { return { name: f, path: filePath, mtime: fs.statSync(filePath).mtimeMs, size: fs.statSync(filePath).size }; }
          catch { return null; }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .sort((a, b) => a.mtime - b.mtime);

      // 按时间清理：超过 MAX_RETENTION_DAYS 的文件
      const cutoff = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const file of files) {
        if (file.mtime < cutoff) {
          fs.unlinkSync(file.path);
        }
      }

      // 按总大小清理：超过 MAX_TOTAL_SIZE 时删除最旧文件
      const remaining = files.filter(f => f.mtime >= cutoff);
      let totalSize = remaining.reduce((sum, f) => sum + f.size, 0);
      for (const file of remaining) {
        if (totalSize <= MAX_TOTAL_SIZE) break;
        fs.unlinkSync(file.path);
        totalSize -= file.size;
      }
    } catch {
      // 静默失败，清理逻辑不应影响正常日志写入
    }
  }

  private close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  end(): void {
    this.close();
  }
}
