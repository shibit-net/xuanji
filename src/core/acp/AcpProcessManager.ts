/**
 * AcpProcessManager — 子进程管理
 *
 * 通过 child_process.fork() 启动子进程运行子 Agent，提供：
 * - 进程池（按最大并发限制）
 * - 进程复用 + 空闲超时回收
 * - 请求 / 响应 / 事件流通信
 * - 超时和取消支持
 */

import { fork, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { logger } from '@/core/logger';

/** ESM 兼容的 __dirname 替代 */
const _dirname = path.dirname(fileURLToPath(import.meta.url));
import type { AcpRequest, AcpMessage, AcpRunRequest, AcpRunResult, AcpProcessConfig, AcpEvent } from './types';
import { DEFAULT_ACP_CONFIG } from './types';

const log = logger.child({ module: 'AcpProcessManager' });

interface PendingRequest {
  resolve: (result: AcpRunResult) => void;
  reject: (err: Error) => void;
  onEvent?: (event: AcpEvent) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface AcpWorker {
  process: ChildProcess;
  id: string;
  busy: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pending: Map<string, PendingRequest>;
  createdAt: number;
}

export class AcpProcessManager extends EventEmitter {
  private static instance: AcpProcessManager | null = null;

  private workers: AcpWorker[] = [];
  private config: AcpProcessConfig;
  private workerCounter = 0;

  private constructor(config?: Partial<AcpProcessConfig>) {
    super();
    this.config = { ...DEFAULT_ACP_CONFIG, ...config };
  }

  static getInstance(config?: Partial<AcpProcessConfig>): AcpProcessManager {
    if (!AcpProcessManager.instance) {
      AcpProcessManager.instance = new AcpProcessManager(config);
    }
    return AcpProcessManager.instance;
  }

  static resetInstance(): void {
    if (AcpProcessManager.instance) {
      AcpProcessManager.instance.shutdown();
      AcpProcessManager.instance = null;
    }
  }

  /**
   * 发送运行请求到子进程
   * @returns AcpRunResult（包含 output、duration、tokensUsed 等）
   */
  async run(
    agentId: string,
    task: string,
    options: {
      systemPrompt?: string;
      scenePrompt?: string;
      tools?: string[];
      timeout?: number;
      maxIterations?: number;
      workingDir?: string;
      parentConfig?: Record<string, any>;
      onEvent?: (event: AcpEvent) => void;
    } = {},
  ): Promise<AcpRunResult> {
    const worker = await this.acquireWorker();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    return new Promise<AcpRunResult>((resolve, reject) => {
      const timer = options.timeout
        ? setTimeout(() => {
            worker.pending.delete(requestId);
            reject(new Error(`ACP request timed out after ${options.timeout}ms`));
          }, options.timeout + 5000) // 给子进程多 5s 超时容差
        : null;

      worker.pending.set(requestId, { resolve, reject, onEvent: options.onEvent, timer });

      const request: AcpRunRequest = {
        type: 'run',
        requestId,
        payload: {
          agentId,
          task,
          systemPrompt: options.systemPrompt,
          scenePrompt: options.scenePrompt,
          tools: options.tools,
          timeout: options.timeout,
          maxIterations: options.maxIterations,
          workingDir: options.workingDir,
          parentConfig: options.parentConfig,
        },
      };

      this.sendToWorker(worker, request);
    });
  }

  /** 取消指定请求 */
  cancel(requestId: string): void {
    for (const worker of this.workers) {
      if (worker.pending.has(requestId)) {
        this.sendToWorker(worker, { type: 'cancel', requestId });
        const pending = worker.pending.get(requestId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new Error('Cancelled'));
          worker.pending.delete(requestId);
        }
        if (!worker.busy && worker.pending.size === 0) {
          this.startIdleTimer(worker);
        }
        return;
      }
    }
  }

  /** 关闭所有子进程 */
  shutdown(): void {
    for (const worker of this.workers) {
      if (worker.idleTimer) clearTimeout(worker.idleTimer);
      for (const [, pending] of worker.pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error('ACP manager shutting down'));
      }
      worker.pending.clear();
      try { worker.process.kill(); } catch { /* ignore */ }
    }
    this.workers = [];
  }

  // ── 私有方法 ─────────────────────────────────────────

  private async acquireWorker(): Promise<AcpWorker> {
    // 找空闲 worker
    const idle = this.workers.find(w => !w.busy);
    if (idle) {
      if (idle.idleTimer) clearTimeout(idle.idleTimer);
      idle.idleTimer = null;
      idle.busy = true;
      return idle;
    }

    // 未达上限时创建新 worker
    if (this.workers.length < this.config.maxConcurrent) {
      return this.spawnWorker();
    }

    // 全部繁忙，等待一个空闲
    return new Promise<AcpWorker>((resolve) => {
      const check = () => {
        const w = this.workers.find(w => !w.busy);
        if (w) {
          if (w.idleTimer) clearTimeout(w.idleTimer);
          w.idleTimer = null;
          w.busy = true;
          resolve(w);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private spawnWorker(): AcpWorker {
    const workerId = `acp-${++this.workerCounter}`;
    log.info(`Spawning ACP worker: ${workerId}`);

    // tsup 编译后在项目根目录 dist/ 下
    // 从当前文件位置向上找到项目根，或使用配置路径
    const workerEntry = this.config.workerPath || (() => {
      // 场景列表（从上到下优先级依次降低）：
      //
      // 1. tsup 构建: _dirname = dist/, fromDist = dist/core/acp/acp-worker.js ✅
      // 2. electron dev: _dirname = desktop/dist-electron/,
      //    fromDevGui = desktop/dist-electron/../../dist/core/acp/acp-worker.js ✅
      // 3. electron dev (旧): _dirname = desktop/dist-electron/main/,
      //    fromElectronOld = .../dist/core/acp/acp-worker.js ✅
      // 4. tsx dev: _dirname = src/, fromTsx = src/../dist/core/acp/acp-worker.js ✅
      // 5. electron 打包后: 主进程入口在 app.asar/ 同级 build-resources/

      // 优先检查结构化路径（tsup 保留目录结构：dist/core/acp/acp-worker.js）
      const fromDist = path.resolve(_dirname, 'core/acp/acp-worker.js');
      if (fs.existsSync(fromDist)) return fromDist;
      // 兼容扁平路径（dist/acp-worker.js）
      const fromDistFlat = path.resolve(_dirname, 'acp-worker.js');
      if (fs.existsSync(fromDistFlat)) return fromDistFlat;

      const fromBuildResources = path.resolve(_dirname, '../build-resources/acp-worker.js');
      if (fs.existsSync(fromBuildResources)) return fromBuildResources;

      const fromDevGui = path.resolve(_dirname, '../../dist/core/acp/acp-worker.js');
      if (fs.existsSync(fromDevGui)) return fromDevGui;
      const fromDevGuiFlat = path.resolve(_dirname, '../../dist/acp-worker.js');
      if (fs.existsSync(fromDevGuiFlat)) return fromDevGuiFlat;

      const fromElectronOld = path.resolve(_dirname, '../../../dist/core/acp/acp-worker.js');
      if (fs.existsSync(fromElectronOld)) return fromElectronOld;
      const fromElectronOldFlat = path.resolve(_dirname, '../../../dist/acp-worker.js');
      if (fs.existsSync(fromElectronOldFlat)) return fromElectronOldFlat;

      const fromTsx = path.resolve(_dirname, '../../../dist/core/acp/acp-worker.js');
      if (fs.existsSync(fromTsx)) return fromTsx;
      const fromTsxFlat = path.resolve(_dirname, '../../../dist/acp-worker.js');
      if (fs.existsSync(fromTsxFlat)) return fromTsxFlat;

      return fromDist;
    })();

    log.debug(`ACP worker entry: ${workerEntry}`);

    // fork 子进程
    const child = fork(
      workerEntry,
      [],
      {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, ACP_WORKER_ID: workerId },
      },
    );

    const worker: AcpWorker = {
      process: child,
      id: workerId,
      busy: false,
      idleTimer: null,
      pending: new Map(),
      createdAt: Date.now(),
    };

    child.on('message', (msg: any) => {
      this.handleMessage(worker, msg as AcpMessage);
    });

    // 捕获子进程的 stderr/stdout 用于调试崩溃原因
    if (child.stderr) {
      let stderrBuf = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });
      child.stderr.on('end', () => {
        if (stderrBuf.trim()) {
          log.error(`ACP worker ${workerId} stderr:\n${stderrBuf}`);
        }
      });
    }
    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        log.debug(`ACP worker ${workerId} stdout: ${chunk.toString().trim()}`);
      });
    }

    child.on('exit', (code, signal) => {
      log.warn(`ACP worker ${workerId} exited: code=${code} signal=${signal}`);
      this.handleWorkerExit(worker);
    });

    child.on('error', (err) => {
      log.error(`ACP worker ${workerId} error:`, err);
    });

    // 向子进程发送初始化信号
    child.send({ type: 'init' });

    this.workers.push(worker);
    return worker;
  }

  private handleMessage(worker: AcpWorker, msg: AcpMessage): void {
    if (msg.type === 'event') {
      // 事件流：转发给对应的 pending request 的 onEvent
      const pending = worker.pending.get(msg.requestId);
      if (pending?.onEvent) {
        pending.onEvent(msg);
      }
      // 同时发射到 ACP 管理器级别
      this.emit('event', msg);
      return;
    }

    if (msg.type === 'result' || msg.type === 'error') {
      const pending = worker.pending.get(msg.requestId);
      if (!pending) return;

      if (pending.timer) clearTimeout(pending.timer);
      worker.pending.delete(msg.requestId);

      if (msg.type === 'result') {
        pending.resolve(msg);
      } else {
        pending.reject(new Error(msg.payload.message));
      }

      // 空闲时启动 idle timer
      if (worker.pending.size === 0) {
        worker.busy = false;
        this.startIdleTimer(worker);
      }
    }
  }

  private handleWorkerExit(worker: AcpWorker): void {
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);

    // pending 请求全部失败
    for (const [, pending] of worker.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('ACP worker process exited unexpectedly'));
    }
    worker.pending.clear();
  }

  private startIdleTimer(worker: AcpWorker): void {
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.idleTimer = setTimeout(() => {
      log.info(`Recycling idle ACP worker: ${worker.id}`);
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) this.workers.splice(idx, 1);
      try { worker.process.kill(); } catch { /* ignore */ }
    }, this.config.idleTimeoutMs);
  }

  private sendToWorker(worker: AcpWorker, msg: AcpRequest): void {
    try {
      worker.process.send(msg);
    } catch (err) {
      log.error(`Failed to send to ACP worker ${worker.id}:`, err);
      const pending = worker.pending.get(msg.requestId);
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error('Failed to send message to ACP worker'));
        worker.pending.delete(msg.requestId);
      }
    }
  }
}
