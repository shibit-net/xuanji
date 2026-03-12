// ============================================================
// 天工坊已安装列表命令
// ============================================================

import type { MCPInstaller } from '../MCPInstaller';
import type { SkillInstaller } from '../SkillInstaller';
import type { InstalledPackage } from '../types';

export function handleList(mcpInstaller: MCPInstaller, skillInstaller: SkillInstaller): string {
  const mcpList = mcpInstaller.getInstalledList();
  const skillList = skillInstaller.getInstalledList();
  const allInstalled: InstalledPackage[] = [...mcpList, ...skillList];

  if (allInstalled.length === 0) {
    return '尚未安装任何天工坊插件\n使用 /tiangong search <关键词> 搜索插件';
  }

  const lines: string[] = [`已安装 ${allInstalled.length} 个插件：\n`];
  for (const pkg of allInstalled) {
    const typeLabel = pkg.type === 'mcp' ? 'MCP' : 'Skill';
    lines.push(`  [${typeLabel}] ${pkg.packageId} v${pkg.version}`);
    lines.push(`    位置: ${pkg.installPath}`);
    lines.push(`    安装时间: ${pkg.installedAt}`);
    lines.push('');
  }

  return lines.join('\n');
}
