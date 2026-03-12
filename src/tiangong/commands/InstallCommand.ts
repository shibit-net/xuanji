// ============================================================
// 天工坊安装命令
// ============================================================

import { logger } from '@/core/logger';
import type { RegistryClient } from '../RegistryClient';
import type { MCPInstaller } from '../MCPInstaller';
import type { SkillInstaller } from '../SkillInstaller';

const log = logger.child({ module: 'TiangongInstall' });

export async function handleInstall(
  registryClient: RegistryClient,
  mcpInstaller: MCPInstaller,
  skillInstaller: SkillInstaller,
  args: string
): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const packageId = parts[0];
  const version = parts[1];

  if (!packageId) {
    return '用法: /tiangong install <packageId> [version]';
  }

  log.info(`Installing package: ${packageId}${version ? ` v${version}` : ''}`);

  try {
    // 先获取包详情，检查是否为私有包
    const detail = await registryClient.getDetail(packageId);

    if (detail.isPrivate) {
      // 私有包需要 apiKey
      if (!registryClient.isAuthenticated) {
        return `"${detail.name}" 是私有服务，请先设置天工坊 API Key`;
      }

      // 检查是否已订阅
      try {
        await registryClient.getSubscriptionConfig(packageId);
      } catch {
        return `"${detail.name}" 是私有服务，请先订阅: /tiangong subscribe ${packageId}`;
      }
    }

    // 获取安装配置来判断类型
    const config = await registryClient.getInstallConfig(packageId, version);

    if (config.type === 'mcp') {
      return await mcpInstaller.install(packageId, version);
    } else {
      return await skillInstaller.install(packageId, version);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Install failed: ${message}`);
    return `安装失败: ${message}`;
  }
}
