// ============================================================
// 运行时配置访问器
// ============================================================
//
// 提供全局配置访问，避免每个工具都需要注入依赖。
// 由 ChatSession.init() 在加载配置后调用 setConfig() 初始化。
//

import type { AppConfig } from '@/core/types';

let _config: AppConfig | null = null;

/**
 * 深冻结对象及其所有嵌套属性
 */
function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/**
 * 设置运行时配置（由 ChatSession.init() 调用）
 */
export function setRuntimeConfig(config: AppConfig): void {
  _config = deepFreeze(config) as AppConfig;
}

/**
 * 获取运行时配置
 */
export function getRuntimeConfig(): AppConfig | null {
  return _config;
}

/**
 * 获取工具超时配置
 */
export function getToolTimeouts() {
  return _config?.tools?.timeouts;
}

/**
 * 获取并发限制配置
 */
export function getConcurrencyConfig() {
  return _config?.tools?.concurrency;
}

/**
 * 获取输出限制配置
 */
export function getOutputLimits() {
  return _config?.tools?.outputLimits;
}

/**
 * 获取 Grep 工具配置
 */
export function getGrepConfig() {
  return _config?.tools?.grep;
}

/**
 * 获取 Glob 工具配置
 */
export function getGlobConfig() {
  return _config?.tools?.glob;
}

/**
 * 获取子代理配置
 */
export function getSubAgentConfig() {
  return _config?.agent?.subAgent;
}
