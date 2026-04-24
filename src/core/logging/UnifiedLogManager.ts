// ============================================================
// Unified Logging Manager — 统一日志查询管理器
// ============================================================
//
// 整合项目中所有日志系统，提供统一的查询接口
//
// 支持的日志源:
// 1. Core Logger (文本日志)
// 2. AgentLoopLogger (Agent 执行事件)
// 3. SessionRecorder (会话统计)
// 4. AuditLogger (审计日志)
// 5. UsageStatsRecorder (使用统计)
// 6. DailyUsageStats (每日统计)
//
// ============================================================

import { join } from 'node:path';
import { LogReader } from '../logger/LogReader.js';
import { AgentLoopLogger } from '../telemetry/AgentLoopLogger.js';
import { SessionRecorder } from '../telemetry/SessionRecorder.js';
import { AuditLogger } from '../telemetry/AuditLogger.js';
import { UsageStatsRecorder } from '../telemetry/UsageStatsRecorder.js';
import { DailyUsageStats } from '../telemetry/DailyUsageStats.js';
import { logger } from '../logger/index.js';
import { LokiClient, type LokiClientConfig } from './LokiClient.js';
import { formatLogTimestamp } from '../../shared/utils/time/formatters.js';

export type { LokiClientConfig };

// ─────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────

/** 日志源类型 */
export type LogSource = 
  | 'core'        // Core Logger
  | 'agentloop'   // AgentLoopLogger
  | 'session'     // SessionRecorder
  | 'audit'       // AuditLogger
  | 'usage'       // UsageStatsRecorder
  | 'daily';      // DailyUsageStats

/** 日志颜色配置 */
export interface LogColorConfig {
  fg: string;
  bg?: string;
  emoji: string;
}

/** 日志源颜色配置 */
export const LOG_SOURCE_COLORS: Record<LogSource, LogColorConfig> = {
  core: { fg: '#60a5fa', emoji: '📝' },
  agentloop: { fg: '#a78bfa', emoji: '🤖' },
  session: { fg: '#34d399', emoji: '💬' },
  audit: { fg: '#f472b6', emoji: '🔐' },
  usage: { fg: '#fbbf24', emoji: '📊' },
  daily: { fg: '#f87171', emoji: '📅' },
};

/** 日志级别颜色配置 */
export const LOG_LEVEL_COLORS: Record<string, LogColorConfig> = {
  debug: { fg: '#9ca3af', emoji: '🔍' },
  info: { fg: '#60a5fa', emoji: 'ℹ️' },
  warn: { fg: '#fbbf24', emoji: '⚠️' },
  error: { fg: '#ef4444', emoji: '❌' },
  success: { fg: '#34d399', emoji: '✅' },
};

/** 统一的日志记录（基础接口） */
export interface UnifiedLogRecord {
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 日志源 */
  source: LogSource;
  /** 日志级别 */
  level: string;
  /** 日志消息 */
  message: string;
  /** 原始数据 */
  data: unknown;
  /** 命名空间/模块 */
  namespace?: string;
}

/** 统一查询过滤器 */
export interface UnifiedLogFilter {
  /** 日志源（可多选） */
  sources?: LogSource[];
  /** 日志级别（可多选） */
  levels?: string[];
  /** 开始时间 */
  startTime?: string;
  /** 结束时间 */
  endTime?: string;
  /** 关键词搜索 */
  keyword?: string;
  /** 最大条数 */
  limit?: number;
  /** 偏移量（分页） */
  offset?: number;
  /** Core Logger 特定过滤 */
  core?: {
    levels?: Array<'debug' | 'info' | 'warn' | 'error'>;
  };
  /** AgentLoop 特定过滤 */
  agentLoop?: {
    eventTypes?: string[];
    sessionId?: string;
  };
  /** Audit 特定过滤 */
  audit?: {
    eventTypes?: Array<'permission_check' | 'plan_review'>;
    riskLevels?: Array<'safe' | 'warn' | 'danger'>;
    allowed?: boolean;
  };
}

