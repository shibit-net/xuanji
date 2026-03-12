// ============================================================
// 天工坊订阅命令
// ============================================================

import { logger } from '@/core/logger';
import type { RegistryClient } from '../RegistryClient';

const log = logger.child({ module: 'TiangongSubscribe' });

export async function handleSubscribe(
  registryClient: RegistryClient,
  args: string
): Promise<string> {
  const tokens = args.trim().split(/\s+/);
  const packageId = tokens[0];

  if (!packageId) {
    return '用法: /tiangong subscribe <packageId> [--key=value ...]';
  }

  // 校验用户已登录
  if (!registryClient.isAuthenticated) {
    return '请先设置天工坊 API Key 后再订阅服务';
  }

  log.info(`Subscribing to package: ${packageId}`);

  try {
    // 查询包信息，验证是否需要订阅
    const detail = await registryClient.getDetail(packageId);
    if (!detail.requiresSubscription) {
      return `"${detail.name}" 无需订阅，可直接安装: /tiangong install ${packageId}`;
    }

    // 解析 --key=value 格式的配置参数
    const configs: Record<string, string> = {};
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      const match = token.match(/^--([^=]+)=(.+)$/);
      if (match) {
        configs[match[1]] = match[2];
      } else {
        log.warn(`忽略无效参数: ${token}`);
      }
    }

    await registryClient.subscribe(packageId, configs);
    log.info(`Successfully subscribed to: ${packageId}`);

    const lines: string[] = [
      `已成功订阅 "${detail.name}" (${packageId})`,
    ];
    if (Object.keys(configs).length > 0) {
      lines.push(`配置项: ${Object.keys(configs).join(', ')}`);
    }
    lines.push(`\n可使用 /tiangong install ${packageId} 安装该服务`);

    return lines.join('\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Subscribe failed: ${message}`);
    return `订阅失败: ${message}`;
  }
}
