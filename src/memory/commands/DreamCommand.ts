// ============================================================
// Dream 命令 — 做梦机制（记忆整理）
// ============================================================
// 用法：
// /dream - 立即执行做梦
// /dream status - 查看做梦状态
// /dream dry-run - 试运行（不实际修改）
// ============================================================

import type { DreamScheduler } from '@/memory/DreamScheduler';
import type { DreamProgress } from '@/memory/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DreamCommand' });

/**
 * 处理 /dream 命令
 */
export async function handleDream(
  dreamScheduler: DreamScheduler,
  args: string[]
): Promise<string> {
  const subcommand = args[0]?.toLowerCase();

  try {
    switch (subcommand) {
      case 'status':
        return await handleStatus(dreamScheduler);

      case 'dry-run':
        return await handleDryRun(dreamScheduler);

      case undefined:
      case 'run':
        return await handleRun(dreamScheduler);

      default:
        return getUsage();
    }
  } catch (err) {
    log.error('Dream 命令执行失败', err);
    return `❌ 执行失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * 执行做梦
 */
async function handleRun(dreamScheduler: DreamScheduler): Promise<string> {
  if (dreamScheduler.running) {
    return '⏳ 做梦正在进行中，请稍候...';
  }

  const parts: string[] = ['🌙 开始做梦（记忆整理）...\n'];

  // 进度回调
  let lastProgress: DreamProgress | null = null;
  const onProgress = (progress: DreamProgress) => {
    lastProgress = progress;
  };

  const result = await dreamScheduler.executeDream({ onProgress });

  if (!result) {
    return '❌ 做梦失败，请查看日志';
  }

  parts.push('## 📊 做梦报告\n');
  parts.push(`- ✨ 提炼相似记忆: ${result.distilled} 条`);
  parts.push(`- 📦 压缩冗长记忆: ${result.compressed} 条`);
  parts.push(`- 🔄 去重重复记忆: ${result.deduplicated} 条`);
  parts.push(`- 🗑️  淘汰低价值记忆: ${result.pruned} 条`);
  parts.push(`- 📈 更新记忆评分: ${result.scored} 条`);
  parts.push(`\n⏱️  总耗时: ${(result.duration / 1000).toFixed(2)}s`);

  if (lastProgress) {
    parts.push(`\n📦 处理批次: ${lastProgress.currentBatch}/${lastProgress.totalBatches}`);
    parts.push(`📝 处理记忆: ${lastProgress.processedCount}/${lastProgress.totalCount}`);
  }

  parts.push('\n✅ 做梦完成！记忆库已优化。');

  return parts.join('\n');
}

/**
 * 试运行（不实际修改）
 */
async function handleDryRun(dreamScheduler: DreamScheduler): Promise<string> {
  if (dreamScheduler.running) {
    return '⏳ 做梦正在进行中，请稍候...';
  }

  const parts: string[] = ['🌙 开始做梦试运行（不会实际修改记忆）...\n'];

  const result = await dreamScheduler.executeDream({ dryRun: true });

  if (!result) {
    return '❌ 做梦试运行失败，请查看日志';
  }

  parts.push('## 📊 试运行报告\n');
  parts.push(`- ✨ 将提炼: ${result.distilled} 条`);
  parts.push(`- 📦 将压缩: ${result.compressed} 条`);
  parts.push(`- 🔄 将去重: ${result.deduplicated} 条`);
  parts.push(`- 🗑️  将淘汰: ${result.pruned} 条`);
  parts.push(`- 📈 将更新: ${result.scored} 条`);
  parts.push(`\n⏱️  预计耗时: ${(result.duration / 1000).toFixed(2)}s`);

  parts.push('\n💡 这只是试运行，没有实际修改记忆。');
  parts.push('使用 `/dream` 执行实际整理。');

  return parts.join('\n');
}

/**
 * 查看做梦状态
 */
async function handleStatus(dreamScheduler: DreamScheduler): Promise<string> {
  const parts: string[] = ['## 🌙 做梦状态\n'];

  if (dreamScheduler.running) {
    parts.push('**状态**: ⏳ 正在运行');
  } else {
    parts.push('**状态**: ✅ 空闲');
  }

  const { should, reason } = await dreamScheduler.shouldDream();

  if (should) {
    parts.push(`\n💡 建议立即做梦（原因: ${reason}）`);
    parts.push('使用 `/dream` 执行整理');
  } else {
    parts.push('\n✅ 当前不需要做梦');
  }

  parts.push('\n---');
  parts.push('💡 做梦会自动在后台运行，无需手动触发');
  parts.push('💡 触发条件：24小时未做梦、新增50+记忆、用户空闲30分钟');

  return parts.join('\n');
}

/**
 * 获取使用说明
 */
function getUsage(): string {
  return `## 🌙 Dream 命令使用说明

**立即执行做梦**:
\`\`\`
/dream
\`\`\`

**查看做梦状态**:
\`\`\`
/dream status
\`\`\`

**试运行（不实际修改）**:
\`\`\`
/dream dry-run
\`\`\`

---

## 🤔 什么是做梦？

做梦是记忆系统的自动整理机制，会在后台执行以下任务：

1. **✨ 提炼相似记忆** - 合并内容相似的多条记忆
2. **📦 压缩冗长记忆** - 精简过长的记忆内容
3. **🔄 去重重复记忆** - 删除完全重复的记忆
4. **🗑️  淘汰低价值记忆** - 删除过时、无效的记忆
5. **📈 更新记忆评分** - 根据使用情况调整评分

## ⚙️ 自动触发条件

- 24小时未做梦
- 新增记忆超过50条
- 用户空闲超过30分钟

💡 通常无需手动触发，系统会自动在合适的时机执行。`;
}
