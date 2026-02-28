/**
 * Checkpoint 管理器
 *
 * 职责:
 * - 在当前会话中创建 checkpoint（记录消息索引位置）
 * - 回滚到指定 checkpoint（截断 JSONL 文件）
 * - 列出会话的所有 checkpoint
 *
 * 支持文件快照：创建 checkpoint 时可记录被修改文件的原始内容，
 * 回滚时同时恢复文件内容。
 */

import { randomUUID } from 'crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';
import { dirname } from 'node:path';
import type { SessionStorage } from './SessionStorage.js';
import type { Checkpoint, FileSnapshot, Message } from './types.js';
import type { HookRegistry } from '@/hooks/HookRegistry';

export class CheckpointManager {
  private storage: SessionStorage;
  /** 内存中的 checkpoint 列表（与持久化同步） */
  private checkpoints: Map<string, Checkpoint[]> = new Map();
  private hookRegistry: HookRegistry | null = null;

  constructor(storage: SessionStorage) {
    this.storage = storage;
  }

  /**
   * 创建 checkpoint
   *
   * @param sessionId - 会话 ID
   * @param messages - 当前消息历史（用于确定索引位置）
   * @param label - checkpoint 标签
   * @param modifiedFiles - 被修改的文件路径列表（用于快照）
   * @returns checkpoint ID
   */
  async create(sessionId: string, messages: Message[], label?: string, modifiedFiles?: string[]): Promise<string> {
    const checkpointId = randomUUID();
    const now = Date.now();

    // 为被修改的文件创建快照
    let fileSnapshots: FileSnapshot[] | undefined;
    if (modifiedFiles && modifiedFiles.length > 0) {
      fileSnapshots = await this.captureFileSnapshots(modifiedFiles);
    }

    const checkpoint: Checkpoint = {
      id: checkpointId,
      label: label || `Checkpoint ${this.getSessionCheckpoints(sessionId).length + 1}`,
      createdAt: now,
      messageIndex: messages.length,
      messageCount: messages.length,
      ...(fileSnapshots && fileSnapshots.length > 0 ? { fileSnapshots } : {}),
    };

    // 追加到列表
    const checkpoints = this.getSessionCheckpoints(sessionId);
    checkpoints.push(checkpoint);
    this.checkpoints.set(sessionId, checkpoints);

    // 持久化
    await this.storage.saveCheckpoints(sessionId, checkpoints);

    // 触发 CheckpointCreated Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('CheckpointCreated', {
        checkpointId,
        checkpointLabel: checkpoint.label,
        sessionId,
      }).catch(() => {});
    }

    return checkpointId;
  }

  /**
   * 回滚到指定 checkpoint
   *
   * @returns 回滚后的消息数量
   */
  async restore(sessionId: string, checkpointId: string): Promise<number> {
    const checkpoints = await this.loadCheckpoints(sessionId);
    const checkpoint = checkpoints.find((cp) => cp.id === checkpointId);

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} 不存在`);
    }

    // 截断消息文件到 checkpoint 记录的索引位置
    await this.storage.truncateMessages(sessionId, checkpoint.messageIndex);

    // 恢复文件快照（如果有）
    if (checkpoint.fileSnapshots && checkpoint.fileSnapshots.length > 0) {
      await this.restoreFileSnapshots(checkpoint.fileSnapshots);
    }

    // 移除该 checkpoint 之后的所有 checkpoint
    const filteredCheckpoints = checkpoints.filter(
      (cp) => cp.createdAt <= checkpoint.createdAt
    );
    this.checkpoints.set(sessionId, filteredCheckpoints);
    await this.storage.saveCheckpoints(sessionId, filteredCheckpoints);

    // 触发 CheckpointRestored Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('CheckpointRestored', {
        checkpointId,
        checkpointLabel: checkpoint.label,
        sessionId,
      }).catch(() => {});
    }

    return checkpoint.messageIndex;
  }

  /**
   * 列出会话的所有 checkpoint
   */
  async list(sessionId: string): Promise<Checkpoint[]> {
    return this.loadCheckpoints(sessionId);
  }

  /**
   * 删除指定 checkpoint
   */
  async delete(sessionId: string, checkpointId: string): Promise<void> {
    const checkpoints = await this.loadCheckpoints(sessionId);
    const filtered = checkpoints.filter((cp) => cp.id !== checkpointId);
    this.checkpoints.set(sessionId, filtered);
    await this.storage.saveCheckpoints(sessionId, filtered);
  }

  /**
   * 获取最新的 checkpoint（用于快速回退）
   */
  async getLatest(sessionId: string): Promise<Checkpoint | null> {
    const checkpoints = await this.loadCheckpoints(sessionId);
    if (checkpoints.length === 0) return null;
    return checkpoints[checkpoints.length - 1];
  }

  /**
   * 注入 HookRegistry
   */
  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 捕获文件快照（记录当前文件内容）
   */
  private async captureFileSnapshots(filePaths: string[]): Promise<FileSnapshot[]> {
    const snapshots: FileSnapshot[] = [];
    for (const filePath of filePaths) {
      try {
        if (existsSync(filePath)) {
          const content = await readFile(filePath, 'utf-8');
          snapshots.push({ path: filePath, content });
        } else {
          // 文件不存在（新建的文件），记录为 null
          snapshots.push({ path: filePath, content: null });
        }
      } catch {
        snapshots.push({ path: filePath, content: null });
      }
    }
    return snapshots;
  }

  /**
   * 恢复文件快照（将文件内容恢复到快照时的状态）
   */
  private async restoreFileSnapshots(snapshots: FileSnapshot[]): Promise<void> {
    const cwd = process.cwd();
    for (const snapshot of snapshots) {
      try {
        // 安全校验：路径必须在当前工作目录下
        const resolved = require('node:path').resolve(snapshot.path);
        if (!resolved.startsWith(cwd)) {
          continue; // 跳过工作目录外的路径
        }

        if (snapshot.content === null) {
          // 快照时文件不存在 → 删除文件（恢复到"不存在"状态）
          if (existsSync(resolved)) {
            await unlink(resolved);
          }
        } else {
          // 确保目录存在
          const dir = dirname(resolved);
          if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
          }
          await writeFile(resolved, snapshot.content, 'utf-8');
        }
      } catch (fileErr) {
        // 单个文件恢复失败不阻塞其他文件
        logger.child({ module: 'CheckpointManager' }).warn(`Failed to restore file ${snapshot.path}:`, fileErr);
      }
    }
  }

  /**
   * 从内存缓存获取会话的 checkpoint 列表
   */
  private getSessionCheckpoints(sessionId: string): Checkpoint[] {
    return this.checkpoints.get(sessionId) ?? [];
  }

  /**
   * 从持久化存储加载 checkpoint 列表（带缓存）
   * 使用 loadCheckpointsOnly 避免全量加载消息文件
   */
  private async loadCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    // 如果内存中已有（包括空数组），直接返回
    if (this.checkpoints.has(sessionId)) {
      return this.checkpoints.get(sessionId)!;
    }

    // 仅从 checkpoints 文件加载，不读取消息文件
    try {
      const checkpoints = await this.storage.loadCheckpointsOnly(sessionId);
      this.checkpoints.set(sessionId, checkpoints);
      return checkpoints;
    } catch {
      return [];
    }
  }
}