/** 统一查询结果 */
export interface UnifiedQueryResult {
  /** 总匹配条数 */
  total: number;
  /** 当前页数据 */
  records: UnifiedLogRecord[];
  /** 查询耗时 (ms) */
  queryTimeMs: number;
  /** 各日志源的命中统计 */
  sourceStats: Record<LogSource, number>;
}

/** 日志统计摘要 */
export interface LogStats {
  /** 各日志源的记录数 */
  counts: Record<LogSource, number>;
  /** 总记录数 */
  total: number;
  /** 最早记录时间 */
  earliest?: string;
  /** 最新记录时间 */
  latest?: string;
  /** 文件大小信息 */
  fileSizes?: Record<LogSource, number>;
}

// ─────────────────────────────────────────────────────
// Color Utilities
// ─────────────────────────────────────────────────────

/** ANSI 颜色工具 */
export class ColorUtil {
  static readonly ANSI_CODES = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    
    // 前景色
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    // 背景色
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
  };

  /**
   * 应用颜色到文本
   */
  static colorize(text: string, color: string): string {
    return `${color}${text}${this.ANSI_CODES.reset}`;
  }

  /**
   * 从十六进制颜色生成 ANSI 256 色
   */
  static hexToAnsi(hex: string): string {
    // 简化版本 - 使用基础颜色映射
    const colorMap: Record<string, string> = {
      '#60a5fa': this.ANSI_CODES.blue,
      '#a78bfa': this.ANSI_CODES.magenta,
      '#34d399': this.ANSI_CODES.green,
      '#f472b6': this.ANSI_CODES.magenta,
      '#fbbf24': this.ANSI_CODES.yellow,
      '#f87171': this.ANSI_CODES.red,
      '#9ca3af': this.ANSI_CODES.gray,
      '#ef4444': this.ANSI_CODES.red,
    };
    return colorMap[hex] || this.ANSI_CODES.white;
  }

  /**
   * 格式化带颜色的日志行
   */
  static formatColored(record: UnifiedLogRecord): string {
    const sourceConfig = LOG_SOURCE_COLORS[record.source];
    const levelConfig = LOG_LEVEL_COLORS[record.level] || LOG_LEVEL_COLORS.info;

    const timestamp = this.colorize(
      `[${formatLogTimestamp(record.timestamp)}]`,
      this.ANSI_CODES.gray
    );

    const source = this.colorize(
      `${sourceConfig.emoji} ${record.source.toUpperCase().padEnd(10)}`,
      this.hexToAnsi(sourceConfig.fg)
    );

    const level = this.colorize(
      `${levelConfig.emoji} ${record.level.toUpperCase().padEnd(6)}`,
      this.hexToAnsi(levelConfig.fg)
    );

    const namespace = record.namespace
      ? this.colorize(`[${record.namespace}]`, this.ANSI_CODES.cyan)
      : '';

    return `${timestamp} ${source} ${level} ${namespace} ${record.message}`;
  }
}

// ─────────────────────────────────────────────────────
// UnifiedLogManager Implementation
// ─────────────────────────────────────────────────────

/**
 * 日志订阅回调
 */
export type LogSubscriptionCallback = (record: UnifiedLogRecord) => void;

/**
 * UnifiedLogManager — 统一的日志查询管理器
 *
 * 整合所有日志系统，提供单一查询接口
 */
export class UnifiedLogManager {
  private logDir: string;
  private logReader: LogReader;
  private agentLoopLogger: AgentLoopLogger;
  private sessionRecorder: SessionRecorder;
  private auditLogger: AuditLogger;
  private usageStatsRecorder: UsageStatsRecorder;
  private dailyUsageStats: DailyUsageStats;
  private log = logger.child({ module: 'UnifiedLogManager' });
  private lokiClient: LokiClient | null = null;
  private subscribers: Set<LogSubscriptionCallback> = new Set();
  private liveLogs: UnifiedLogRecord[] = [];
  private maxLiveLogs = 1000;

