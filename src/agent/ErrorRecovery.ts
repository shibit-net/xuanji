// ============================================================
// M2 Agent — 错误恢复
// ============================================================

/**
 * 错误恢复策略
 */
export class ErrorRecovery {
  private consecutiveErrors = 0;
  private maxConsecutiveErrors: number;

  constructor(maxConsecutiveErrors = 3) {
    this.maxConsecutiveErrors = maxConsecutiveErrors;
  }

  /**
   * 记录错误
   * @returns 是否应该终止循环
   */
  recordError(error: Error): boolean {
    this.consecutiveErrors++;
    return this.consecutiveErrors >= this.maxConsecutiveErrors;
  }

  /**
   * 重置错误计数 (成功执行后调用)
   */
  reset(): void {
    this.consecutiveErrors = 0;
  }

  /**
   * 获取连续错误次数
   */
  getConsecutiveErrors(): number {
    return this.consecutiveErrors;
  }

  /**
   * 将错误转为用户友好消息
   */
  static formatError(error: unknown): string {
    if (error instanceof Error) {
      // API Key 错误
      if (error.message.includes('api_key') || error.message.includes('authentication')) {
        return '认证失败，请检查 API Key 配置 (XUANJI_API_KEY 环境变量)';
      }
      // 网络错误
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        return '网络连接失败，请检查网络或 API 地址配置';
      }
      // 限流
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        return 'API 请求频率超限，请稍后重试';
      }
      // 余额不足
      if (error.message.includes('insufficient') || error.message.includes('billing')) {
        return 'API 账户余额不足，请充值后重试';
      }
      return error.message;
    }
    return String(error);
  }
}
