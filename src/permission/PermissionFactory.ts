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
import { PermissionControllerRefactored } from './PermissionController.refactored';
import { FileGuard } from './guards/FileGuard';
import { CommandGuard } from './guards/CommandGuard';
import { PolicyEngine } from './policies/PolicyEngine';
import { PermissionCache } from './cache/PermissionCache';
import { PermissionAudit } from './audit/PermissionAudit';
import { ConfirmationService } from './confirmation/ConfirmationService';
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

    // 1. 创建守卫
    const guards = [
      new FileGuard(),
      new CommandGuard()
    ];

    // 2. 创建策略引擎
    const policy = new PolicyEngine(config);

    // 3. 创建缓存
    const cache = new PermissionCache(500);

    // 4. 创建审计
    const audit = new PermissionAudit(1000);

    // 5. 创建确认服务
    const confirmation = new ConfirmationService();

    // 6. 组装控制器
    const controller = new PermissionControllerRefactored(
      guards,
      policy,
      cache,
      audit,
      confirmation
    );

    log.info('Permission system created successfully');
    return controller;
  }

  /**
   * 创建测试用的权限系统（全部允许）
   */
  static createForTest(): IPermissionController {
    log.debug('Creating permissive system for testing');

    const config: PermissionConfig = {
      mode: 'auto',
      allow: ['**/*'],
      deny: []
    };

    return this.create(config);
  }
}
