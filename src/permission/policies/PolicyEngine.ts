// ============================================================
// M5 权限控制 — 策略引擎
// ============================================================

import type { PermissionLevel, PermissionConfig } from '@/infrastructure/core-types';

/**
 * PolicyEngine — 策略管理
 *
 * 根据操作类别返回对应的策略级别，
 * 并管理用户自定义的黑白名单。
 */
export class PolicyEngine {
  private config: PermissionConfig;

  constructor(config: PermissionConfig) {
    this.config = config;
  }

  /**
   * 获取操作类别对应的策略级别
   */
  getLevel(category: 'fileRead' | 'fileWrite' | 'bashExec'): PermissionLevel {
    return this.config[category];
  }

  /**
   * 获取允许的路径白名单
   */
  getAllowedPaths(): string[] {
    return this.config.allowedPaths ?? [];
  }

  /**
   * 获取禁止的路径黑名单
   */
  getDeniedPaths(): string[] {
    return this.config.deniedPaths ?? [];
  }

  /**
   * 获取允许的命令白名单
   */
  getAllowedCommands(): string[] {
    return this.config.allowedCommands ?? [];
  }

  /**
   * 获取禁止的命令黑名单
   */
  getDeniedCommands(): string[] {
    return this.config.deniedCommands ?? [];
  }

  /**
   * 更新配置
   */
  updateConfig(config: PermissionConfig): void {
    this.config = config;
  }
}
