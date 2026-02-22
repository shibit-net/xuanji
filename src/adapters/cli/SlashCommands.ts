// ============================================================
// M1 终端 UI — 斜杠命令处理
// ============================================================

/**
 * 斜杠命令定义
 */
export interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string) => void | Promise<void>;
}

/**
 * 内置斜杠命令
 */
export function createBuiltinCommands(callbacks: {
  onClear: () => void;
  onExit: () => void;
  onHelp: () => void;
  onReset: () => void;
  onCost: () => void;
}): SlashCommand[] {
  return [
    {
      name: '/help',
      description: '显示帮助信息',
      handler: callbacks.onHelp,
    },
    {
      name: '/clear',
      description: '清空对话历史',
      handler: callbacks.onClear,
    },
    {
      name: '/reset',
      description: '重置会话 (清空历史和 token 计数)',
      handler: callbacks.onReset,
    },
    {
      name: '/cost',
      description: '显示当前会话费用',
      handler: callbacks.onCost,
    },
    {
      name: '/exit',
      description: '退出璇玑',
      handler: callbacks.onExit,
    },
  ];
}

/**
 * 解析斜杠命令
 */
export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { name: trimmed, args: '' };
  }
  return {
    name: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}
