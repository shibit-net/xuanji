// ============================================================
// M10 遥测 — 会话统计持久化 (JSONL)
// ============================================================

import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { appendFile, readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { getUserRoot } from '@/core/config/PathManager';

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

/** 默认日志目录 */
const DEFAULT_LOG_DIR = join(homedir(), '.xuanji');

/** 日志保留天数 */
const LOG_RETENTION_DAYS = 30;

/**
 * SessionRecorder — 会话统计持久化到 JSONL 文件
 *
 * 特性:
 * - 使用 JSONL 格式 (每行一个 JSON 对象)
 * - 追加友好,流式分析,崩溃安全
 * - 按日期自动轮转（sessions-YYYY-MM-DD.jsonl）
 * - 写入失败静默处理,不影响主流程
 */
export class SessionRecorder {
  private logDir: string;
  private baseName: string;

  /**
   * @param filePath 存储路径 (默认: ./.xuanji/sessions.jsonl)
   */
  constructor(filePath?: string, userId?: string) {
    const defaultPath = userId ? join(getUserRoot(userId), 'sessions.jsonl') : join(DEFAULT_LOG_DIR, 'sessions.jsonl');
    const fullPath = filePath ?? defaultPath;
    this.logDir = join(fullPath, '..');
    const ext = extname(fullPath); // .jsonl
    this.baseName = basename(fullPath, ext); // sessions
  }

  /** 获取当天日志文件路径 */
  private getCurrentLogPath(): string {
    const today = new Date().toISOString().split('T')[0]!;
    return join(this.logDir, `${this.baseName}-${today}.jsonl`);
  }

  /** 扫描目录下所有匹配的轮转日志文件 */
  private static async findLogFiles(logDir: string, baseName: string): Promise<string[]> {
    try {
      const files = await readdir(logDir);
      const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^${escaped}(-\\d{4}-\\d{2}-\\d{2})?\\.jsonl$`);
      return files
        .filter(f => pattern.test(f))
        .sort()
        .map(f => join(logDir, f));
    } catch {
      return [];
    }
  }

  /**
   * 记录会话统计
   */
  async record(record: SessionRecord): Promise<void> {
    try {
      // 确保目录存在
      await mkdir(this.logDir, { recursive: true });

      // 追加 JSONL 行 (每条记录一行)
      const line = JSON.stringify(record) + '\n';
      await appendFile(this.getCurrentLogPath(), line, 'utf-8');
    } catch {
      // 静默失败,不影响主流程
    }
  }

  /**
   * 读取最近的 N 条记录 (从后往前，扫描所有轮转文件)
   * @param limit 最大条数 (默认: 所有记录)
   */
  async readRecords(limit?: number): Promise<SessionRecord[]> {
    try {
      const logFiles = await SessionRecorder.findLogFiles(this.logDir, this.baseName);
      if (logFiles.length === 0) return [];

      const records: SessionRecord[] = [];

      // 从最新的文件开始读取
      for (let i = logFiles.length - 1; i >= 0; i--) {
        try {
          const text = await readFile(logFiles[i]!, 'utf-8');
          const lines = text.split('\n').filter((l) => l.trim());

          // 从后往前解析 (最新的记录在文件末尾)
          for (let j = lines.length - 1; j >= 0; j--) {
            if (limit && records.length >= limit) break;
            try {
              const record = JSON.parse(lines[j]!) as SessionRecord;
              records.push(record);
            } catch {
              // 跳过格式错误的行
            }
          }
          if (limit && records.length >= limit) break;
        } catch {
          // 跳过无法读取的文件
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * 清空所有记录（包括所有轮转文件）
   */
  async clear(): Promise<void> {
    try {
      const logFiles = await SessionRecorder.findLogFiles(this.logDir, this.baseName);
      for (const file of logFiles) {
        try {
          await unlink(file);
        } catch {
          // 删除失败跳过
        }
      }
    } catch {
      // 静默失败
    }
  }

  /**
   * 清理超过保留期的旧会话日志文件
   */
  async cleanupOldFiles(retentionDays = LOG_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().split('T')[0]!;

    try {
      const logFiles = await SessionRecorder.findLogFiles(this.logDir, this.baseName);
      let deleted = 0;

      for (const file of logFiles) {
        const name = basename(file);
        const match = name.match(/(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (match && match[1]! < cutoffStr) {
          try {
            await unlink(file);
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
}
