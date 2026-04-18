// ============================================================
// ConfigFactory - 配置服务工厂
// ============================================================

import { ConfigService } from './ConfigService';
import {
  DefaultConfigSource,
  GlobalConfigSource,
  ProjectConfigSource,
  EnvConfigSource,
  RuntimeConfigSource,
  MemoryConfigSource
} from './ConfigSources';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfigFactory' });

/**
 * ConfigFactory - 配置服务工厂
 */
export class ConfigFactory {
  /**
   * 创建配置服务
   */
  static async create(): Promise<ConfigService> {
    log.info('Creating config service...');

    const sources = [
      new DefaultConfigSource(),
      new GlobalConfigSource(),
      new ProjectConfigSource(),
      new EnvConfigSource(),
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
}
