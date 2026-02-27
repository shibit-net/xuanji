// ============================================================
// PerfCollector — LLM 性能指标采集器
// ============================================================

import { appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/**
 * 单次 LLM 调用的性能指标
 */
export interface PerfRecord {
  /** ISO 时间戳 */
  timestamp: string;
  /** 模型名称 */
  model: string;
  /** 迭代序号 */
  iteration: number;
  /** 首 token 延迟 (ms) */
  firstTokenMs: number;
  /** 总响应耗时 (ms) */
  totalMs: number;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 输出吞吐量 (tokens/s) */
  outputThroughput: number;
}

/**
 * 聚合性能统计
 */
export interface PerfStats {
  /** 记录数 */
  count: number;
  /** 平均首 token 延迟 (ms) */
  avgFirstTokenMs: number;
  /** P95 首 token 延迟 (ms) */
  p95FirstTokenMs: number;
  /** 平均总响应耗时 (ms) */
  avgTotalMs: number;
  /** 平均输出吞吐量 (tokens/s) */
  avgThroughput: number;
}

const DEFAULT_PERF_PATH = join(homedir(), '.xuanji', 'logs', 'perf.jsonl');

/**
 * 性能指标采集器
 *
 * 以 JSONL 格式记录每次 LLM 调用的性能指标，支持聚合查询。
 */
export class PerfCollector {
  private filePath: string;
  private initialized = false;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PERF_PATH;
  }

  /**
   * 记录一条性能指标
   */
  async record(record: PerfRecord): Promise<void> {
    try {
      if (!this.initialized) {
        await mkdir(dirname(this.filePath), { recursive: true });
        this.initialized = true;
      }
      await appendFile(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /**
   * 创建一个计时器，用于测量首 token 延迟和总耗时
   */
  createTimer(model: string, iteration: number): PerfTimer {
    return new PerfTimer(this, model, iteration);
  }

  /**
   * 读取最近 N 条记录
   */
  async readRecords(limit = 100): Promise<PerfRecord[]> {
    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const records: PerfRecord[] = [];
      for (const line of lines) {
        try {
          records.push(JSON.parse(line));
        } catch {
          // 跳过格式错误的行
        }
      }
      return records.slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * 聚合性能统计
   */
  async aggregate(limit = 100): Promise<PerfStats> {
    const records = await this.readRecords(limit);
    if (records.length === 0) {
      return { count: 0, avgFirstTokenMs: 0, p95FirstTokenMs: 0, avgTotalMs: 0, avgThroughput: 0 };
    }

    const firstTokenValues = records.map((r) => r.firstTokenMs).sort((a, b) => a - b);
    const p95Index = Math.min(Math.floor(records.length * 0.95), records.length - 1);

    return {
      count: records.length,
      avgFirstTokenMs: Math.round(firstTokenValues.reduce((a, b) => a + b, 0) / records.length),
      p95FirstTokenMs: firstTokenValues[p95Index]!,
      avgTotalMs: Math.round(records.reduce((a, r) => a + r.totalMs, 0) / records.length),
      avgThroughput: Math.round(records.reduce((a, r) => a + r.outputThroughput, 0) / records.length * 10) / 10,
    };
  }
}

/**
 * 性能计时器
 *
 * 用法:
 * ```
 * const timer = perfCollector.createTimer(model, iteration);
 * // 开始流式响应
 * timer.markFirstToken();  // 收到第一个 token 时调用
 * // 流式响应结束
 * timer.finish(inputTokens, outputTokens);  // 自动记录到 PerfCollector
 * ```
 */
export class PerfTimer {
  private collector: PerfCollector;
  private model: string;
  private iteration: number;
  private startTime: number;
  private firstTokenTime: number | null = null;

  constructor(collector: PerfCollector, model: string, iteration: number) {
    this.collector = collector;
    this.model = model;
    this.iteration = iteration;
    this.startTime = Date.now();
  }

  /**
   * 标记收到第一个 token 的时间
   */
  markFirstToken(): void {
    if (this.firstTokenTime === null) {
      this.firstTokenTime = Date.now();
    }
  }

  /**
   * 完成计时并记录
   */
  async finish(inputTokens: number, outputTokens: number): Promise<void> {
    const now = Date.now();
    const totalMs = now - this.startTime;
    const firstTokenMs = this.firstTokenTime ? this.firstTokenTime - this.startTime : totalMs;
    const outputThroughput = totalMs > 0 ? Math.round((outputTokens / totalMs) * 1000 * 10) / 10 : 0;

    await this.collector.record({
      timestamp: new Date().toISOString(),
      model: this.model,
      iteration: this.iteration,
      firstTokenMs,
      totalMs,
      inputTokens,
      outputTokens,
      outputThroughput,
    });
  }
}
