// ============================================================
// ConfirmationService - 确认服务实现
// ============================================================
// 负责用户确认的串行化处理
//
// 职责:
// - 串行化确认请求（同一时刻只有一个确认框）
// - UI 交互
// - 超时处理
// ============================================================

import type { IConfirmationService, ConfirmationRequest, ConfirmationResult } from '../interfaces';
import type { ConfirmationHandler } from '@/permission/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfirmationService' });

/**
 * ConfirmationService - 确认服务
 */
export class ConfirmationService implements IConfirmationService {
  private queue: Promise<void> = Promise.resolve();
  private handler: ConfirmationHandler | null = null;

  /**
   * 设置确认处理器
   */
  setHandler(handler: ConfirmationHandler): void {
    this.handler = handler;
  }

  /**
   * 请求用户确认
   */
  async confirm(request: ConfirmationRequest): Promise<ConfirmationResult> {
    if (!this.handler) {
      log.warn('No confirmation handler set, defaulting to deny');
      return { allowed: false };
    }

    // 串行化确认请求
    return new Promise((resolve) => {
      this.queue = this.queue.then(async () => {
        try {
          const result = await this.showPrompt(request);
          resolve(result);
        } catch (error) {
          log.error('Confirmation error:', error);
          resolve({ allowed: false });
        }
      });
    });
  }

  /**
   * 显示确认提示
   */
  private async showPrompt(request: ConfirmationRequest): Promise<ConfirmationResult> {
    log.debug(`Requesting confirmation for: ${request.request.toolName}`);

    // 构造 GuardCheckResult
    const guardResult = {
      category: 'bashExec' as const,
      riskLevel: request.level,
      description: request.reason || `Tool: ${request.request.toolName}`,
      cacheKey: `tool:${request.request.toolName}`,
    };

    const userConfirmation = await this.handler!(request.request, guardResult);

    return {
      allowed: userConfirmation.allowed,
      remember: userConfirmation.remember
    };
  }

  /**
   * 获取队列状态
   */
  getQueueStatus() {
    return {
      hasHandler: this.handler !== null
    };
  }
}
