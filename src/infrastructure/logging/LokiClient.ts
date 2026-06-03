// ============================================================
// Loki Client - Grafana Loki 日志集成
// ============================================================

import { logger } from '../logger';

/**
 * Loki 日志条目
 */
export interface LokiLogEntry {
  timestamp: string;  // ISO 8601 或 nanoseconds
  line: string;        // 日志内容
}

/**
 * Loki 流标签
 */
export interface LokiStreamLabels {
  job?: string;
  source?: string;
  level?: string;
  module?: string;
  [key: string]: string | undefined;
}

/**
 * Loki 流
 */
export interface LokiStream {
  stream: LokiStreamLabels;
  values: Array<[string, string]>;  // [timestamp, line]
}

/**
 * Loki 推送请求
 */
export interface LokiPushRequest {
  streams: LokiStream[];
}

/**
 * Loki 客户端配置
 */
export interface LokiClientConfig {
  url?: string;           // Loki 地址 (默认 http://localhost:3100)
  username?: string;      // 认证用户名
  password?: string;      // 认证密码
  tenantId?: string;      // 租户 ID (可选)
  batchSize?: number;     // 批量发送大小 (默认 100)
  flushInterval?: number; // 自动刷新间隔 ms (默认 5000)
  enabled?: boolean;      // 是否启用 (默认 false)
}

/**
 * Loki 客户端
 *
 * 将日志发送到 Grafana Loki
 */
export class LokiClient {
  private config: Required<LokiClientConfig>;
  private logBuffer: LokiStream[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private log = logger.child({ module: 'LokiClient' });

  /**
   * 默认配置 - 默认完全禁用 Loki
   */
  private static defaultConfig: Required<LokiClientConfig> = {
    url: 'http://localhost:3100',
    username: '',
    password: '',
    tenantId: '',
    batchSize: 100,
    flushInterval: 5000,
    enabled: false, // 🔒 默认完全禁用
  };

  constructor(config?: LokiClientConfig) {
    this.config = { ...LokiClient.defaultConfig, ...config };
    
    if (this.config.enabled) {
      this.startAutoFlush();
      this.log.info('Loki client initialized', { url: this.config.url });
    }
  }

  /**
   * 推送日志到 Loki（如果禁用则静默跳过）
   */
  async push(
    lines: string[],
    labels: LokiStreamLabels = {}
  ): Promise<void> {
    if (!this.config.enabled) {
      // Loki 禁用，完全不做任何事（静默）
      return;
    }

    try {
      const values: Array<[string, string]> = lines.map(line => [
        this.getNanoTimestamp(),
        line
      ]);

      this.logBuffer.push({
        stream: {
          job: 'xuanji',
          ...labels
        },
        values
      });

      // 检查是否需要立即刷新
      if (this.logBuffer.length >= this.config.batchSize) {
        await this.flush();
      }
    } catch (error) {
      // 静默失败，不影响主程序
      this.log.debug('Loki push failed (will retry later)', error);
    }
  }

  /**
   * 推送单条日志
   */
  async pushLine(
    line: string,
    labels: LokiStreamLabels = {}
  ): Promise<void> {
    return this.push([line], labels);
  }

  /**
   * 推送结构化日志
   */
  async pushStructured(
    data: Record<string, unknown>,
    labels: LokiStreamLabels = {}
  ): Promise<void> {
    const line = JSON.stringify(data);
    return this.pushLine(line, { ...labels, format: 'json' });
  }

  /**
   * 手动刷新缓冲区
   */
  async flush(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    const streams = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.sendToLoki({ streams });
      this.log.debug(`Flushed ${streams.length} streams to Loki`);
    } catch (error) {
      this.log.error('Failed to flush logs to Loki', error);
      // 失败时把数据放回缓冲区
      this.logBuffer = [...streams, ...this.logBuffer];
    }
  }

  /**
   * 发送到 Loki API
   */
  private async sendToLoki(request: LokiPushRequest): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.tenantId) {
      headers['X-Scope-OrgID'] = this.config.tenantId;
    }

    if (this.config.username && this.config.password) {
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(`${this.config.url}/loki/api/v1/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Loki push failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 启动自动刷新
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.config.flushInterval);

    // 防止阻止进程退出
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * 停止自动刷新
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // 刷新剩余的日志
    this.flush().catch(() => {});
  }

  /**
   * 获取纳秒时间戳 (Loki 格式)
   */
  private getNanoTimestamp(): string {
    const now = Date.now();
    return `${now}000000`;  // Date.now() 是毫秒，转纳秒
  }

  /**
   * 健康检查（如果禁用直接返回 false，不会报错）
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.url}/ready`);
      return response.ok;
    } catch {
      // 连接失败，静默返回 false
      return false;
    }
  }

  /**
   * 简单检查：是否配置了并且连接可用？
   */
  isAvailable(): boolean {
    return this.config.enabled;
  }

  /**
   * 获取状态信息（用于 UI 显示）
   */
  getStatus(): { available: boolean; url: string; enabled: boolean } {
    return {
      available: this.config.enabled,
      url: this.config.url,
      enabled: this.config.enabled,
    };
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled) {
      this.startAutoFlush();
      this.log.info('Loki client enabled');
    } else {
      this.stop();
      this.log.info('Loki client disabled');
    }
  }
}

// 全局单例
let globalLokiClient: LokiClient | null = null;

/**
 * 获取全局 Loki 客户端
 */
export function getLokiClient(config?: LokiClientConfig): LokiClient {
  if (!globalLokiClient) {
    globalLokiClient = new LokiClient(config);
  }
  return globalLokiClient;
}

/**
 * 快速推送日志到 Loki
 */
export async function logToLoki(
  line: string,
  labels: LokiStreamLabels = {}
): Promise<void> {
  const client = getLokiClient();
  await client.pushLine(line, labels);
}

export default LokiClient;
