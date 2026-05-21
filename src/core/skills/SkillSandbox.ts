/**
 * ============================================================
 * SkillSandbox — Worker Thread 安全沙箱
 * ============================================================
 * 在独立 Worker 线程中执行 action/workflow Skill 的 execute() 方法。
 *
 * 安全保证：
 *   - 内存上限：128MB (maxOldGenerationSizeMb)
 *   - 执行超时：30s (setTimeout → terminate)
 *   - 进程隔离：Worker 崩溃不影响主进程
 *   - 环境变量：不继承 process.env
 *
 * 用法：
 *   const sandbox = new SkillSandbox();
 *   const result = await sandbox.execute('/path/to/skill/dir/index.js', { symbol: 'AAPL' });
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { WorkflowResult } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillSandbox' });

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_MB = 128;

// ============================================================
// SkillSandbox
// ============================================================

export class SkillSandbox {
  private readonly timeoutMs: number;
  private readonly memoryLimitMb: number;
  private readonly workerScript: string;

  constructor(options?: { timeoutMs?: number; memoryLimitMb?: number }) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.memoryLimitMb = options?.memoryLimitMb ?? DEFAULT_MEMORY_MB;
    // skill-worker.js 与 SkillSandbox.ts 同目录
    this.workerScript = path.join(__dirname, 'skill-worker.js');
  }

  /**
   * 在 Worker 沙箱中执行 Skill。
   *
   * @param skillPath - 入口 .js 文件的绝对路径
   * @param params    - 传递给 execute() 的参数
   * @returns WorkflowResult
   */
  execute(skillPath: string, params?: Record<string, unknown>): Promise<WorkflowResult> {
    return new Promise((resolve) => {
      let settled = false;

      const worker = new Worker(this.workerScript, {
        workerData: { skillPath, params: params ?? {} },
        resourceLimits: {
          maxOldGenerationSizeMb: this.memoryLimitMb,
        },
        // 不继承父线程的环境变量
        env: {},
      });

      // 超时保护
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        log.warn(`Skill sandbox timeout (${this.timeoutMs}ms) for: ${skillPath}`);
        worker.terminate();
        resolve({
          success: false,
          error: `执行超时 (${this.timeoutMs}ms)`,
        });
      }, this.timeoutMs);

      // 接收结果
      worker.on('message', (msg: WorkflowResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(msg);
      });

      // Worker 错误（非崩溃）
      worker.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        log.error(`Skill worker error: ${err.message}`, err);
        resolve({
          success: false,
          error: `Worker 错误: ${err.message}`,
        });
      });

      // Worker 崩溃（exit code ≠ 0）
      worker.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          log.warn(`Skill worker exited with code ${code}: ${skillPath}`);
          resolve({
            success: false,
            error: `Worker 异常退出 (code ${code})`,
          });
        }
      });
    });
  }
}

/**
 * 全局 SkillSandbox 单例
 */
let globalSandbox: SkillSandbox | null = null;

export function getSkillSandbox(options?: { timeoutMs?: number; memoryLimitMb?: number }): SkillSandbox {
  if (!globalSandbox) {
    globalSandbox = new SkillSandbox(options);
  }
  return globalSandbox;
}

export function resetSkillSandbox(): void {
  globalSandbox = null;
}
