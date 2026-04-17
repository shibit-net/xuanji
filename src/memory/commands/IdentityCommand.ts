// ============================================================
// Identity 命令 — 身份记忆管理
// ============================================================
// 用法：
// /identity - 查看当前身份设定
// /identity set-title <称呼> - 设置用户称呼
// /identity set-name <名字> - 设置助手名字
// /identity clear - 清除身份设定
// ============================================================

import type { IdentityManager } from '@/memory/IdentityManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IdentityCommand' });

/**
 * 处理 /identity 命令
 */
export async function handleIdentity(
  identityManager: IdentityManager,
  args: string[]
): Promise<string> {
  const subcommand = args[0]?.toLowerCase();

  try {
    switch (subcommand) {
      case 'set-title':
        return await handleSetTitle(identityManager, args.slice(1));

      case 'set-name':
        return await handleSetName(identityManager, args.slice(1));

      case 'clear':
        return await handleClear(identityManager);

      case undefined:
      case 'show':
        return await handleShow(identityManager);

      default:
        return getUsage();
    }
  } catch (err) {
    log.error('Identity 命令执行失败', err);
    return `❌ 执行失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * 显示当前身份设定
 */
async function handleShow(identityManager: IdentityManager): Promise<string> {
  const identity = await identityManager.getIdentity();

  const parts: string[] = ['## 🎭 当前身份设定\n'];

  if (identity.assistantName) {
    parts.push(`**助手名字**: ${identity.assistantName}`);
  } else {
    parts.push('**助手名字**: 未设置');
  }

  if (identity.userTitle) {
    parts.push(`**用户称呼**: ${identity.userTitle}`);
  } else {
    parts.push('**用户称呼**: 未设置');
  }

  if (identity.persona) {
    parts.push(`\n**人格设定**:\n${identity.persona}`);
  }

  if (identity.tone) {
    parts.push(`\n**语气风格**:\n${identity.tone}`);
  }

  if (!identity.assistantName && !identity.userTitle && !identity.persona && !identity.tone) {
    parts.push('\n_尚未设置任何身份信息_');
  }

  parts.push('\n---');
  parts.push('💡 使用 `/identity set-title <称呼>` 设置用户称呼');
  parts.push('💡 使用 `/identity set-name <名字>` 设置助手名字');

  return parts.join('\n');
}

/**
 * 设置用户称呼
 */
async function handleSetTitle(
  identityManager: IdentityManager,
  args: string[]
): Promise<string> {
  if (args.length === 0) {
    return '❌ 请提供称呼\n用法: /identity set-title <称呼>';
  }

  const title = args.join(' ').trim();

  if (title.length === 0) {
    return '❌ 称呼不能为空';
  }

  await identityManager.setUserTitle(title);

  return `✅ 已设置用户称呼为"${title}"\n\n从下次对话开始，我会称呼您为"${title}"。`;
}

/**
 * 设置助手名字
 */
async function handleSetName(
  identityManager: IdentityManager,
  args: string[]
): Promise<string> {
  if (args.length === 0) {
    return '❌ 请提供名字\n用法: /identity set-name <名字>';
  }

  const name = args.join(' ').trim();

  if (name.length === 0) {
    return '❌ 名字不能为空';
  }

  await identityManager.setAssistantName(name);

  return `✅ 已设置助手名字为"${name}"\n\n从现在开始，我的名字是"${name}"。您可以直接叫我的名字。`;
}

/**
 * 清除身份设定
 */
async function handleClear(identityManager: IdentityManager): Promise<string> {
  identityManager.clearCache();

  return `✅ 已清除身份设定缓存

⚠️ 注意：这只是清除了缓存，历史记忆仍然保留。
如需完全删除身份记忆，请使用记忆管理工具手动删除相关记忆。`;
}

/**
 * 获取使用说明
 */
function getUsage(): string {
  return `## 🎭 Identity 命令使用说明

**查看当前设定**:
\`\`\`
/identity
\`\`\`

**设置用户称呼**:
\`\`\`
/identity set-title <称呼>
\`\`\`
示例: \`/identity set-title 先生\`

**设置助手名字**:
\`\`\`
/identity set-name <名字>
\`\`\`
示例: \`/identity set-name 贾维斯\`

**清除缓存**:
\`\`\`
/identity clear
\`\`\`

---

💡 身份设定会持久化保存，每次对话自动生效。`;
}
