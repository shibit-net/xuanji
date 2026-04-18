// ============================================================
// M10 遥测 — 使用统计记录器 (UsageStats)
// ============================================================
//
// 扩展 SessionRecorder，增加工具调用统计和聚合分析能力。
//
// 特性:
// - 记录每次会话的 token 用量、工具调用详情
// - 支持按模型、工具名维度聚合统计
// - 支持按时间范围过滤
// - JSONL 格式，追加友好，流式解析
//

import { join } from 'node:path';
import { appendFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ── 类型定义 ──

/** 工具调用统计 */
export interface ToolCallStats {
  /** 工具名称 */
  name: string;
  /** 调用次数 */
  count: number;
  /** 总耗时 (毫秒) */
  durationMs: number;
  /** 错误次数 */
  errorCount: number;
}

/** 使用记录 (扩展 SessionRecord) */
export interface UsageRecord {
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 会话 ID */
  sessionId?: string;
  /** 模型名称 */
  model: string;
  /** 输入 token */
  input: number;
  /** 输出 token */
  output: number;
  /** 缓存读取 token */
  cacheRead?: number;
  /** 缓存写入 token */
  cacheWrite?: number;
  /** 会话总耗时 (毫秒) */
  durationMs: number;
  /** 迭代次数 */
  iterations?: number;
  /** 工具调用统计 */
  toolCalls?: ToolCallStats[];
}

/** 使用查询过滤器 */
export interface UsageQueryFilter {
  /** 模型名称 */
  model?: string;
  /** 开始时间 (ISO 8601) */
  startTime?: string;
  /** 结束时间 (ISO 8601) */
  endTime?: string;
  /** 最大条数 */
  limit?: number;
}

/** 按模型聚合的统计 */
export interface ModelStats {
  sessionCount: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalDurationMs: number;
}

/** 按工具聚合的统计 */
export interface ToolAggregateStats {
  callCount: number;
  totalDurationMs: number;
  errorCount: number;
  avgDurationMs: number;
}

/** 聚合统计结果 */
export interface AggregatedStats {
  timeRange: { start: string; end: string };
  byModel: Record<string, ModelStats>;
  byTool: Record<string, ToolAggregateStats>;
  total: {
    sessionCount: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    durationMs: number;
    iterations: number;
  };
}

/**
 * UsageStatsRecorder — 使用统计记录器
 *
 * 将每次会话的 token 用量和工具调用统计持久化到 JSONL 文件，
 * 支持按模型、工具、时间维度进行聚合分析。
 */
export class UsageStatsRecorder {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(process.cwd(), '.xuanji', 'logs', 'usage.jsonl');
  }

  /**
   * 记录使用统计
   */
  async record(record: UsageRecord): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify(record) + '\n';
      await appendFile(this.filePath, line, 'utf-8');
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /**
   * 查询使用记录
   */
  async query(filter?: UsageQueryFilter): Promise<UsageRecord[]> {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }

      const text = await readFile(this.filePath, 'utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      let records: UsageRecord[] = [];

      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as UsageRecord);
        } catch {
          // 跳过格式错误的行
        }
      }

      // 应用过滤器
      if (filter) {
        if (filter.model) {
          records = records.filter((r) => r.model === filter.model);
        }
        if (filter.startTime) {
          records = records.filter((r) => r.timestamp >= filter.startTime!);
        }
        if (filter.endTime) {
          records = records.filter((r) => r.timestamp <= filter.endTime!);
        }
        if (filter.limit) {
          records = records.slice(-filter.limit);
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * 聚合统计
   */
  async aggregate(filter?: UsageQueryFilter): Promise<AggregatedStats> {
    const records = await this.query(filter);

    const byModel: Record<string, ModelStats> = {};
    const byTool: Record<string, ToolAggregateStats> = {};
    const total = {
      sessionCount: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      durationMs: 0,
      iterations: 0,
    };

    let minTime = '';
    let maxTime = '';

    for (const record of records) {
      // 时间范围
      if (!minTime || record.timestamp < minTime) minTime = record.timestamp;
      if (!maxTime || record.timestamp > maxTime) maxTime = record.timestamp;

      // 总计
      total.sessionCount++;
      total.input += record.input;
      total.output += record.output;
      total.cacheRead += record.cacheRead ?? 0;
      total.cacheWrite += record.cacheWrite ?? 0;
      total.durationMs += record.durationMs;
      total.iterations += record.iterations ?? 0;

      // 按模型聚合
      if (!byModel[record.model]) {
        byModel[record.model] = {
          sessionCount: 0,
          totalInput: 0,
          totalOutput: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          totalDurationMs: 0,
        };
      }
      const modelStats = byModel[record.model];
      modelStats.sessionCount++;
      modelStats.totalInput += record.input;
      modelStats.totalOutput += record.output;
      modelStats.totalCacheRead += record.cacheRead ?? 0;
      modelStats.totalCacheWrite += record.cacheWrite ?? 0;
      modelStats.totalDurationMs += record.durationMs;

      // 按工具聚合
      if (record.toolCalls) {
        for (const tc of record.toolCalls) {
          if (!byTool[tc.name]) {
            byTool[tc.name] = {
              callCount: 0,
              totalDurationMs: 0,
              errorCount: 0,
              avgDurationMs: 0,
            };
          }
          const toolStats = byTool[tc.name];
          toolStats.callCount += tc.count;
          toolStats.totalDurationMs += tc.durationMs;
          toolStats.errorCount += tc.errorCount;
        }
      }
    }

    // 计算工具平均耗时
    for (const stats of Object.values(byTool)) {
      stats.avgDurationMs = stats.callCount > 0
        ? Math.round(stats.totalDurationMs / stats.callCount)
        : 0;
    }

    return {
      timeRange: {
        start: minTime || filter?.startTime || '',
        end: maxTime || filter?.endTime || '',
      },
      byModel,
      byTool,
      total,
    };
  }

  /**
   * 清空所有记录
   */
  async clear(): Promise<void> {
    try {
      if (existsSync(this.filePath)) {
        await unlink(this.filePath);
      }
    } catch {
      // 静默失败
    }
  }
}
