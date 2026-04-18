// ============================================================
// Tiangong 工具 — 格式化函数
// ============================================================

import { getStatusIcon as getUIStatusIcon, getSubscriptionStatusIcon as getUISubscriptionStatusIcon } from '@/shared/utils/ui';

/** 获取包状态图标（复用公共函数） */
export function getStatusIcon(status: number): string {
  return getUIStatusIcon(status);
}

/** 格式化包类型 */
export function formatPackageType(type: number): string {
  switch (type) {
    case 1: return 'MCP Server';
    case 2: return 'Skill';
    default: return 'Unknown';
  }
}

/** 格式化作者信息 */
export function formatAuthor(author: { name?: string; avatar?: string; url?: string }): string {
  if (!author.name) return 'Unknown';
  return author.name;
}

/** 格式化版本信息 */
export function formatVersion(version: string): string {
  return version || 'latest';
}

/** 格式化下载量 */
export function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

/** 获取订阅状态图标（复用公共函数） */
export function getSubscriptionStatusIcon(status: number): string {
  return getUISubscriptionStatusIcon(status);
}
