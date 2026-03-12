// ============================================================
// 天工坊订阅列表命令
// ============================================================

import { logger } from '@/core/logger';
import type { RegistryClient } from '../RegistryClient';

const log = logger.child({ module: 'TiangongSubscriptions' });

export async function handleSubscriptions(
  registryClient: RegistryClient,
  args: string
): Promise<string> {
  // 校验用户已登录
  if (!registryClient.isAuthenticated) {
    return '请先设置天工坊 API Key 后再查看订阅';
  }

  log.info('Fetching subscriptions');

  try {
    const subscriptions = await registryClient.getMySubscriptions();

    if (subscriptions.length === 0) {
      return '尚未订阅任何服务\n使用 /tiangong search <关键词> 搜索可订阅的服务';
    }

    const statusLabels: Record<number, string> = {
      1: '生效中',
      2: '已暂停',
      3: '已取消',
    };

    const lines: string[] = [`共 ${subscriptions.length} 个订阅：\n`];
    for (const sub of subscriptions) {
      const statusLabel = statusLabels[sub.status] ?? `未知(${sub.status})`;
      lines.push(`  ${sub.packageName} (${sub.packageId})`);
      lines.push(`    状态: ${statusLabel}`);

      // 显示脱敏配置
      const configKeys = Object.keys(sub.configs);
      if (configKeys.length > 0) {
        const configPairs = configKeys.map(k => `${k}=${sub.configs[k]}`);
        lines.push(`    配置: ${configPairs.join(', ')}`);
      }

      if (sub.expiresAt) {
        lines.push(`    到期时间: ${sub.expiresAt}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Fetch subscriptions failed: ${message}`);
    return `查询订阅失败: ${message}`;
  }
}
