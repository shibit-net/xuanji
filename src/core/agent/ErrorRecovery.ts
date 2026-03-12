// ============================================================
// M2 Agent — 错误恢复
// ============================================================

/**
 * 错误恢复策略
 */
export class ErrorRecovery {
  private consecutiveErrors = 0;
  private maxConsecutiveErrors: number;

  constructor(maxConsecutiveErrors = 1) {
    // 改为 1：第一次错误就停止（之前是 3）
    this.maxConsecutiveErrors = maxConsecutiveErrors;
  }

  /**
   * 判断是否为致命错误（应该立即停止，不重试）
   */
  static isFatalError(error: Error): boolean {
    const msg = error.message.toLowerCase();

    // 认证错误
    if (msg.includes('api_key') || msg.includes('authentication') || msg.includes('unauthorized') || msg.includes('403')) {
      return true;
    }

    // 网络错误（无法连接）
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      return true;
    }

    // 无效配置
    if (msg.includes('unsupported model') || msg.includes('not supported')) {
      return true;
    }

    // 参数错误
    if (msg.includes('invalid') && msg.includes('parameter')) {
      return true;
    }

    // 未找到 API Key
    if (msg.includes('未找到 api key')) {
      return true;
    }

    return false;
  }

  /**
   * 记录错误
   * @returns 是否应该终止循环
   */
  recordError(error: Error): boolean {
    // 致命错误立即终止
    if (ErrorRecovery.isFatalError(error)) {
      return true;
    }

    // 所有其他错误也只重试一次
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
        return '认证失败，请检查 API Key 配置';
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
      // 服务端错误 (500/502/503)
      if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
        return `API 服务端错误: ${error.message}\n提示: 这通常是 API 服务暂时不可用，请稍后重试。如使用代理服务，请检查代理是否正常`;
      }
      // API 服务内部错误（Anthropic overloaded / api_error）
      if (error.message.includes('api_error') || error.message.includes('内部错误') || error.message.includes('overloaded')) {
        return 'API 服务暂时不可用（服务端过载或内部错误），请稍后重试';
      }
      // Stream 空响应（服务端建立连接但未返回数据就断开）
      if (error.message.includes('ended without sending any chunks') || error.message.includes('stream has ended')) {
        return 'API 服务响应异常（连接已建立但未返回数据），通常是服务端临时故障，请稍后重试';
      }
      // 超时
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        return `请求超时: ${error.message}\n提示: 请检查网络连接，或在 config.json 中增大 provider.timeout 值`;
      }
      // 请求中断（SDK abort，通常由超时或网络中断触发）
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        return `请求被中断，可能由网络波动或超时导致。如频繁出现，请检查网络连接或增大 provider.timeout 值`;
      }
      return error.message;
    }
    return String(error);
  }
}
