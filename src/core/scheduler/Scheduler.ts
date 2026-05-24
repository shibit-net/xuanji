/**
 * Scheduler — 定时任务调度 + 空闲检测
 *
 * 管理 CronJob，支持 daily/weekly/once 调度，启动时补执行遗漏任务。
 * 设计文档：docs/memory-system-part-9-daily-care.md §6
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import { logger } from '@/core/logger';
import type { EventBus } from '@/core/events/EventBus';
import type { CronJob, SchedulerLog } from '@/core/scheduler/types';

const log = logger.child({ module: 'Scheduler' });

export class Scheduler {
  private jobs: CronJob[] = [];
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private activeUsers: Set<string> = new Set();
  private running = false;
  private baseDir: string;

  /** 自定义 action 回调映射：action name → handler */
  public customActions: Map<string, () => Promise<void>> = new Map();

  /** 触发 agent 会话的回调（注入 message 到当前 session） */
  public sessionTrigger: ((message: string) => Promise<void>) | null = null;

  constructor(
    private db: Database.Database,
    private sessionManager?: any,
    private cheapLLM?: any,
    private learnTool?: any,
    private eventBus?: EventBus,
    activeUsers?: Set<string>,
    baseDir?: string,
  ) {
    this.activeUsers = activeUsers ?? new Set();
    this.baseDir = baseDir ?? join(homedir(), '.xuanji', 'scheduler');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.ensureDir();
    this.jobs = await this.loadJobs();
    await this.catchUpMissedJobs();

    // 调度所有未来任务
    for (const job of this.jobs) {
      if (job.enabled === false) continue;
      if (job.executed) continue;
      this.scheduleJob(job);
    }

    // 启动空闲检测（30 分钟间隔）
    this.idleTimer = setInterval(() => {
      this.checkIdle().catch(err => log.error('Idle check failed:', err));
    }, 30 * 60 * 1000);

    log.info(`Scheduler started with ${this.jobs.length} jobs`);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async addCron(job: CronJob): Promise<void> {
    if (!job.id) job.id = `cron-${randomUUID().slice(0, 8)}`;
    job.createdAt = job.createdAt || Date.now();
    this.jobs.push(job);
    await this.saveJobs();
    if (this.running && job.enabled !== false) {
      this.scheduleJob(job);
    }
  }

  getJobs(): CronJob[] {
    return this.jobs;
  }

  async updateCron(id: string, updates: Partial<CronJob>): Promise<void> {
    const idx = this.jobs.findIndex(j => j.id === id);
    if (idx === -1) throw new Error(`Job not found: ${id}`);

    const oldJob = this.jobs[idx];
    const newJob = { ...oldJob, ...updates, id: oldJob.id };

    // 取消旧定时器
    const oldTimer = this.timers.get(id);
    if (oldTimer) {
      clearTimeout(oldTimer);
      this.timers.delete(id);
    }

    this.jobs[idx] = newJob;
    await this.saveJobs();

    // 重新调度
    if (this.running && newJob.enabled !== false && !newJob.executed) {
      newJob.scheduledAt = undefined; // 强制重新计算下次运行时间
      this.scheduleJob(newJob);
    }
  }

  async removeCron(id: string): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.jobs = this.jobs.filter(j => j.id !== id);
    await this.saveJobs();
  }

  getLogs(limit = 50): SchedulerLog[] {
    try {
      return this.db.prepare(
        'SELECT * FROM scheduler_log ORDER BY scheduled_at DESC LIMIT ?'
      ).all(limit) as SchedulerLog[];
    } catch {
      return [];
    }
  }

  // ─── 内部方法 ────────────────────────────────────────────

  private async catchUpMissedJobs(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.enabled === false || job.executed) continue;
      if (job.scheduledAt && job.scheduledAt < now) {
        // 检查是否已执行（通过 scheduler_log 去重）
        const existing = this.db.prepare(
          'SELECT id FROM scheduler_log WHERE job_id = ? AND scheduled_at = ?'
        ).get(job.id, job.scheduledAt) as any;
        if (existing) continue;

        log.info(`Catching up missed job: ${job.id}`);
        await this.executeJob(job, now);
      }
    }
  }

  private scheduleJob(job: CronJob): void {
    const now = Date.now();
    let nextRun: number;

    if (job.scheduledAt) {
      // 一次性任务，已过期的在 catchUpMissedJobs 中处理
      if (job.scheduledAt <= now) return;
      nextRun = job.scheduledAt;
    } else {
      nextRun = this.calcNextRun(job);
    }

    const delay = nextRun - now;
    if (delay <= 0) return;

    const timer = setTimeout(() => {
      this.executeJob(job, nextRun).catch(err =>
        log.error(`Job execution failed: ${job.id}`, err)
      );
      this.timers.delete(job.id);

      // 周期性任务重新调度
      if (job.type !== 'once') {
        job.scheduledAt = undefined;
        this.scheduleJob(job);
      }
    }, Math.min(delay, 7 * 24 * 3600 * 1000)); // 最大延迟 7 天

    this.timers.set(job.id, timer);
  }

  private calcNextRun(job: CronJob): number {
    const now = new Date();
    const next = new Date(now);

    next.setSeconds(0);
    next.setMilliseconds(0);

    if (job.minute !== undefined) next.setMinutes(job.minute);
    if (job.hour !== undefined) next.setHours(job.hour);
    else next.setHours(9); // 默认早上 9 点

    if (job.type === 'weekly' && job.dayOfWeek !== undefined) {
      const dayDiff = job.dayOfWeek - next.getDay();
      next.setDate(next.getDate() + (dayDiff <= 0 ? dayDiff + 7 : dayDiff));
    }

    // monthly: 每月几号（dayOfMonth: 1-31）
    if (job.type === 'monthly' && job.dayOfMonth !== undefined) {
      next.setDate(job.dayOfMonth);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
    }

    // yearly: 每年几月几号（month + dayOfMonth）
    if (job.type === 'yearly') {
      if (job.month !== undefined) next.setMonth(job.month - 1); // month: 1-12
      if (job.dayOfMonth !== undefined) next.setDate(job.dayOfMonth);
      if (next <= now) {
        next.setFullYear(next.getFullYear() + 1);
      }
    }

    // daily / weekly 未处理的情况：时间已过加一周期
    if (job.type === 'daily' && next <= now) {
      next.setDate(next.getDate() + 1);
    }
    if (job.type === 'weekly' && next <= now) {
      next.setDate(next.getDate() + 7);
    }

    return next.getTime();
  }

  private async executeJob(job: CronJob, runTime: number): Promise<void> {
    // 用户隔离：仅执行当前活跃用户的任务，跳过其他用户的 job
    if (job.userId && this.activeUsers.size > 0 && !this.activeUsers.has(job.userId)) {
      return;
    }

    try {
      log.info(`Executing job: ${job.id} (${job.type}: ${job.action})`);

      if (job.action === 'learn') {
        if (this.learnTool) {
          try {
            await this.learnTool.execute({
              goal: job.prompt || job.params?.goal || 'daily learning',
              depth: job.params?.depth || 'shallow',
            });
          } catch (err) {
            log.error(`Learn job ${job.id} failed:`, err);
          }
        } else {
          log.warn(`Learn job ${job.id} skipped: learnTool not injected`);
        }
      } else if (job.action === 'custom') {
        const handlerName = job.params?.handler as string;
        if (handlerName && this.customActions.has(handlerName)) {
          try {
            await this.customActions.get(handlerName)!();
          } catch (err) {
            log.error(`Custom job ${job.id} (${handlerName}) failed:`, err);
          }
        } else if (job.message && this.sessionTrigger) {
          // 没有 handler 但有 message → 直接触发 agent 对话
          try {
            log.info(`Job ${job.id} triggering agent session with message: "${job.message.slice(0, 100)}"`);
            await this.sessionTrigger(job.message);
          } catch (err) {
            log.error(`Job ${job.id} agent trigger failed:`, err);
          }
        } else if (!handlerName) {
          log.warn(`Custom job ${job.id} skipped: no handler or message configured`);
        } else {
          log.warn(`Custom job ${job.id} skipped: no handler "${handlerName}" registered`);
        }
      }

      // 记录执行日志
      this.db.prepare(`
        INSERT OR IGNORE INTO scheduler_log (job_id, scheduled_at, executed_at, status)
        VALUES (?, ?, ?, 'ok')
      `).run(job.id, job.scheduledAt || runTime, runTime);

      if (job.type === 'once') {
        job.executed = true;
        await this.saveJobs();
      }
    } catch (err) {
      log.error(`Job ${job.id} execution failed:`, err);
      this.db.prepare(`
        INSERT OR IGNORE INTO scheduler_log (job_id, scheduled_at, executed_at, status)
        VALUES (?, ?, ?, 'error')
      `).run(job.id, job.scheduledAt || runTime, runTime);
    }
  }

  private async checkIdle(): Promise<void> {
    if (this.activeUsers.size === 0) return;

    // 检查是否有用户长时间未活跃
    const now = Date.now();
    for (const userId of this.activeUsers) {
      // Scheduler 通过 EventBus 检测用户活跃状态
      // 这里只做轻量日志记录
      log.debug(`Idle check for user: ${userId}`);
    }
  }

  private async loadJobs(): Promise<CronJob[]> {
    try {
      const jobsPath = join(this.baseDir, 'jobs.json');
      if (existsSync(jobsPath)) {
        const data = await readFile(jobsPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      log.warn('Failed to load jobs, starting fresh:', err);
    }
    return [];
  }

  private async saveJobs(): Promise<void> {
    try {
      await this.ensureDir();
      const jobsPath = join(this.baseDir, 'jobs.json');
      await writeFile(jobsPath, JSON.stringify(this.jobs, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to save jobs:', err);
    }
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }
}
