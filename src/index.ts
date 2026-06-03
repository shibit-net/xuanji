// ============================================================
// 璇玑 (Xuanji) — 主入口
// ============================================================

import { logger } from './infrastructure/logger';

const log = logger.child({ module: 'Main' });

// 导出 Engine 层
export { LifecycleManager, PluginRegistry, MessageRouter, DEFAULT_MANIFEST } from './engine';
export type { PluginManifestEntry, PluginEntry } from './engine';

// 导出核心模块
export { SessionFactory } from './session/SessionFactory';
export { ChatSession } from './session/ChatSession';

// 导出类型
export type { SessionOptions } from './session/SessionFactory';

// 启动提示
log.info('璇玑 (Xuanji) — 核心模块已加载。请通过桌面应用或 API 使用。');
