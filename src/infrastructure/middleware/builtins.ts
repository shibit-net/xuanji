// ============================================================
// 内置中间件
// ============================================================

import type { IMiddleware } from './MiddlewarePipeline';
import type { IPermissionController, PermissionRequest } from '@/permission/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'Middlewares' });

/**
 * 工具执行上下文
 */
export interface ToolContext {
  toolName: string;
  input: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success?: boolean;
  data?: any;
  error?: string;
}

/**
 * 权限中间件
 */
export class PermissionMiddleware implements IMiddleware<ToolContext, ToolResult> {
  constructor(private controller: IPermissionController) {}

  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    // 构建权限请求
    const request: PermissionRequest = {
      operation: context.toolName,
      tool: context.toolName,
      input: context.input
    };

    // 检查权限
    const result = await this.controller.check(request);

    if (!result.allowed) {
      log.warn(`Permission denied for tool: ${context.toolName}`);
      return {
        success: false,
        error: `Permission denied: ${result.reason || 'Access not allowed'}`
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
        success: false,
        error: error instanceof Error ? error.message : String(error)
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
    return await Promise.race([
      next(),
      new Promise<ToolResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Tool ${context.toolName} timeout after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      })
    ]);
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
 */
export class CacheMiddleware implements IMiddleware<ToolContext, ToolResult> {
  private cache = new Map<string, { result: ToolResult; expireAt: number }>();

  constructor(private ttl: number = 60000) {}

  async execute(context: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
    const cacheKey = this.getCacheKey(context);

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expireAt) {
      log.debug(`Cache hit for tool: ${context.toolName}`);
      return cached.result;
    }

    // 执行并缓存
    const result = await next();
    this.cache.set(cacheKey, {
      result,
      expireAt: Date.now() + this.ttl
    });

    return result;
  }

  private getCacheKey(context: ToolContext): string {
    return `${context.toolName}:${JSON.stringify(context.input)}`;
  }

  clear(): void {
    this.cache.clear();
  }
}
