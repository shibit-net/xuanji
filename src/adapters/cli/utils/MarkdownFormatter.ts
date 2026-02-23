// ============================================================
// Markdown 格式化工具 — 针对终端显示优化
// ============================================================

/**
 * 检测字符串是否看起来像 markdown
 */
export function isMarkdown(text: string): boolean {
  return /^#+\s|```|^\s*[-*]\s|^\s*\d+\.\s|^>\s|^\|/m.test(text);
}

/**
 * 格式化 markdown 文本以适应终端显示
 * 返回 { lines, isMarkdown } 结构供 ToolDisplay 使用
 */
export function formatMarkdown(text: string) {
  const lines = text.split('\n');
  const hasMarkdown = isMarkdown(text);

  // 处理 markdown 标记
  const formatted = lines.map((line) => {
    // 代码块标记（```）
    if (line.trim().startsWith('```')) {
      return `┌─ CODE ─┐`;
    }

    // 标题：# Level 1, ## Level 2 等
    const headingMatch = line.match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      if (level === 1) {
        return `\n═══════════════════════════`;
      } else if (level === 2) {
        return `───────────────────────────`;
      } else {
        return `  ◆ ${content}`;
      }
    }

    // 标题内容（标题行后的内容行）
    if (/^#+\s+/.test(line)) {
      return line.replace(/^#+\s+/, '  ★ ');
    }

    // 无序列表 - 或 *
    if (/^\s*[-*]\s+/.test(line)) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      const content = line.replace(/^\s*[-*]\s+/, '');
      return `${'  '.repeat(Math.floor(indent / 2))}• ${content}`;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      const numMatch = line.match(/^\s*(\d+)\.\s+/);
      const num = numMatch?.[1];
      const content = line.replace(/^\s*\d+\.\s+/, '');
      return `${'  '.repeat(Math.floor(indent / 2))}${num}. ${content}`;
    }

    // 引用块 >
    if (/^>\s+/.test(line)) {
      const content = line.replace(/^>\s+/, '');
      return `  ┃ ${content}`;
    }

    // 表格行
    if (/^\|/.test(line)) {
      return line.replace(/\|/g, '│');
    }

    // 粗体 **text** 或 __text__
    let result = line.replace(/\*\*(.+?)\*\*/g, '█ $1 █');
    result = result.replace(/__(.+?)__/g, '█ $1 █');

    // 斜体 *text* 或 _text_（但不匹配粗体）
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '▸ $1 ◂');
    result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '▸ $1 ◂');

    // 代码 `text`
    result = result.replace(/`([^`]+)`/g, '┌$1┐');

    // 链接 [text](url)
    result = result.replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');

    return result;
  });

  return {
    lines: formatted,
    isMarkdown: hasMarkdown,
  };
}

