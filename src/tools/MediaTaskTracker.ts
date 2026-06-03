// ============================================================
// 媒体任务追踪器 — 后台异步任务注册表
// ============================================================

import type { ToolMediaGenConfig } from '@/shared/types/config';
import type { VideoTaskStatus } from './adapters/PlatformAdapter';
import { getAdapter } from './adapters/AdapterFactory';

/**
 * 媒体任务条目
 */
export interface MediaTaskEntry {
  taskId: string;
  type: 'video' | 'audio' | 'image';
  provider: string;
  status: 'submitted' | 'running' | 'succeeded' | 'failed';
  prompt: string;           // 截断到 80 字符
  submittedAt: number;
  completedAt?: number;
  videoUrl?: string;
  error?: string;
}

/** 最大保留的已完成任务数 */
const MAX_COMPLETED_TASKS = 50;

/**
 * MediaTaskTracker — 异步媒体任务注册表
 *
 * 轻量级内存单例，追踪 generate_video(async=true) 等异步任务。
 * Agent 通过 list_media_tasks 工具感知挂起的任务，选择合适时机查询。
 *
 * 与 BackgroundTaskManager 独立 — 前者管本地 bash 子进程，这里管远程 API 任务。
 */
export class MediaTaskTracker {
  private static instance: MediaTaskTracker | null = null;
  private tasks: Map<string, MediaTaskEntry> = new Map();

  static getInstance(): MediaTaskTracker {
    if (!MediaTaskTracker.instance) {
      MediaTaskTracker.instance = new MediaTaskTracker();
    }
    return MediaTaskTracker.instance;
  }

  /**
   * 注册新任务
   */
  register(
    taskId: string,
    type: MediaTaskEntry['type'],
    provider: string,
    prompt: string,
  ): void {
    this.tasks.set(taskId, {
      taskId,
      type,
      provider,
      status: 'submitted',
      prompt: prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt,
      submittedAt: Date.now(),
    });
  }

  /**
   * 更新任务状态（从 Ark/Bailian API 查询后更新）
   */
  updateStatus(taskId: string, status: VideoTaskStatus): void {
    const entry = this.tasks.get(taskId);
    if (entry) {
      entry.status = status.status;
      entry.videoUrl = status.videoUrl;
      entry.error = status.error;
      if (status.status === 'succeeded' || status.status === 'failed') {
        entry.completedAt = Date.now();
      }
    }
  }

  /**
   * 同步任务状态（从远程 API 拉取最新状态）
   */
  async syncTask(taskId: string, cfg: ToolMediaGenConfig): Promise<MediaTaskEntry | null> {
    const entry = this.tasks.get(taskId);
    if (!entry) return null;

    try {
      const adapter = getAdapter(entry.provider);
      if (!adapter.queryVideoTask) return entry;

      const status = await adapter.queryVideoTask(taskId, cfg);
      this.updateStatus(taskId, status);

      // 返回更新后的 entry
      return this.tasks.get(taskId) || entry;
    } catch {
      return entry;
    }
  }

  /**
   * 列出所有任务
   */
  list(): MediaTaskEntry[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.submittedAt - a.submittedAt);  // 最新在前
  }

  /**
   * 列出尚未完成的任务
   */
  listPending(): MediaTaskEntry[] {
    return Array.from(this.tasks.values())
      .filter((e) => e.status === 'submitted' || e.status === 'running')
      .sort((a, b) => b.submittedAt - a.submittedAt);
  }

  /**
   * 获取单个任务
   */
  get(taskId: string): MediaTaskEntry | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 标记任务为已取消
   */
  markCancelled(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (entry) {
      entry.status = 'failed';
      entry.error = 'cancelled by user';
      entry.completedAt = Date.now();
    }
  }

  /**
   * 清理旧的已完成任务（保留最近 MAX_COMPLETED_TASKS 个）
   */
  private autoCleanup(): void {
    const completed = Array.from(this.tasks.entries())
      .filter(([, e]) => e.status === 'succeeded' || e.status === 'failed')
      .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0));

    if (completed.length > MAX_COMPLETED_TASKS) {
      for (const [id] of completed.slice(MAX_COMPLETED_TASKS)) {
        this.tasks.delete(id);
      }
    }
  }

  /** 重置单例（测试用） */
  static resetInstance(): void {
    MediaTaskTracker.instance = null;
  }
}
