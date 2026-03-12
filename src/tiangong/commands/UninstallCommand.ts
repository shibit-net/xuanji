// ============================================================
// 天工坊卸载命令
// ============================================================

import { logger } from '@/core/logger';
import type { MCPInstaller } from '../MCPInstaller';
import type { SkillInstaller } from '../SkillInstaller';

const log = logger.child({ module: 'TiangongUninstall' });

export function handleUninstall(
  mcpInstaller: MCPInstaller,
  skillInstaller: SkillInstaller,
  args: string
): string {
  const packageId = args.trim();
  if (!packageId) {
    return '用法: /tiangong uninstall <packageId>';
  }

  log.info(`Uninstalling package: ${packageId}`);

  // 先尝试 MCP 卸载
  const mcpList = mcpInstaller.getInstalledList();
  if (mcpList.some(p => p.packageId === packageId)) {
    return mcpInstaller.uninstall(packageId);
  }

  // 再尝试 Skill 卸载
  const skillList = skillInstaller.getInstalledList();
  if (skillList.some(p => p.packageId === packageId)) {
    return skillInstaller.uninstall(packageId);
  }

  return `"${packageId}" 未通过天工坊安装`;
}
