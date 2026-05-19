// ============================================================
// 运行时配置访问器
// ============================================================
//
// 提供全局配置访问，避免每个工具都需要注入依赖。
// 由 ChatSession.init() 在加载配置后调用 setRuntimeConfig() 初始化。
// 配置更新时调用 updateRuntimeConfig() 实现动态生效。
//

import type { AppConfig } from '@/core/types';

let _config: AppConfig | null = null;

/**
 * 设置运行时配置（由 SessionFactory.create() 调用）
 */
export function setRuntimeConfig(config: AppConfig): void {
  _config = config;
}

/**
 * 增量更新运行时配置（由 agent-bridge 配置更新时调用）
 * 深度合并 partial 到现有配置中
 */
export function updateRuntimeConfig(partial: Partial<AppConfig>): void {
  if (!_config) {
    _config = partial as unknown as AppConfig;
    return;
  }
  _config = deepMergeRuntime(_config as unknown as Record<string, unknown>, partial as unknown as Record<string, unknown>) as unknown as AppConfig;
}

/**
 * 浅层深度合并（仅合并一层嵌套对象）
 */
function deepMergeRuntime(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal !== null && tgtVal !== undefined && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = { ...tgtVal as Record<string, unknown>, ...srcVal as Record<string, unknown> };
    } else {
      result[key] = srcVal;
    }
  }
  return result;
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

/**
 * 获取异步 Agent 任务配置
 */
export function getAsyncAgentConfig() {
  return _config?.agent?.asyncAgentTasks;
}

/**
 * 获取 SSH 工具配置
 */
export function getSSHConfig() {
  return _config?.tools?.ssh;
}
