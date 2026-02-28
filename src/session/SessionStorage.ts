/**
 * 会话存储核心逻辑（JSONL 格式）
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import type {
  Message,
  SessionMetadata,
  Checkpoint,
  SessionSnapshot,
  SessionStorageOptions,
  SessionListItem,
} from './types.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SessionStorage' });

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.xuanji', 'sessions');

export class SessionStorage {
  private baseDir: string;
  private autoBackup: boolean;
  private maxSessions: number;
  private _writeLock: Promise<void> = Promise.resolve();

  constructor(options?: Partial<SessionStorageOptions>) {
    this.baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    this.autoBackup = options?.autoBackup ?? true;
    this.maxSessions = options?.maxSessions || 0;
  }

  /**
   * 初始化存储目录
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  /**
   * 获取会话文件路径
   */
  private getSessionPaths(sessionId: string) {
    const sessionDir = this.baseDir;
    return {
      meta: path.join(sessionDir, `${sessionId}.meta.json`),
      messages: path.join(sessionDir, `${sessionId}.messages.jsonl`),
      checkpoints: path.join(sessionDir, `${sessionId}.checkpoints.json`),
      messagesBackup: path.join(sessionDir, `${sessionId}.messages.jsonl.bak`),
    };
  }

  /**
   * 保存完整会话快照
   */
  async saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
    await this.initialize();
    const paths = this.getSessionPaths(snapshot.metadata.id);

    // 1. 备份现有文件（如果存在）
    if (this.autoBackup) {
      try {
        await fs.copyFile(paths.messages, paths.messagesBackup);
      } catch (error) {
        log.debug('Backup failed:', error);
      }
    }

    // 2. 保存元数据
    await fs.writeFile(paths.meta, JSON.stringify(snapshot.metadata, null, 2), 'utf-8');

    // 3. 保存消息（JSONL 格式，流式写入避免内存峰值）
    await this.writeMessagesStream(paths.messages, snapshot.messages);

    // 4. 保存 checkpoints
    await fs.writeFile(
      paths.checkpoints,
      JSON.stringify(snapshot.checkpoints, null, 2),
      'utf-8'
    );

    // 5. 清理旧会话（如果超过限制）
    if (this.maxSessions > 0) {
      await this.cleanupOldSessions();
    }
  }

  /**
   * 加载完整会话快照
   */
  async loadSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const paths = this.getSessionPaths(sessionId);

    // 1. 读取元数据
    const metaContent = await fs.readFile(paths.meta, 'utf-8');
    const metadata: SessionMetadata = JSON.parse(metaContent);

    // 2. 读取消息（JSONL 格式，逐行解析）
    const messages: Message[] = [];
    let lineNumber = 0;
    const corruptedLines: number[] = [];

    try {
      const fileStream = createReadStream(paths.messages);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        lineNumber++;
        if (line.trim() === '') continue; // 跳过空行

        try {
          const message = JSON.parse(line);
          messages.push(message);
        } catch (error) {
          // 记录损坏的行，但继续读取
          corruptedLines.push(lineNumber);
          log.warn(`Corrupted line ${lineNumber} in ${sessionId}, skipping`);
        }
      }
    } catch (error) {
      throw new Error(`Failed to read messages: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. 读取 checkpoints（如果存在）
    let checkpoints: Checkpoint[] = [];
    try {
      const checkpointsContent = await fs.readFile(paths.checkpoints, 'utf-8');
      checkpoints = JSON.parse(checkpointsContent);
    } catch (error) {
      log.debug('Load checkpoint failed:', error);
    }

    // 4. 如果有损坏行，发出警告
    if (corruptedLines.length > 0) {
      log.warn(
        `${corruptedLines.length} corrupted lines detected in session ${sessionId}. ` +
        `Use /sessions repair ${sessionId} to fix.`
      );
    }

    return { metadata, messages, checkpoints, corruptedLineCount: corruptedLines.length > 0 ? corruptedLines.length : undefined };
  }

  /**
   * 追加单条消息到 JSONL 文件（流式写入）
   */
  async appendMessage(sessionId: string, message: Message): Promise<void> {
    const paths = this.getSessionPaths(sessionId);
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(paths.messages, line, 'utf-8');

    // 更新元数据中的消息计数
    await this.updateMetadata(sessionId, (meta) => ({
      ...meta,
      messageCount: meta.messageCount + 1,
      updatedAt: Date.now(),
    }));
  }

  /**
   * 截断消息文件到指定索引（用于 checkpoint 回滚）
   */
  async truncateMessages(sessionId: string, toIndex: number): Promise<void> {
    const paths = this.getSessionPaths(sessionId);

    // 1. 读取前 toIndex 条有效消息
    const messages: Message[] = [];

    const fileStream = createReadStream(paths.messages);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (messages.length >= toIndex) break; // 按有效消息数截断
      if (line.trim() !== '') {
        try {
          messages.push(JSON.parse(line));
        } catch (err) {
          log.debug('Parse message line failed:', err);
        }
      }
    }

    // 2. 备份原文件
    if (this.autoBackup) {
      await fs.copyFile(paths.messages, paths.messagesBackup);
    }

    // 3. 流式重写文件
    await this.writeMessagesStream(paths.messages, messages);

    // 4. 更新元数据
    await this.updateMetadata(sessionId, (meta) => ({
      ...meta,
      messageCount: toIndex,
      updatedAt: Date.now(),
    }));
  }

  /**
   * 带互斥保护的元数据更新
   */
  async updateMetadata(
    sessionId: string,
    updater: (meta: SessionMetadata) => SessionMetadata
  ): Promise<void> {
    // 使用 Promise 链实现简单互斥锁
    const release = this._writeLock;
    let resolve!: () => void;
    this._writeLock = new Promise<void>(r => { resolve = r; });

    await release;
    try {
      const paths = this.getSessionPaths(sessionId);
      const metaContent = await fs.readFile(paths.meta, 'utf-8');
      const metadata: SessionMetadata = JSON.parse(metaContent);
      const updatedMetadata = updater(metadata);
      // 原子写入：先写临时文件再 rename
      const tmpPath = paths.meta + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(updatedMetadata, null, 2), 'utf-8');
      await fs.rename(tmpPath, paths.meta);
    } finally {
      resolve();
    }
  }

  /**
   * 保存 checkpoints
   */
  async saveCheckpoints(sessionId: string, checkpoints: Checkpoint[]): Promise<void> {
    const paths = this.getSessionPaths(sessionId);
    await fs.writeFile(paths.checkpoints, JSON.stringify(checkpoints, null, 2), 'utf-8');
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<SessionListItem[]> {
    await this.initialize();

    const files = await fs.readdir(this.baseDir);
    const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

    const sessions: SessionListItem[] = [];

    for (const file of metaFiles) {
      try {
        const metaPath = path.join(this.baseDir, file);
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const metadata: SessionMetadata = JSON.parse(metaContent);

        sessions.push({
          id: metadata.id,
          name: metadata.name,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          messageCount: metadata.messageCount,
          workingDirectory: metadata.workingDirectory,
        });
      } catch (error) {
        log.warn(`Failed to read metadata from ${file}, skipping`);
      }
    }

    // 按更新时间倒序排序
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    return sessions;
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const paths = this.getSessionPaths(sessionId);

    await Promise.all([
      fs.unlink(paths.meta).catch(() => {}),
      fs.unlink(paths.messages).catch(() => {}),
      fs.unlink(paths.checkpoints).catch(() => {}),
      fs.unlink(paths.messagesBackup).catch(() => {}),
    ]);
  }

  /**
   * 检查会话是否存在
   */
  async exists(sessionId: string): Promise<boolean> {
    const paths = this.getSessionPaths(sessionId);
    try {
      await fs.access(paths.meta);
      return true;
    } catch { /* ENOENT expected */
      return false;
    }
  }

  /**
   * 修复损坏的 JSONL 文件
   */
  async repairSession(sessionId: string): Promise<{ fixed: number; removed: number }> {
    const paths = this.getSessionPaths(sessionId);

    // 1. 备份原文件
    await fs.copyFile(paths.messages, paths.messagesBackup);

    // 2. 逐行读取并过滤损坏行
    const validLines: string[] = [];
    let totalLines = 0;
    let corruptedLines = 0;

    const fileStream = createReadStream(paths.messages);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      totalLines++;
      if (line.trim() === '') continue;

      try {
        JSON.parse(line); // 验证 JSON 格式
        validLines.push(line);
      } catch (err) {
        log.debug('Repair line failed:', err);
        corruptedLines++;
      }
    }

    // 3. 重写文件
    await fs.writeFile(paths.messages, validLines.join('\n') + '\n', 'utf-8');

    // 4. 更新元数据
    await this.updateMetadata(sessionId, (meta) => ({
      ...meta,
      messageCount: validLines.length,
      updatedAt: Date.now(),
    }));

    return {
      fixed: validLines.length,
      removed: corruptedLines,
    };
  }

  /**
   * 清理旧会话（保留最近的 maxSessions 个）
   */
  private async cleanupOldSessions(): Promise<void> {
    const sessions = await this.listSessions();

    if (sessions.length <= this.maxSessions) return;

    const toDelete = sessions.slice(this.maxSessions);

    await Promise.all(toDelete.map((s) => this.deleteSession(s.id)));

    log.debug(`Cleaned up ${toDelete.length} old sessions`);
  }

  /**
   * 流式写入消息到 JSONL 文件（原子写入：先写临时文件再 rename）
   *
   * 使用 createWriteStream 逐条写入，处理背压（drain 事件），避免大量消息时内存峰值。
   * 写入完成后通过 rename 原子替换目标文件，防止写入中断导致数据损坏。
   */
  private writeMessagesStream(filePath: string, messages: Message[]): Promise<void> {
    const tmpPath = filePath + '.tmp';
    return new Promise((resolve, reject) => {
      const ws = createWriteStream(tmpPath, { encoding: 'utf-8' });

      ws.on('error', reject);

      let index = 0;

      const write = () => {
        let ok = true;
        while (index < messages.length && ok) {
          const data = JSON.stringify(messages[index]) + '\n';
          index++;
          if (index === messages.length) {
            // 最后一条，写入后结束
            ws.write(data, () => ws.end());
            return;
          }
          ok = ws.write(data);
        }
        if (index < messages.length) {
          // 缓冲区满，等待 drain 后继续
          ws.once('drain', write);
        }
      };

      ws.on('finish', async () => {
        try {
          // 原子替换：rename 在同文件系统上是原子操作
          await fs.rename(tmpPath, filePath);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      if (messages.length === 0) {
        ws.end();
      } else {
        write();
      }
    });
  }
}
