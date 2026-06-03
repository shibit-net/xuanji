// ============================================================
// 内置中间件
// ============================================================

import type { IMiddleware } from './MiddlewarePipeline';
import type { IPermissionController, PermissionRequest } from '@/permission/types';
import type { ToolResult } from '@/shared/types/tools';
import { logger } from '@/infrastructure/logger';
import { isPermissionExempt } from '@/tools/ToolCategories';

const log = logger.child({ module: 'Middlewares' });

/**
 * 工具执行上下文
 */
export interface ToolContext {
  toolName: string;
  input: Record<string, any>;
  metadata?: Record<string, any>;
  signal?: AbortSignal;
}

/**
 * 权限中间件
 */
export class PermissionMiddleware implements IMiddleware<ToolContext, ToolResult> {
  constructor(private controller: IPermissionController) {}

  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    // 工具级别豁免检查：无副作用的工具直接跳过权限检查
    if (isPermissionExempt(context.toolName)) {
      log.debug(`Tool ${context.toolName} is permission-exempt, skipping check`);
      return await next();
    }

    // 构建权限请求
    const request: PermissionRequest = {
      requestId: `${context.toolName}-${Date.now()}`,
      toolName: context.toolName,
      input: context.input
    };

    // 检查权限
    const result = await this.controller.check(request);

    if (!result.allowed) {
      log.warn(`Permission denied for tool: ${context.toolName}`);
      return {
        content: `Permission denied: ${result.reason || 'Access not allowed'}`,
        isError: true
      };
    }

    // 继续执行
    return await next();
  }
}

/**
 * 日志中间件
 */
export class LoggingMiddleware implements IMiddleware<ToolContext, ToolResult> {
  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    const startTime = Date.now();
    log.debug(`Tool ${context.toolName} started`);

    try {
      const result = await next();
      const duration = Date.now() - startTime;
      log.debug(`Tool ${context.toolName} completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error(`Tool ${context.toolName} failed after ${duration}ms:`, error);
      throw error;
    }
  }
}

/**
 * 错误处理中间件
 */
export class ErrorHandlingMiddleware implements IMiddleware<ToolContext, ToolResult> {
  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await next();
    } catch (error) {
      log.error(`Error in tool ${context.toolName}:`, error);
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true
      };
    }
  }
}

/**
 * 超时中间件
 */
export class TimeoutMiddleware implements IMiddleware<ToolContext, ToolResult> {
  constructor(private timeoutMs: number) {}

  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        next(),
        new Promise<ToolResult>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Tool ${context.toolName} timeout after ${this.timeoutMs}ms`));
          }, this.timeoutMs);
        })
      ]);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      const isTimeout = error instanceof Error && error.message.includes('timeout after');
      if (isTimeout) {
        log.error(`Tool ${context.toolName} timeout after ${this.timeoutMs}ms`);
      } else {
        log.error(`Tool ${context.toolName} execution error:`, error);
      }

      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true
      };
    }
  }
}

/**
 * 重试中间件
 */
export class RetryMiddleware implements IMiddleware<ToolContext, ToolResult> {
  constructor(
    private maxRetries: number = 3,
    private retryDelay: number = 1000
  ) {}

  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await next();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries) {
          log.warn(`Tool ${context.toolName} failed, retrying (${attempt + 1}/${this.maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    throw lastError;
  }
}

/**
 * 缓存中间件
 * 带定期清理过期条目机制，防止长期运行内存无限增长
 */
export class CacheMiddleware implements IMiddleware<ToolContext, ToolResult> {
  private cache = new Map<string, { result: ToolResult; expireAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  // 最大缓存条目数，防止极端情况下内存溢出
  private maxSize: number;

  constructor(private ttl: number = 60000, maxSize: number = 500) {
    this.maxSize = maxSize;
    // 每分钟清理一次过期条目
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
    // 允许进程退出（不阻止事件循环）
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    const cacheKey = this.getCacheKey(context);

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expireAt) {
      log.debug(`Cache hit for tool: ${context.toolName}`);
      return cached.result;
    }

    // 命中已过期的条目时顺便清理
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const result = await next();

    // 超过最大条目数时，清理最旧的条目
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(cacheKey, {
      result,
      expireAt: Date.now() + this.ttl
    });

    return result;
  }

  private getCacheKey(context: ToolContext): string {
    return `${context.toolName}:${JSON.stringify(context.input)}`;
  }

  /** 清理所有过期条目 */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expireAt) {
        this.cache.delete(key);
      }
    }
  }

  /** 清理最旧的条目（FIFO） */
  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  /** 销毁中间件，清理定时器 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
  }
}
