// ============================================================
// 天工坊搜索命令
// ============================================================

import { logger } from '@/core/logger';
import type { RegistryClient } from '../RegistryClient';

const log = logger.child({ module: 'TiangongSearch' });

export async function handleSearch(registryClient: RegistryClient, args: string): Promise<string> {
  const query = args.trim();
  if (!query) {
    return '用法: /tiangong search <关键词>';
  }

  log.info(`Searching tiangong: ${query}`);
  const result = await registryClient.search(query);

  if (result.list.length === 0) {
    return `未找到与 "${query}" 相关的插件`;
  }

  const lines: string[] = [`找到 ${result.total} 个插件：\n`];
  for (const pkg of result.list) {
    const typeLabel = pkg.type === 1 ? 'MCP' : 'Skill';
    const stars = pkg.ratingAvg > 0 ? ` | ${pkg.ratingAvg.toFixed(1)}★` : '';
    const privateTag = pkg.isPrivate ? ' 🔒 需订阅' : '';
    lines.push(`  [${typeLabel}] ${pkg.name} (${pkg.packageId})${privateTag}`);
    lines.push(`    ${pkg.description ?? '无描述'}`);
    lines.push(`    下载: ${pkg.totalDownloads}${stars}`);
    if (pkg.tags.length > 0) {
      lines.push(`    标签: ${pkg.tags.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
