// ============================================================
// Markdown 渲染器 — 针对终端显示优化
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Markdown 渲染器
 * 将 markdown 文本渲染为带格式的终端输出
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeBlockLang = '';

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        // 代码块开始/结束
        if (line.trim().startsWith('```')) {
          if (!inCodeBlock) {
            codeBlockLang = line.trim().slice(3);
            inCodeBlock = true;
            return (
              <Box key={index} marginTop={index > 0 ? 1 : 0}>
                <Text color="gray" dimColor>
                  ┌─ {codeBlockLang || 'code'} ─────
                </Text>
              </Box>
            );
          } else {
            inCodeBlock = false;
            return (
              <Box key={index}>
                <Text color="gray" dimColor>
                  └──────────
                </Text>
              </Box>
            );
          }
        }

        // 代码块内容
        if (inCodeBlock) {
          return (
            <Box key={index} marginLeft={1}>
              <Text color="cyan">{line}</Text>
            </Box>
          );
        }

        // 一级标题 #
        const h1Match = line.match(/^#\s+(.+)$/);
        if (h1Match) {
          return (
            <Box key={index} flexDirection="column" marginTop={index > 0 ? 1 : 0} marginBottom={1}>
              <Text bold color="magenta">
                {h1Match[1]}
              </Text>
              <Text color="gray" dimColor>
                ─────────────────────────
              </Text>
            </Box>
          );
        }

        // 二级标题 ##
        const h2Match = line.match(/^##\s+(.+)$/);
        if (h2Match) {
          return (
            <Box key={index} marginTop={index > 0 ? 1 : 0}>
              <Text bold color="blue">
                ▸ {h2Match[1]}
              </Text>
            </Box>
          );
        }

        // 三级标题 ###
        const h3Match = line.match(/^###\s+(.+)$/);
        if (h3Match) {
          return (
            <Box key={index} marginTop={index > 0 ? 1 : 0}>
              <Text bold color="cyan">
                • {h3Match[1]}
              </Text>
            </Box>
          );
        }

        // 无序列表 - 或 *
        const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
        if (ulMatch) {
          const indent = ulMatch[1].length;
          const content = ulMatch[2];
          return (
            <Box key={index} marginLeft={Math.floor(indent / 2)}>
              <Text color="yellow">• </Text>
              <Text>{processInlineMarkdown(content)}</Text>
            </Box>
          );
        }

        // 有序列表 1.
        const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
        if (olMatch) {
          const indent = olMatch[1].length;
          const num = olMatch[2];
          const content = olMatch[3];
          return (
            <Box key={index} marginLeft={Math.floor(indent / 2)}>
              <Text color="yellow">{num}. </Text>
              <Text>{processInlineMarkdown(content)}</Text>
            </Box>
          );
        }

        // 引用块 >
        const quoteMatch = line.match(/^>\s+(.+)$/);
        if (quoteMatch) {
          return (
            <Box key={index}>
              <Text color="gray">│ </Text>
              <Text italic color="gray">
                {processInlineMarkdown(quoteMatch[1])}
              </Text>
            </Box>
          );
        }

        // 表格行 |
        if (line.trim().startsWith('|')) {
          // 分隔符行
          if (/^\|[\s-:|]+\|$/.test(line.trim())) {
            return (
              <Box key={index}>
                <Text color="gray" dimColor>
                  {line.replace(/\|/g, '┼').replace(/-/g, '─')}
                </Text>
              </Box>
            );
          }
          // 内容行
          return (
            <Box key={index}>
              <Text>{line.replace(/\|/g, ' │ ')}</Text>
            </Box>
          );
        }

        // 空行
        if (line.trim() === '') {
          return <Box key={index} height={1} />;
        }

        // 普通段落
        return (
          <Box key={index}>
            <Text>{processInlineMarkdown(line)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * 处理行内 markdown 语法
 */
function processInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let partKey = 0;

  // 匹配模式：粗体、斜体、代码、链接
  const patterns = [
    // 粗体 **text** 或 __text__
    { regex: /\*\*(.+?)\*\*/g, render: (match: string) => <Text key={partKey++} bold>{match}</Text> },
    { regex: /__(.+?)__/g, render: (match: string) => <Text key={partKey++} bold>{match}</Text> },
    // 代码 `text`
    { regex: /`([^`]+)`/g, render: (match: string) => <Text key={partKey++} backgroundColor="gray" color="black"> {match} </Text> },
    // 链接 [text](url)
    { regex: /\[(.+?)\]\((.+?)\)/g, render: (match: string, text: string, url: string) => (
      <Text key={partKey++} color="blue" underline>{text}</Text>
    )},
  ];

  // 简化版：使用正则逐个处理
  let processedText = text;

  // 粗体
  processedText = processedText.replace(/\*\*(.+?)\*\*/g, '\x1b[1m$1\x1b[22m');
  processedText = processedText.replace(/__(.+?)__/g, '\x1b[1m$1\x1b[22m');

  // 代码（使用不同颜色）
  processedText = processedText.replace(/`([^`]+)`/g, '\x1b[36m$1\x1b[39m');

  // 链接（只保留文本，显示为蓝色）
  processedText = processedText.replace(/\[(.+?)\]\((.+?)\)/g, '\x1b[34m$1\x1b[39m');

  return [processedText];
}

/**
 * 简化版：直接返回带 ANSI 颜色的文本
 */
export function renderMarkdownSimple(content: string): string[] {
  // 安全检查
  if (!content || typeof content !== 'string') {
    return [''];
  }

  // ANSI 颜色快捷引用
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const ITALIC = '\x1b[3m';
  const MAGENTA = '\x1b[35m';
  const BLUE = '\x1b[34m';
  const CYAN = '\x1b[36m';
  const YELLOW = '\x1b[33m';
  const GRAY = '\x1b[90m';
  const GREEN = '\x1b[32m';
  const WHITE = '\x1b[37m';

  // 代码块边框宽度
  const BORDER_WIDTH = 40;

  const lines = content.split('\n');
  let inCodeBlock = false;
  const result: string[] = [];
  let lastLineWasBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || ''; // 确保 line 不是 undefined

    // ── 代码块 ──────────────────────────────────
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        const lang = line.trim().slice(3).trim();
        const label = lang || 'code';
        // ┌─ lang ───────────────────────┐
        const inner = `─ ${label} `;
        const pad = Math.max(0, BORDER_WIDTH - 2 - inner.length);
        result.push('');
        result.push(`${DIM}${GRAY}┌${inner}${'─'.repeat(pad)}┐${RESET}`);
        inCodeBlock = true;
      } else {
        // └──────────────────────────────┘
        result.push(`${DIM}${GRAY}└${'─'.repeat(BORDER_WIDTH - 2)}┘${RESET}`);
        inCodeBlock = false;
      }
      lastLineWasBlank = false;
      continue;
    }

    if (inCodeBlock) {
      // 代码行：│ 前缀 + 缩进内容
      result.push(`${DIM}${GRAY}│${RESET} ${CYAN}${line}${RESET}`);
      lastLineWasBlank = false;
      continue;
    }

    // ── 水平分隔线 ─────────────────────────────
    if (/^\s*([-*_])\1{2,}\s*$/.test(line.replace(/\s/g, '')) || /^\s*[-*_](\s*[-*_]){2,}\s*$/.test(line)) {
      result.push('');
      result.push(`${DIM}${GRAY}${'─'.repeat(BORDER_WIDTH)}${RESET}`);
      result.push('');
      lastLineWasBlank = true;
      continue;
    }

    // ── 一级标题 # ──────────────────────────────
    if (/^#\s+/.test(line)) {
      const text = line.replace(/^#\s+/, '');
      result.push('');
      result.push(`${BOLD}${MAGENTA}${text}${RESET}`);
      result.push(`${DIM}${GRAY}${'━'.repeat(Math.min(BORDER_WIDTH, 60))}${RESET}`);
      lastLineWasBlank = false;
      continue;
    }

    // ── 二级标题 ## ─────────────────────────────
    if (/^##\s+/.test(line)) {
      const text = line.replace(/^##\s+/, '');
      result.push('');
      result.push(`${BOLD}${BLUE}▸ ${text}${RESET}`);
      lastLineWasBlank = false;
      continue;
    }

    // ── 三级标题 ### ────────────────────────────
    if (/^###\s+/.test(line)) {
      const text = line.replace(/^###\s+/, '');
      result.push('');
      result.push(`${BOLD}${CYAN}  • ${text}${RESET}`);
      lastLineWasBlank = false;
      continue;
    }

    // ── 四级及以下标题 ####+ ────────────────────
    if (/^#{4,}\s+/.test(line)) {
      const text = line.replace(/^#{4,}\s+/, '');
      result.push('');
      result.push(`${BOLD}${WHITE}    ▪ ${text}${RESET}`);
      lastLineWasBlank = false;
      continue;
    }

    // ── Task List (TODO) ─────────────────────────
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      const indent = Math.floor(taskMatch[1].length / 2);
      const checked = taskMatch[2].toLowerCase() === 'x';
      const text = processInlineMarkdownSimple(taskMatch[3]);
      const checkbox = checked
        ? `${GREEN}✔${RESET}`
        : `${GRAY}☐${RESET}`;
      const label = checked
        ? `${DIM}${text}${RESET}`
        : text;
      result.push(`${'  '.repeat(indent)}${checkbox} ${label}`);
      lastLineWasBlank = false;
      continue;
    }

    // ── 无序列表 ────────────────────────────────
    if (/^(\s*)[-*]\s+/.test(line)) {
      const match = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (match) {
        const indent = Math.floor(match[1].length / 2);
        const bullet = indent === 0 ? '•' : indent === 1 ? '◦' : '▪';
        const text = processInlineMarkdownSimple(match[2]);
        result.push(`${'  '.repeat(indent)}${YELLOW}${bullet} ${RESET}${text}`);
      }
      lastLineWasBlank = false;
      continue;
    }

    // ── 有序列表 ────────────────────────────────
    if (/^(\s*)\d+\.\s+/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (match) {
        const indent = Math.floor(match[1].length / 2);
        const num = match[2];
        const text = processInlineMarkdownSimple(match[3]);
        result.push(`${'  '.repeat(indent)}${YELLOW}${num}. ${RESET}${text}`);
      }
      lastLineWasBlank = false;
      continue;
    }

    // ── 引用块 ──────────────────────────────────
    if (/^>\s*/.test(line)) {
      const text = line.replace(/^>\s*/, '');
      if (text) {
        result.push(`  ${GREEN}┃${RESET} ${ITALIC}${GRAY}${processInlineMarkdownSimple(text)}${RESET}`);
      } else {
        result.push(`  ${GREEN}┃${RESET}`);
      }
      lastLineWasBlank = false;
      continue;
    }

    // ── 表格 ────────────────────────────────────
    if (line.trim().startsWith('|')) {
      // 表格需要整体处理才能对齐列宽，收集所有连续的表格行
      const tableLines: string[] = [line];
      while (i + 1 < lines.length && (lines[i + 1] || '').trim().startsWith('|')) {
        i++;
        tableLines.push(lines[i] || '');
      }

      // 解析表格：提取每行的单元格内容
      const parsedRows: string[][] = [];
      let separatorIndex = -1;
      for (let r = 0; r < tableLines.length; r++) {
        const tl = tableLines[r].trim();
        // 分隔符行：| --- | :---: | ---: | 等变体
        if (/^\|[\s\-:|]+\|$/.test(tl) && tl.includes('-')) {
          separatorIndex = r;
          parsedRows.push([]); // 占位
        } else {
          // 去掉首尾的 |，按 | 分割
          const cells = tl.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
          parsedRows.push(cells);
        }
      }

      // 获取终端宽度（留 2 列安全边距）
      const termWidth = (process.stdout.columns || 80) - 2;

      // 列数
      const colCount = Math.max(...parsedRows.filter(r => r.length > 0).map(r => r.length), 0);
      if (colCount === 0) {
        // 无有效列，原样输出
        for (const tl of tableLines) result.push(tl);
        lastLineWasBlank = false;
        continue;
      }

      // 第一遍：计算每列内容的自然宽度（不限制）
      const naturalWidths: number[] = new Array(colCount).fill(0);
      for (const row of parsedRows) {
        if (row.length === 0) continue;
        for (let c = 0; c < row.length; c++) {
          const w = getDisplayWidth(stripMarkdownInline(row[c] || ''));
          if (w > naturalWidths[c]) naturalWidths[c] = w;
        }
      }

      // 第二遍：计算最终列宽（适配终端宽度）
      // 开销 = 每列左右各 1 空格 + 列间 │ + 首尾 │
      // 例：3 列 = │_c1_│_c2_│_c3_│ = 1 + (w+2)*3 + (3-1) = 3*w + 3*2 + 2 + 1 = ...
      const borderOverhead = 1 + colCount * 3 + (colCount - 1);
      const availableWidth = Math.max(termWidth - borderOverhead, colCount * 4); // 每列最少 4 字符
      const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

      let colWidths: number[];
      if (totalNatural <= availableWidth) {
        // 自然宽度就够放下，直接用
        colWidths = [...naturalWidths];
      } else {
        // 需要压缩：按比例分配，但每列最少 4 字符
        const minColWidth = 4;
        colWidths = naturalWidths.map(w => {
          const ratio = w / totalNatural;
          return Math.max(minColWidth, Math.floor(ratio * availableWidth));
        });
        // 调整舍入误差
        const diff = availableWidth - colWidths.reduce((a, b) => a + b, 0);
        if (diff > 0) {
          // 多出来的宽度分给最宽的列
          const maxIdx = colWidths.indexOf(Math.max(...colWidths));
          colWidths[maxIdx] += diff;
        }
      }

      // 单元格自动换行：将超长内容拆成多行
      function wrapCell(text: string, maxWidth: number): string[] {
        if (maxWidth <= 0) return [text];
        const plain = stripMarkdownInline(text);
        if (getDisplayWidth(plain) <= maxWidth) return [text];

        // 按字符拆分（考虑中文宽度）
        const wrappedLines: string[] = [];
        let currentLine = '';
        let currentWidth = 0;
        for (const char of text) {
          const code = char.codePointAt(0) ?? 0;
          const charWidth = isWideChar(code) ? 2 : 1;
          if (currentWidth + charWidth > maxWidth && currentLine.length > 0) {
            wrappedLines.push(currentLine);
            currentLine = char;
            currentWidth = charWidth;
          } else {
            currentLine += char;
            currentWidth += charWidth;
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
        return wrappedLines.length > 0 ? wrappedLines : [''];
      }

      // 渲染表格
      result.push('');

      // ┌───┬───┐ 顶部边框
      const topBorder = colWidths.map(w => '─'.repeat(w + 2));
      result.push(`${DIM}${GRAY}┌${topBorder.join('┬')}┐${RESET}`);

      for (let r = 0; r < parsedRows.length; r++) {
        const row = parsedRows[r];
        if (row.length === 0) {
          // ├───┼───┤ 分隔符行
          const parts = colWidths.map(w => '─'.repeat(w + 2));
          result.push(`${DIM}${GRAY}├${parts.join('┼')}┤${RESET}`);
        } else {
          const isHeader = separatorIndex > 0 && r < separatorIndex;

          // 对每个单元格进行换行处理
          const wrappedCells: string[][] = colWidths.map((w, c) => {
            const cellText = row[c] || '';
            return wrapCell(cellText, w);
          });

          // 该行需要的物理行数（取各列换行后的最大行数）
          const maxLines = Math.max(...wrappedCells.map(wc => wc.length), 1);

          // 逐物理行渲染
          for (let ln = 0; ln < maxLines; ln++) {
            const cells = colWidths.map((w, c) => {
              const cellLine = wrappedCells[c][ln] || '';
              const plainText = stripMarkdownInline(cellLine);
              const processed = processInlineMarkdownSimple(cellLine);
              const pad = w - getDisplayWidth(plainText);
              const padded = processed + ' '.repeat(Math.max(0, pad));
              return isHeader ? `${BOLD}${padded}${RESET}` : padded;
            });
            result.push(`${DIM}${GRAY}│${RESET} ${cells.join(` ${DIM}${GRAY}│${RESET} `)} ${DIM}${GRAY}│${RESET}`);
          }
        }
      }

      // └───┴───┘ 底部边框
      const bottomBorder = colWidths.map(w => '─'.repeat(w + 2));
      result.push(`${DIM}${GRAY}└${bottomBorder.join('┴')}┘${RESET}`);

      lastLineWasBlank = false;
      continue;
    }

    // ── 空行（合并连续空行）────────────────────
    if (line.trim() === '') {
      if (!lastLineWasBlank) {
        result.push('');
        lastLineWasBlank = true;
      }
      continue;
    }

    // ── 普通文本 ────────────────────────────────
    result.push(processInlineMarkdownSimple(line));
    lastLineWasBlank = false;
  }

  return result;
}

/**
 * 移除行内 markdown 标记，返回纯文本（用于宽度计算）
 *
 * 必须与 processInlineMarkdownSimple 的替换规则保持一致：
 * - 行内代码 `text` 渲染时前后各加 1 格空格（" text "），这里也要加
 * - 其他标记只剥离语法符号
 */
function stripMarkdownInline(text: string): string {
  if (!text) return '';
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/~~(.+?)~~/g, '$1');
  result = result.replace(/`([^`]+)`/g, ' $1 '); // 与渲染一致：前后各加 1 格
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '$1');
  return result;
}

/**
 * 处理行内格式（简化版）
 */
function processInlineMarkdownSimple(text: string): string {
  // 安全检查
  if (!text || typeof text !== 'string') {
    return '';
  }

  let result = text;

  // 粗体 **text** 或 __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '\x1b[1m$1\x1b[22m');
  result = result.replace(/__(.+?)__/g, '\x1b[1m$1\x1b[22m');

  // 删除线 ~~text~~
  result = result.replace(/~~(.+?)~~/g, '\x1b[9m$1\x1b[29m');

  // 行内代码 `text` — 青色 + 前后留空
  result = result.replace(/`([^`]+)`/g, '\x1b[46m\x1b[30m $1 \x1b[0m');

  // 链接 [text](url) — 蓝色 + 下划线
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '\x1b[4m\x1b[34m$1\x1b[24m\x1b[39m');

  return result;
}

/**
 * 判断 Unicode 码点是否为宽字符（中日韩等，占 2 列）
 */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
    (code >= 0x2E80 && code <= 0x303E) ||  // CJK Radicals / Symbols
    (code >= 0x3041 && code <= 0x33BF) ||  // Hiragana, Katakana, CJK Compat
    (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Extension A
    (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
    (code >= 0xA000 && code <= 0xA4CF) ||  // Yi
    (code >= 0xAC00 && code <= 0xD7AF) ||  // Hangul Syllables
    (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compat Ideographs
    (code >= 0xFE30 && code <= 0xFE6F) ||  // CJK Compat Forms
    (code >= 0xFF01 && code <= 0xFF60) ||  // Fullwidth Forms
    (code >= 0xFFE0 && code <= 0xFFE6) ||  // Fullwidth Signs
    (code >= 0x20000 && code <= 0x2FA1F)   // CJK Extensions B-F
  );
}

/**
 * 计算字符串在终端中的显示宽度
 * 中日韩等全角字符占 2 列，ASCII 占 1 列
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) ?? 0;
    width += isWideChar(code) ? 2 : 1;
  }
  return width;
}
