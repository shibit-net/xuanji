// ============================================================
// 媒体生成适配器 — 工厂
// ============================================================

import type { PlatformAdapter } from './PlatformAdapter';
import { ArkAdapter } from './ArkAdapter';
import { BailianAdapter } from './BailianAdapter';

/** 已注册的平台适配器 */
const adapters: Record<string, PlatformAdapter> = {
  ark: new ArkAdapter(),
  bailian: new BailianAdapter(),
};

/**
 * 根据 provider 获取对应的平台适配器
 * @throws 未知平台时抛出错误，并列出支持的平台
 */
export function getAdapter(provider: string): PlatformAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(
      `未知平台: ${provider}。目前支持: ${Object.keys(adapters).join(', ')}`,
    );
  }
  return adapter;
}
