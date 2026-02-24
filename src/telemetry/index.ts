// ============================================================
// M10 日志与遥测
// ============================================================
//
// 已迁移到 @/core/logger 模块。
// 此文件保留向后兼容的 log() 函数，内部委托给核心 Logger。
//

import { logger } from '@/core/logger';

/**
 * 简易日志（向后兼容）
 *
 * @deprecated 请直接使用 `import { logger } from '@/core/logger'`
 */
export function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  switch (level) {
    case 'debug':
      logger.debug(message, ...args);
      break;
    case 'info':
      logger.info(message, ...args);
      break;
    case 'warn':
      logger.warn(message, ...args);
      break;
    case 'error':
      logger.error(message, ...args);
      break;
  }
}
