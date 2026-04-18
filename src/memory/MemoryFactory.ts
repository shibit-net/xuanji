// ============================================================
// MemoryFactory - 记忆系统工厂
// ============================================================
// 负责创建和初始化记忆系统的所有组件
//
// 职责:
// 1. 创建存储、检索、提取、维护服务
// 2. 组装 MemoryCoordinator
// 3. 初始化所有组件
//
// 使用方式:
//   const memory = await MemoryFactory.create(config, projectRoot);
// ============================================================

import type { MemoryConfig, IMemoryStore } from '@/memory/types';
import { DEFAULT_MEMORY_CONFIG } from '@/memory/types';
import { MemoryStorage } from './storage/MemoryStorage';
import { MemoryRetrieval } from './retrieval/MemoryRetrieval';
import { MemoryExtraction } from './extraction/MemoryExtraction';
import { MemoryMaintenance } from './maintenance/MemoryMaintenance';
import { MemoryCoordinator } from './MemoryCoordinator';
import { VectorManager } from './VectorManager';
import { logger } from '@/core/logger';
import { resolve } from 'node:path';

const log = logger.child({ module: 'MemoryFactory' });

/**
 * MemoryFactory - 记忆系统工厂
 */
export class MemoryFactory {
  /**
   * 创建记忆系统
   */
  static async create(
    config?: Partial<MemoryConfig>,
    projectRoot?: string
  ): Promise<IMemoryStore> {
    log.info('Creating memory system...');

    const fullConfig = { ...DEFAULT_MEMORY_CONFIG, ...config };
    const resolvedRoot = projectRoot ? resolve(projectRoot) : undefined;

    // 1. 创建存储层
    const storage = new MemoryStorage(fullConfig.dbPath);
    await storage.init();

    // 2. 创建向量管理器
    const vectorManager = new VectorManager(storage.getStore());

    // 3. 创建检索层
    const retrieval = new MemoryRetrieval(
      storage,
      vectorManager,
      fullConfig.decayHalfLifeDays
    );

    // 4. 创建提取层
    const extraction = new MemoryExtraction(fullConfig, resolvedRoot);

    // 5. 创建维护层
    const maintenance = new MemoryMaintenance(storage, resolvedRoot);

    // 6. 组装协调器
    const coordinator = new MemoryCoordinator(
      storage,
      retrieval,
      extraction,
      maintenance
    );

    // 7. 启动定时维护（如果配置了）
    if (fullConfig.enableMaintenance) {
      maintenance.scheduleMaintenance({
        compactInterval: fullConfig.compactInterval,
        archiveInterval: fullConfig.archiveInterval,
        vacuumInterval: fullConfig.vacuumInterval
      });
    }

    log.info('Memory system created successfully');
    return coordinator;
  }

  /**
   * 创建测试用的内存记忆系统
   */
  static async createForTest(): Promise<IMemoryStore> {
    log.debug('Creating in-memory system for testing');

    // 使用内存数据库
    const config: Partial<MemoryConfig> = {
      dbPath: ':memory:',
      enableMaintenance: false
    };

    return await this.create(config);
  }
}
