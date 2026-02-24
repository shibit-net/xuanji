// ============================================================
// M1 终端 UI — 可折叠的工具结果展示
// ============================================================

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface CollapsibleToolResultProps {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  duration: number;
  index: number;
  expanded: boolean;
  isSelected: boolean; // 是否在导航模式中被选中
  onToggleExpand: (index: number) => void;
  /** 该工具是否通过并行方式执行 */
  parallel?: boolean;
}

const MAX_EXPANDED_LINES = 1000; // 展开时最大显示行数

// ============================================================
// 工具指令摘要格式化
// ============================================================

/**
 * 截取字符串，取第一行并限制长度
 */
function truncStr(s: string, max: number): string {
  const firstLine = s.split('\n')[0] || s;
  return firstLine.length > max ? firstLine.slice(0, max) + '...' : firstLine;
}

/**
 * 工具名格式化：snake_case → 友好展示名
 *   bash → Bash, read_file → Read file, write_file → Write file
 */
export function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

/**
 * 提取工具 input 的关键参数，生成单行指令摘要
 *
 * 示例:
 *   read_file  → /src/index.ts
 *   bash       → npm run build
 *   grep       → pattern="foo" in /src
 */
export function formatToolCommand(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return truncStr(String(input.path || ''), 80);

    case 'bash': {
      const cmd = String(input.command || '');
      return truncStr(cmd, 80);
    }

    default: {
      // 通用：取第一个 string 值作为摘要
      const keys = Object.keys(input);
      if (keys.length === 0) return '';
      const firstKey = keys[0]!;
      const firstVal = input[firstKey];
      if (typeof firstVal === 'string') {
        return truncStr(firstVal, 80);
      }
      // 非 string 值用 JSON
      try {
        return truncStr(JSON.stringify(input), 80);
      } catch {
        return '';
      }
    }
  }
}

// ============================================================
// 展开状态辅助
// ============================================================

/**
 * 格式化 JSON 输入参数
 */
function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// ============================================================
// 组件
// ============================================================

/**
 * CollapsibleToolResult — 工具结果展示（可折叠/展开）
 *
 * 折叠模式：单行紧凑 — 状态图标 + 工具名 + 指令摘要 + 耗时
 * 展开模式：完整输入参数和结果
 *
 * 交互：Tab 导航 + Enter 展开/折叠
 */
export const CollapsibleToolResult = React.memo(function CollapsibleToolResult({
  name,
  input,
  result,
  isError,
  duration,
  index,
  expanded,
  isSelected,
  onToggleExpand,
  parallel,
}: CollapsibleToolResultProps) {
  const statusIcon = isError ? '✗' : '✓';
  const statusColor = isError ? 'red' : 'green';
  /** 并行标记前缀：⚡ */
  const parallelPrefix = parallel ? '⚡' : '';

  // 友好工具名
  const displayName = formatToolName(name);

  // 指令摘要（单行）
  const command = useMemo(() => formatToolCommand(name, input), [name, input]);

  // 展开时的 input 行（限 20 行）
  const expandedInputLines = useMemo(() => {
    if (!expanded) return [];
    return formatInput(input).split('\n').slice(0, 20);
  }, [input, expanded]);

  // 展开时的结果行（限 MAX_EXPANDED_LINES 行）
  const expandedResultLines = useMemo(() => {
    if (!expanded) return [];
    const lines = result.split('\n');
    if (lines.length <= MAX_EXPANDED_LINES) {
      return lines;
    }
    return [
      ...lines.slice(0, MAX_EXPANDED_LINES),
      `... (还有 ${lines.length - MAX_EXPANDED_LINES} 行未显示，请使用 Read 工具查看完整内容)`,
    ];
  }, [result, expanded]);

  // 结果摘要（取第一行非空内容，截断到 80 字符）
  const resultSummary = useMemo(() => {
    if (!result) return '';
    for (const line of result.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        return trimmed.length > 80 ? trimmed.slice(0, 80) + '...' : trimmed;
      }
    }
    return '';
  }, [result]);

  // ---- 折叠状态：指令 + 一行结果摘要 ----
  if (!expanded) {
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {isSelected && <Text color="#FBBF24" bold>{'▶ '}</Text>}
          {parallelPrefix ? <Text color="cyan">{parallelPrefix}</Text> : null}
          <Text color={statusColor}>{statusIcon}</Text>
          <Text color={isSelected ? '#FBBF24' : '#60A5FA'} bold>{` ${displayName}`}</Text>
          {command ? <Text color="gray"> {command}</Text> : null}
          {duration !== undefined ? <Text color="gray" dimColor> ({(duration / 1000).toFixed(2)}s)</Text> : null}
          {isError ? <Text color="red" bold> ERROR</Text> : null}
        </Text>
        {resultSummary && (
          <Box marginLeft={2}>
            <Text color="gray" dimColor>{'→ '}{resultSummary}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ---- 展开状态：完整详情 ----
  const borderColor = isSelected
    ? '#FBBF24'
    : (isError ? 'red' : '#60A5FA');

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={1}>
      {/* 标题行 */}
      <Box marginBottom={1}>
        {isSelected && <Text color="#FBBF24" bold>{'▶ '}</Text>}
        {parallelPrefix && <Text color="cyan">{parallelPrefix}</Text>}
        <Text color={isSelected ? '#FBBF24' : '#60A5FA'} bold>{displayName}</Text>
        {command && <Text color="gray"> {command}</Text>}
        <Text color="gray"> · {(duration / 1000).toFixed(2)}s</Text>
        <Text color={statusColor}> {statusIcon}</Text>
        {isError && <Text color="red" bold> ERROR</Text>}
      </Box>

      {/* 输入参数 */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">{'Input:'}</Text>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {expandedInputLines.map((line, i) => (
            <Text key={i} color="gray">{line}</Text>
          ))}
        </Box>
      </Box>

      {/* 结果 */}
      <Box flexDirection="column">
        <Text bold color={statusColor}>{'Result:'}</Text>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {expandedResultLines.map((line, i) => (
            <Text key={i} color={isError ? 'red' : 'white'}>{line}</Text>
          ))}
        </Box>
      </Box>

      {/* 导航提示 */}
      {isSelected && (
        <Box marginTop={1}>
          <Text color="#FBBF24" dimColor>{'▶ Enter 收起'}</Text>
        </Box>
      )}
    </Box>
  );
});
