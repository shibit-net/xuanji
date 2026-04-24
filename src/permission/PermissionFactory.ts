// ============================================================
// PermissionFactory - 权限系统工厂
// ============================================================
// 负责创建和初始化权限系统的所有组件
//
// 职责:
// 1. 创建守卫、策略、缓存、审计、确认服务
// 2. 组装 PermissionController
// 3. 配置各个组件
//
// 使用方式:
//   const permission = PermissionFactory.create(config);
// ============================================================

import type { PermissionConfig } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { PermissionController } from './PermissionController';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PermissionFactory' });

/**
 * PermissionFactory - 权限系统工厂
 */
export class PermissionFactory {
  /**
   * 创建权限系统
   */
  static create(config: PermissionConfig): IPermissionController {
    log.info('Creating permission system...');

    // 创建控制器
    const controller = new PermissionController(config);

    log.info('Permission system created successfully');
    return controller;
  }

  /**
   * 创建测试用的权限系统（全部允许）
   */
  static createForTest(): IPermissionController {
    log.debug('Creating permissive system for testing');

    const config: PermissionConfig = {
      fileWrite: 'always',
      fileRead: 'always',
      bashExec: 'always'
    };

    return this.create(config);
  }
}
