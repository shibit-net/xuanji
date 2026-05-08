// ============================================================
// 璇玑 (Xuanji) — 主入口
// ============================================================

import { logger } from './core/logger';

const log = logger.child({ module: 'Main' });

// 导出核心模块
export { SessionFactory } from './core/chat/SessionFactory';
export { ChatSession } from './core/chat/ChatSession';

// 导出类型
export type { SessionOptions } from './core/chat/SessionFactory';

// 启动提示
log.info('璇玑 (Xuanji) — 核心模块已加载。请通过桌面应用或 API 使用。');
