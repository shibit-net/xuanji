// ============================================================
// MiddlewarePipeline - 中间件管道
// ============================================================
// 通用的中间件模式，用于统一处理权限检查、日志、错误处理等
//
// 特性:
// - 洋葱模型（Koa 风格）
// - 类型安全
// - 支持异步中间件
// - 错误处理
// ============================================================

import { logger } from '@/core/logger';

const log = logger.child({ module: 'MiddlewarePipeline' });

/**
 * 中间件接口
 */
export interface IMiddleware<TContext, TResult> {
  /**
   * 执行中间件
   * @param context 上下文
   * @param next 下一个中间件
   */
  execute(context: TContext, next: () => Promise<TResult>): Promise<TResult>;
}

/**
 * 中间件函数类型
 */
export type MiddlewareFunction<TContext, TResult> = (
  context: TContext,
  next: () => Promise<TResult>
) => Promise<TResult>;

/**
 * MiddlewarePipeline - 中间件管道
 */
export class MiddlewarePipeline<TContext, TResult> {
  private middlewares: Array<IMiddleware<TContext, TResult> | MiddlewareFunction<TContext, TResult>> = [];

  /**
   * 添加中间件
   */
  use(middleware: IMiddleware<TContext, TResult> | MiddlewareFunction<TContext, TResult>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 执行管道
   */
  async execute(context: TContext, handler: () => Promise<TResult>): Promise<TResult> {
    let index = 0;

    const next = async (): Promise<TResult> => {
      if (index >= this.middlewares.length) {
        // 所有中间件执行完毕，执行最终处理器
        return await handler();
      }

      const middleware = this.middlewares[index++];

      try {
        if (typeof middleware === 'function') {
          return await middleware(context, next);
        } else {
          return await middleware.execute(context, next);
        }
      } catch (error) {
        log.error('Middleware error:', error);
        throw error;
      }
    };

    return await next();
  }

  /**
   * 获取中间件数量
   */
  size(): number {
    return this.middlewares.length;
  }

  /**
   * 清空所有中间件
   */
  clear(): void {
    this.middlewares = [];
  }
}
