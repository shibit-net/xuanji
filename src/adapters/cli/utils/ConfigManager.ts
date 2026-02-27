// ============================================================
// M1 终端 UI — 配置管理工具
// ============================================================

import { t } from '@/core/i18n';
import type { AppConfig } from '@/core/types';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { loadGlobalConfig, saveGlobalConfig, deepMergeConfig, setByPath, GLOBAL_CONFIG_DIR } from '@/core/config/GlobalConfig';

/**
 * CLI 模式的配置管理器
 * 包装 ConfigLoader，提供读写配置的便利接口
 */
export class ConfigManager {
  private loader: ConfigLoader;
  private currentConfig: AppConfig | null = null;

  constructor() {
    this.loader = new ConfigLoader();
  }

  /**
   * 加载配置（第一次调用需要等待）
   */
  async load(): Promise<AppConfig> {
    const config = await this.loader.load();
    this.currentConfig = config;
    return config;
  }

  /**
   * 获取当前配置（必须先调用 load）
   */
  getConfig(): AppConfig {
    if (!this.currentConfig) {
      throw new Error(t('cli.config_not_init'));
    }
    return this.currentConfig;
  }

  /**
   * 设置单个配置值（内存）
   * @param key 点号路径，e.g. "provider.model"
   * @param value 值
   */
  set(key: string, value: unknown): void {
    this.loader.set(key, value);
    if (this.currentConfig) {
      // 更新内存中的配置
      setByPath(this.currentConfig as unknown as Record<string, unknown>, key, value);
    }
  }

  /**
   * 获取单个配置值
   */
  get<T = unknown>(key: string): T | undefined {
    return this.loader.get<T>(key);
  }

  /**
   * 保存配置到文件（全局配置 ~/.xuanji/config.json）
   * 支持深合并，部分更新不会覆盖其他字段
   */
  async save(partialConfig?: Partial<AppConfig>): Promise<void> {
    if (!this.currentConfig) {
      throw new Error(t('cli.config_not_init_short'));
    }

    // 读取当前全局配置
    const globalConfig = (await loadGlobalConfig()) as Record<string, unknown>;

    // 深合并：新配置覆盖旧配置
    const merged = partialConfig
      ? deepMergeConfig(globalConfig, partialConfig as unknown as Record<string, unknown>)
      : (this.currentConfig as unknown as Record<string, unknown>);

    // 保存到文件
    await saveGlobalConfig(merged);

    // 更新内存中的当前配置
    this.currentConfig = {
      ...this.currentConfig,
      ...partialConfig,
    };
  }

  /**
   * 校验配置完整性
   */
  validate(): boolean {
    return this.loader.validate();
  }

  /**
   * 获取配置目录（~/.xuanji）
   */
  getConfigDir(): string {
    return GLOBAL_CONFIG_DIR;
  }

  /**
   * 重置为默认配置
   */
  async reset(): Promise<void> {
    const { DEFAULT_CONFIG } = await import('@/core/config/defaults');
    await saveGlobalConfig(DEFAULT_CONFIG as unknown as Record<string, unknown>);
    // 重新加载
    await this.load();
  }
}