  constructor(baseDir?: string, lokiConfig?: LokiClientConfig) {
    this.logDir = baseDir ?? join(process.cwd(), '.xuanji');

    this.logReader = new LogReader(join(this.logDir, 'logs'));
    this.agentLoopLogger = new AgentLoopLogger('unified-log-manager', 'system');
    this.sessionRecorder = new SessionRecorder();
    this.auditLogger = new AuditLogger();
    this.usageStatsRecorder = new UsageStatsRecorder();
    this.dailyUsageStats = new DailyUsageStats();
    
    // 初始化 Loki 客户端
    if (lokiConfig) {
      this.lokiClient = new LokiClient(lokiConfig);
    }
  }

  // ─────────────────────────────────────────────────────
  // Live Log Methods
  // ─────────────────────────────────────────────────────

  /**
   * 订阅实时日志
   */
  subscribe(callback: LogSubscriptionCallback): () => void {
    this.subscribers.add(callback);
    // 返回取消订阅函数
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * 添加实时日志记录
   */
  addLog(record: UnifiedLogRecord): void {
    this.liveLogs.unshift(record);
    // 保持在限制内
    if (this.liveLogs.length > this.maxLiveLogs) {
      this.liveLogs = this.liveLogs.slice(0, this.maxLiveLogs);
    }
    // 通知订阅者
    this.subscribers.forEach(callback => {
      try {
        callback(record);
      } catch (error) {
        this.log.error('Subscriber error', error);
      }
    });
    // 发送到 Loki（如果启用）
    if (this.lokiClient) {
      this.lokiClient.pushLine(
        record.message,
        {
          source: record.source,
          level: record.level,
          module: record.namespace || '',
        }
      ).catch(() => {});
    }
  }

  /**
   * 获取实时日志
   */
  getLiveLogs(limit = 100): UnifiedLogRecord[] {
    return this.liveLogs.slice(0, limit);
  }

  /**
   * 清除实时日志
   */
  clearLiveLogs(): void {
    this.liveLogs = [];
  }

  // ─────────────────────────────────────────────────────
  // Loki Integration
  // ─────────────────────────────────────────────────────

  /**
   * 获取 Loki 客户端
   */
  getLokiClient(): LokiClient | null {
    return this.lokiClient;
  }

  /**
   * 设置 Loki 客户端
   */
  setLokiClient(config: LokiClientConfig): void {
    this.lokiClient = new LokiClient(config);
  }

  /**
   * 同步现有日志到 Loki
   */
  async syncToLoki(filter: UnifiedLogFilter = {}): Promise<void> {
    if (!this.lokiClient) {
      return;
    }

    const result = await this.query({ ...filter, limit: 1000 });
    const lines = result.records.map(r => 
      `[${r.timestamp}] [${r.source}] [${r.level}] ${r.message}`
    );
    await this.lokiClient.push(lines, { source: 'sync' });
  }

  // ─────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────

  /**
   * 统一查询接口 - 查询所有日志源
   */
  async query(filter: UnifiedLogFilter = {}): Promise<UnifiedQueryResult> {
    const startTime = Date.now();
    const sourceStats: Record<LogSource, number> = {
      core: 0, agentloop: 0, session: 0, 
      audit: 0, usage: 0, daily: 0
    };
    
    const sources = filter.sources ?? ['core', 'agentloop', 'session', 'audit', 'usage', 'daily'];
    let allRecords: UnifiedLogRecord[] = [];

    try {
      // 并行查询所有日志源
      const promises = sources.map(async (source) => {
        try {
          const records = await this.querySource(source, filter);
          sourceStats[source] = records.length;
          return records;
        } catch (err) {
          this.log.warn(`Failed to query source ${source}:`, err);
          return [];
        }
      });

      const results = await Promise.all(promises);
      allRecords = results.flat();

      // 时间排序（统一排序）
      allRecords.sort((a, b) => 
        b.timestamp.localeCompare(a.timestamp)
      );

      // 分页
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 100;
      const paginated = allRecords.slice(offset, offset + limit);

      return {
        total: allRecords.length,
        records: paginated,
        queryTimeMs: Date.now() - startTime,
        sourceStats
      };
    } catch (err) {
      this.log.error('Query failed:', err);
      throw err;
    }
  }

  /**
   * 打印彩色日志到控制台
   */
  async printColored(filter: UnifiedLogFilter = {}): Promise<void> {
    const result = await this.query(filter);
    
    console.log('\n' + ColorUtil.colorize(
      '═══════════════════════════════════════════════════════════════',
      ColorUtil.ANSI_CODES.bold
    ));
    console.log(ColorUtil.colorize(
      `📊 查询结果 - 共 ${result.total} 条记录 (${result.queryTimeMs}ms)`,
      ColorUtil.ANSI_CODES.cyan
    ));
    console.log(ColorUtil.colorize(
      `📈 各源统计: ${Object.entries(result.sourceStats)
        .filter(([_, count]) => count > 0)
        .map(([source, count]) => `${LOG_SOURCE_COLORS[source as LogSource].emoji} ${source}: ${count}`)
        .join(', ')}`,
      ColorUtil.ANSI_CODES.gray
    ));
    console.log(ColorUtil.colorize(
      '═══════════════════════════════════════════════════════════════\n',
      ColorUtil.ANSI_CODES.bold
    ));

    result.records.forEach(record => {
      console.log(ColorUtil.formatColored(record));
    });
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<LogStats> {
    const counts: Record<LogSource, number> = {
      core: 0, agentloop: 0, session: 0, 
      audit: 0, usage: 0, daily: 0
    };

    // 查询各源统计
    try {
      const coreRecords = await this.queryCoreLogger({});
      counts.core = coreRecords.length;
    } catch { /* 忽略 */ }

    try {
      const agentLoopRecords = await this.queryAgentLoopLogger({});
      counts.agentloop = agentLoopRecords.length;
    } catch { /* 忽略 */ }

    try {
      const sessionRecords = await this.querySessionRecorder({});
      counts.session = sessionRecords.length;
    } catch { /* 忽略 */ }

    try {
      const auditRecords = await this.queryAuditLogger({});
      counts.audit = auditRecords.length;
    } catch { /* 忽略 */ }

    try {
      const usageRecords = await this.queryUsageStats({});
      counts.usage = usageRecords.length;
    } catch { /* 忽略 */ }

    try {
      const dailyRecords = await this.queryDailyUsage({});
      counts.daily = dailyRecords.length;
    } catch { /* 忽略 */ }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      counts,
      total,
    };
  }

  /**
   * 查询单个日志源
   */
  private async querySource(source: LogSource, filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    switch (source) {
      case 'core':
        return await this.queryCoreLogger(filter);
      case 'agentloop':
        return await this.queryAgentLoopLogger(filter);
      case 'session':
        return await this.querySessionRecorder(filter);
      case 'audit':
        return await this.queryAuditLogger(filter);
      case 'usage':
        return await this.queryUsageStats(filter);
      case 'daily':
        return await this.queryDailyUsage(filter);
      default:
        return [];
    }
  }

  // ─────────────────────────────────────────────────────
  // Source-specific Query Methods
  // ─────────────────────────────────────────────────────

  private async queryCoreLogger(filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    const coreFilter = filter.core;
    const records = await this.logReader.readAll({
      levels: coreFilter?.levels as any,
      startTime: filter.startTime ? new Date(filter.startTime) : undefined,
      endTime: filter.endTime ? new Date(filter.endTime) : undefined,
      keyword: filter.keyword,
    });
    
    return records.map((r: any) => ({
      timestamp: r.timestamp,
      source: 'core' as const,
      level: r.level,
      message: r.message,
      namespace: r.namespace,
      data: r,
    }));
  }

  private async queryAgentLoopLogger(filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    const agentLoopFilter = filter.agentLoop;
    const records = await AgentLoopLogger.query({
      sessionId: agentLoopFilter?.sessionId,
      eventType: agentLoopFilter?.eventTypes as any,
    });
    
    return records.map((r: any) => ({
      timestamp: r.timestamp,
      source: 'agentloop' as const,
      level: this.inferLevelFromEventType(r.eventType),
      message: `[${r.eventType}] ${JSON.stringify(r).slice(0, 100)}...`,
      namespace: 'agentloop',
      data: r,
    }));
  }

  private async querySessionRecorder(filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    const records = await this.sessionRecorder.readRecords(filter.limit);
    
    // 时间过滤
    let filtered = records;
    if (filter.startTime) {
      filtered = filtered.filter(r => r.timestamp >= filter.startTime!);
    }
    if (filter.endTime) {
      filtered = filtered.filter(r => r.timestamp <= filter.endTime!);
    }
    if (filter.keyword) {
      filtered = filtered.filter(r => 
        r.model.toLowerCase().includes(filter.keyword!.toLowerCase())
      );
    }
    
    return filtered.map(r => ({
      timestamp: r.timestamp,
      source: 'session' as const,
      level: 'info',
      message: `${r.model}: ${r.input + r.output} tokens (${r.durationMs}ms)`,
      namespace: 'session',
      data: r,
    }));
  }

  private async queryAuditLogger(filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    const auditFilter = filter.audit;
    const records = await this.auditLogger.query({
      eventType: auditFilter?.eventTypes?.[0],
      riskLevel: auditFilter?.riskLevels?.[0],
      allowed: auditFilter?.allowed,
      startTime: filter.startTime,
      endTime: filter.endTime,
    });
    
    return records.map((r: any) => ({
      timestamp: r.timestamp,
      source: 'audit' as const,
      level: r.allowed ? 'info' : 'warn',
      message: `[${r.eventType}] ${r.toolName || r.planPreview?.slice(0, 50) || ''}`,
      namespace: 'audit',
      data: r,
    }));
  }

  private async queryUsageStats(filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    const records = await this.usageStatsRecorder.query({
      startTime: filter.startTime,
      endTime: filter.endTime,
    });
    
    return records.map((r: any) => ({
      timestamp: r.timestamp,
      source: 'usage' as const,
      level: 'info',
      message: `${r.model || 'Usage'}: ${r.input + r.output} tokens`,
      namespace: 'usage',
      data: r,
    }));
  }

  private async queryDailyUsage(filter: UnifiedLogFilter): Promise<UnifiedLogRecord[]> {
    // 简化版本 - DailyUsageStats 需要根据实际接口调整
    return [];
  }

  /**
   * 从事件类型推断日志级别
   */
  private inferLevelFromEventType(eventType: string): string {
    const errorTypes = ['error_caught', 'interrupt'];
    const warnTypes = ['llm_retry', 'error_recovery'];
    const successTypes = ['session_complete', 'tool_result'];
    
    if (errorTypes.includes(eventType)) return 'error';
    if (warnTypes.includes(eventType)) return 'warn';
    if (successTypes.includes(eventType)) return 'success';
    return 'info';
  }
}

// ─────────────────────────────────────────────────────
// Global Instance
// ─────────────────────────────────────────────────────

let globalInstance: UnifiedLogManager | null = null;

/**
 * 获取全局 UnifiedLogManager 实例
 */
export function getUnifiedLogManager(): UnifiedLogManager {
  if (!globalInstance) {
    globalInstance = new UnifiedLogManager();
  }
  return globalInstance;
}

/**
 * 快速查询并打印彩色日志
 */
export async function printLogs(filter: UnifiedLogFilter = {}): Promise<void> {
  const manager = getUnifiedLogManager();
  await manager.printColored(filter);
}

/**
 * 快速获取统计信息
 */
export async function getLogStats(): Promise<LogStats> {
  const manager = getUnifiedLogManager();
  return await manager.getStats();
}

export default UnifiedLogManager;
