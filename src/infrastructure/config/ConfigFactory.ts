// ============================================================
// ConfigFactory - 配置服务工厂（简化版）
// ============================================================

import { ConfigService } from './ConfigService';
import {
  DefaultConfigSource,
  UserConfigSource,
  RuntimeConfigSource,
  MemoryConfigSource
} from './ConfigSources';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfigFactory' });

/**
 * ConfigFactory - 创建配置服务
 */
export class ConfigFactory {
  private static userConfigSource: UserConfigSource | null = null;

  /**
   * 创建配置服务
   */
  static async create(userId: string = 'default'): Promise<ConfigService> {
    log.info(`Creating config service for user: ${userId}`);

    const userConfigSource = new UserConfigSource(userId);
    ConfigFactory.userConfigSource = userConfigSource;

    const sources = [
      new DefaultConfigSource(),
      userConfigSource,
      new RuntimeConfigSource()
    ];

    const service = new ConfigService(sources);
    await service.load();

    log.info('Config service created successfully');
    return service;
  }

  /**
   * 创建测试用的配置服务
   */
  static async createForTest(overrides: Record<string, any> = {}): Promise<ConfigService> {
    log.debug('Creating config service for testing');

    const sources = [
      new DefaultConfigSource(),
      new MemoryConfigSource(overrides)
    ];

    const service = new ConfigService(sources);
    await service.load();

    return service;
  }

  /**
   * 获取当前用户配置源（用于切换用户）
   */
  static getUserConfigSource(): UserConfigSource | null {
    return ConfigFactory.userConfigSource;
  }
}
