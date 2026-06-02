// ============================================================
// 媒体生成工具 — 配置管理（单例）
// ============================================================

import type { ToolMediaGenConfig } from '@/shared/types/config';
import { getModelProvidersConfig } from '@/core/config/RuntimeConfig';

/**
 * 工具配置管理器
 *
 * 单例模式。配置来源分两级：
 * 1. RuntimeConfig.modelProviders.media — 用户级持久配置（设置页修改）
 * 2. Agent YAML tools[].config — Agent 级后备配置（不会覆盖用户配置）
 *
 * 工具执行时按需读取。配置加载与 API 调用完全分离。
 */
export class ToolConfigManager {
  private static instance: ToolConfigManager;
  private configs = new Map<string, ToolMediaGenConfig>();

  // eslint-disable-next-line no-useless-constructor, @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): ToolConfigManager {
    if (!ToolConfigManager.instance) {
      ToolConfigManager.instance = new ToolConfigManager();
    }
    return ToolConfigManager.instance;
  }

  /**
   * 从 RuntimeConfig.modelProviders.media 加载用户级持久配置
   * 应在 loadFromAgentConfig() 之前调用，以保证用户配置优先
   */
  loadFromModelProviders(): void {
    const mpConfig = getModelProvidersConfig();
    if (mpConfig?.media) {
      for (const [toolName, cfg] of Object.entries(mpConfig.media)) {
        this.configs.set(toolName, cfg as ToolMediaGenConfig);
      }
    }
  }

  /**
   * 从 Agent YAML tools 列表加载后备配置（merge 模式）
   * 不会清除已有配置，不会覆盖已存在的 key
   */
  loadFromAgentConfig(tools: Array<{ name: string; config?: Record<string, unknown> }>): void {
    for (const t of tools) {
      if (t.config && typeof t.config === 'object' && !this.configs.has(t.name)) {
        this.configs.set(t.name, t.config as unknown as ToolMediaGenConfig);
      }
    }
  }

  /**
   * 获取指定工具的配置
   * @returns 配置对象，未配置时返回 undefined
   */
  getConfig(toolName: string): ToolMediaGenConfig | undefined {
    return this.configs.get(toolName);
  }

  /**
   * 检查工具是否已配置
   */
  hasConfig(toolName: string): boolean {
    return this.configs.has(toolName);
  }
}
