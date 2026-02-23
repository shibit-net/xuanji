// ============================================================
// M1 终端 UI — 斜杠命令处理
// ============================================================

import { t } from '@/core/i18n';

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
      description: t('cmd.help_desc'),
      handler: callbacks.onHelp,
    },
    {
      name: '/clear',
      description: t('cmd.clear_desc'),
      handler: callbacks.onClear,
    },
    {
      name: '/reset',
      description: t('cmd.reset_desc'),
      handler: callbacks.onReset,
    },
    {
      name: '/cost',
      description: t('cmd.cost_desc'),
      handler: callbacks.onCost,
    },
    {
      name: '/exit',
      description: t('cmd.exit_desc'),
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
