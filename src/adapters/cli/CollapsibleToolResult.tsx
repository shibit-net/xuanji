// ============================================================
// M1 终端 UI — 可折叠的工具结果展示
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';
import { renderMarkdownSimple } from './MarkdownRenderer';
import type { TokenUsage } from '@/core/types';

export interface CollapsibleToolResultProps {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  duration: number;
  tokenUsage?: TokenUsage;
  index: number;
  expanded: boolean;
  onToggleExpand: (index: number) => void;
}

const MAX_SUMMARY_LENGTH = 100;

/**
 * 格式化 token 数量（简化显示）
 */
function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return `${n}`;
}

/**
 * 生成 token 使用摘要
 */
function tokenSummary(usage: TokenUsage): string {
  const parts: string[] = [];
  parts.push(`↑${formatTokens(usage.input)}`);
  parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead && usage.cacheRead > 0) {
    parts.push(`⚡${formatTokens(usage.cacheRead)}`);
  }
  return parts.join(' ');
}

/**
 * CollapsibleToolResult — 工具结果展示（可折叠/展开）
 *
 * 默认折叠显示：🔧 工具名 (耗时) ✓ 结果摘要
 * 展开后显示：输入参数和完整结果
 */
export function CollapsibleToolResult({
  name,
  input,
  result,
  isError,
  duration,
  tokenUsage,
  index,
  expanded,
  onToggleExpand,
}: CollapsibleToolResultProps) {
  // 简化显示输入参数
  const inputSummary = Object.entries(input)
    .map(([k, v]) => {
      const val = typeof v === 'string'
        ? (v.length > 50 ? v.slice(0, 50) + '...' : v)
        : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(', ');

  // 处理结果摘要（单行，替换换行符）
  const resultOneLine = result.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  const resultSummary = resultOneLine.length > MAX_SUMMARY_LENGTH
    ? resultOneLine.slice(0, MAX_SUMMARY_LENGTH) + '...'
    : resultOneLine;

  // 使用 markdown 渲染器处理结果
  const resultLines = renderMarkdownSimple(result);

  // 折叠状态：只显示一行摘要
  if (!expanded) {
    return (
      <Box marginLeft={2}>
        <Text color="#60A5FA" bold>🔧 {name}</Text>
        <Text color="gray"> ({(duration / 1000).toFixed(2)}s)</Text>
        {tokenUsage && (
          <Text color="gray" dimColor> {tokenSummary(tokenUsage)}</Text>
        )}
        <Text color={isError ? 'red' : 'green'}>
          {' '}{isError ? '✗' : '✓'}{' '}
        </Text>
        <Text color="gray">{resultSummary}</Text>
      </Box>
    );
  }

  // 展开状态：显示详细信息
  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      {/* 工具头信息 */}
      <Box>
        <Text color="#60A5FA" bold>🔧 {name}</Text>
        <Text color="gray"> ({(duration / 1000).toFixed(2)}s)</Text>
        {tokenUsage && (
          <Text color="gray" dimColor> {tokenSummary(tokenUsage)}</Text>
        )}
        {isError && <Text color="red"> [Error]</Text>}
      </Box>

      {/* 输入参数 */}
      <Box marginLeft={2} marginTop={1}>
        <Text bold color="cyan">Input:</Text>
      </Box>
      <Box marginLeft={4}>
        <Text color="gray">{inputSummary}</Text>
      </Box>

      {/* 结果展示 */}
      <Box marginLeft={2} marginTop={1}>
        <Text bold color={isError ? 'red' : 'green'}>Result:</Text>
      </Box>
      <Box flexDirection="column" marginLeft={4}>
        {resultLines.map((line, i) => (
          <Box key={i}>
            <Text color={isError ? 'red' : 'white'}>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
