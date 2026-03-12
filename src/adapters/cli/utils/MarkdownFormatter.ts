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
  let inCodeBlock = false;

  // 处理 markdown 标记
  const formatted = lines.map((line) => {
    // 代码块标记（```）
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        const lang = line.trim().slice(3).trim();
        inCodeBlock = true;
        return `── ${lang || 'code'} ${'─'.repeat(20)}`;
      } else {
        inCodeBlock = false;
        return `${'─'.repeat(28)}`;
      }
    }

    // 代码块内容：原样保留
    if (inCodeBlock) {
      return `  ${line}`;
    }

    // 标题：# Level 1, ## Level 2 等
    const headingMatch = line.match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      if (level === 1) {
        return `\n${content}\n${'━'.repeat(Math.min(content.length * 2, 40))}`;
      } else if (level === 2) {
        return `\n▸ ${content}`;
      } else if (level === 3) {
        return `  • ${content}`;
      } else {
        return `    ▪ ${content}`;
      }
    }

    // Task List (TODO)
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      const indent = Math.floor(taskMatch[1].length / 2);
      const checked = taskMatch[2].toLowerCase() === 'x';
      const text = taskMatch[3];
      const checkbox = checked ? '✔' : '☐';
      return `${'  '.repeat(indent)}${checkbox} ${text}`;
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
    if (/^>\s*/.test(line)) {
      const content = line.replace(/^>\s*/, '');
      return `  ┃ ${content}`;
    }

    // 水平分隔线
    if (/^\s*[-*_](\s*[-*_]){2,}\s*$/.test(line) && !(/^\s*[-*]\s+/.test(line))) {
      return `${'─'.repeat(28)}`;
    }

    // 表格行
    if (/^\|/.test(line)) {
      return line.replace(/\|/g, '│');
    }

    // 行内格式处理
    let result = line;

    // 粗体 **text** 或 __text__
    result = result.replace(/\*\*(.+?)\*\*/g, '$1');
    result = result.replace(/__(.+?)__/g, '$1');

    // 斜体 *text* 或 _text_（但不匹配粗体）
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
    result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1');

    // 代码 `text`
    result = result.replace(/`([^`]+)`/g, '$1');

    // 链接 [text](url)
    result = result.replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');

    return result;
  });

  return {
    lines: formatted,
    isMarkdown: hasMarkdown,
  };
}

