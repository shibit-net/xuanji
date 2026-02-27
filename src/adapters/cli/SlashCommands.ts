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
