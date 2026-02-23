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
  const lines = content.split('\n');
  let inCodeBlock = false;
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        const lang = line.trim().slice(3);
        result.push(`\x1b[90m┌─ ${lang || 'code'} ─────\x1b[0m`);
        inCodeBlock = true;
      } else {
        result.push(`\x1b[90m└──────────\x1b[0m`);
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      result.push(`  \x1b[36m${line}\x1b[0m`);
      continue;
    }

    // 一级标题 #
    if (/^#\s+/.test(line)) {
      const content = line.replace(/^#\s+/, '');
      result.push('');
      result.push(`\x1b[1m\x1b[35m${content}\x1b[0m`);
      result.push(`\x1b[90m${'─'.repeat(content.length)}\x1b[0m`);
      continue;
    }

    // 二级标题 ##
    if (/^##\s+/.test(line)) {
      const content = line.replace(/^##\s+/, '');
      result.push('');
      result.push(`\x1b[1m\x1b[34m▸ ${content}\x1b[0m`);
      continue;
    }

    // 三级标题 ###
    if (/^###\s+/.test(line)) {
      const content = line.replace(/^###\s+/, '');
      result.push('');
      result.push(`\x1b[1m\x1b[36m• ${content}\x1b[0m`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const processed = line.replace(/^(\s*)[-*]\s+/, '$1\x1b[33m• \x1b[0m');
      result.push(processInlineMarkdownSimple(processed));
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const processed = line.replace(/^(\s*)(\d+)\.\s+/, '$1\x1b[33m$2. \x1b[0m');
      result.push(processInlineMarkdownSimple(processed));
      continue;
    }

    // 引用
    if (/^>\s+/.test(line)) {
      const content = line.replace(/^>\s+/, '');
      result.push(`\x1b[90m│ \x1b[3m${processInlineMarkdownSimple(content)}\x1b[0m`);
      continue;
    }

    // 表格
    if (line.trim().startsWith('|')) {
      if (/^\|[\s-:|]+\|$/.test(line.trim())) {
        result.push(`\x1b[90m${line.replace(/\|/g, '┼').replace(/-/g, '─')}\x1b[0m`);
      } else {
        result.push(line.replace(/\|/g, ' │ '));
      }
      continue;
    }

    // 空行
    if (line.trim() === '') {
      result.push('');
      continue;
    }

    // 普通文本
    result.push(processInlineMarkdownSimple(line));
  }

  return result;
}

/**
 * 处理行内格式（简化版）
 */
function processInlineMarkdownSimple(text: string): string {
  let result = text;

  // 粗体
  result = result.replace(/\*\*(.+?)\*\*/g, '\x1b[1m$1\x1b[22m');
  result = result.replace(/__(.+?)__/g, '\x1b[1m$1\x1b[22m');

  // 代码
  result = result.replace(/`([^`]+)`/g, '\x1b[36m$1\x1b[39m');

  // 链接
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '\x1b[34m$1\x1b[39m');

  return result;
}
