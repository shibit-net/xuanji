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

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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
    // 检查是否需要按天轮转
    const today = new Date().toISOString().slice(0, 10);
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
    this.currentDate = new Date().toISOString().slice(0, 10);
    this.currentSeq = this.findNextSeq(this.currentDate);
    const filePath = this.getFilePath(this.currentDate, this.currentSeq);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
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
