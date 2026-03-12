// ============================================================
// M1 终端 UI — 可折叠的工具结果展示
// ============================================================

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { stripAnsi } from '@/core/utils/ansi';

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
const MAX_COLLAPSED_DIFF_LINES = 20; // 折叠模式 diff 最大显示行数

/** 需要在折叠状态显示 diff 预览的编辑类工具 */
const EDIT_TOOLS = new Set(['edit_file', 'multi_edit', 'write_file']);

// ============================================================
// ANSI 转义序列处理
// ============================================================
// (已迁移到 @/core/utils/ansi 公共模块)

/** 判断是否为 diff 变更行（+/-/空格开头） */
function isDiffLine(raw: string): boolean {
  const plain = stripAnsi(raw);
  return /^[+\- ]/.test(plain);
}

/** 判断 diff 行的类型 */
function getDiffLineType(raw: string): 'added' | 'removed' | 'context' {
  const plain = stripAnsi(raw);
  if (plain.startsWith('+')) return 'added';
  if (plain.startsWith('-')) return 'removed';
  return 'context';
}

/** 判断展开模式 diff 行的类型（带行号格式："行号 │ +/-/空格 内容"） */
function getExpandedDiffLineType(raw: string): 'added' | 'removed' | 'context' | 'none' {
  const plain = stripAnsi(raw);
  // 检查是否包含 diff 行号分隔符 │
  if (!plain.includes('│')) return 'none';
  // 检查是否包含 diff 前缀（"│ +" / "│ -" / "│  "）
  const match = plain.match(/│\s*([+\-\s])\s/);
  if (!match) return 'none';
  const prefix = match[1];
  if (prefix === '+') return 'added';
  if (prefix === '-') return 'removed';
  return 'context';
}

/**
 * 从工具结果中提取 diff 行和统计信息
 * 返回 { diffLines, statsLine } 用于折叠模式展示
 */
function extractDiffInfo(result: string): { diffLines: string[]; statsLine: string } {
  const lines = result.split('\n');
  const diffLines: string[] = [];
  let statsLine = '';

  for (const line of lines) {
    const plain = stripAnsi(line);
    // 提取统计行（如 "统计: +1 -1"）
    if (plain.startsWith('统计:')) {
      statsLine = plain;
      continue;
    }
    // 跳过头部信息行（变更预览标题、分隔线、空行、非 diff 行）
    if (plain.startsWith('变更预览:') || /^─+$/.test(plain) || plain.startsWith('已编辑') || plain.startsWith('已写入') || plain.startsWith('成功编辑') || plain.trim() === '') {
      continue;
    }
    // 收集 diff 行
    if (isDiffLine(line)) {
      diffLines.push(line);
    }
  }

  return { diffLines, statsLine };
}

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

/** 角色图标映射（用于 task 工具展示） */
const ROLE_ICONS: Record<string, string> = {
  'explore': '🔍',
  'plan': '📐',
  'coder': '💻',
  'general-purpose': '⚙️',
};

/**
 * 工具名格式化：snake_case → 友好展示名
 *   bash → Bash, read_file → Read file, write_file → Write file
 *   task → 带角色图标的展示名
 */
export function formatToolName(name: string, input?: Record<string, unknown>): string {
  // 防御性检查：如果 name 为空，返回默认值
  if (!name) return 'Unknown Tool';

  if (name === 'task' && input) {
    const role = String(input.subagent_type || 'general-purpose');
    const icon = ROLE_ICONS[role] || '⚙️';
    const roleLabel = role === 'general-purpose' ? 'Task' : role.charAt(0).toUpperCase() + role.slice(1);
    return `${icon} ${roleLabel}`;
  }
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

    case 'task': {
      const desc = String(input.description || '');
      return truncStr(desc, 80);
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
  const displayName = formatToolName(name, input);

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
    // 编辑类工具：使用统计信息作为摘要
    if (EDIT_TOOLS.has(name)) {
      const { statsLine } = extractDiffInfo(result);
      if (statsLine) return statsLine;
    }
    for (const line of result.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        return trimmed.length > 80 ? trimmed.slice(0, 80) + '...' : trimmed;
      }
    }
    return '';
  }, [result, name]);

  // 编辑类工具的 diff 预览行（折叠模式用）
  const collapsedDiffLines = useMemo(() => {
    if (expanded || !EDIT_TOOLS.has(name) || isError) return [];
    const { diffLines } = extractDiffInfo(result);
    if (diffLines.length <= MAX_COLLAPSED_DIFF_LINES) return diffLines;
    return [
      ...diffLines.slice(0, MAX_COLLAPSED_DIFF_LINES),
      `__truncated__:${diffLines.length - MAX_COLLAPSED_DIFF_LINES}`,
    ];
  }, [result, expanded, name, isError]);

  // ---- 折叠状态：指令 + 结果摘要 + diff 预览 ----
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
        {/* 编辑类工具：折叠模式下显示 diff 预览 */}
        {collapsedDiffLines.length > 0 && (
          <Box marginLeft={2} flexDirection="column">
            {collapsedDiffLines.map((line, i) => {
              // 截断标记
              if (line.startsWith('__truncated__:')) {
                const remaining = line.split(':')[1];
                return (
                  <Text key={i} color="gray" dimColor>{`  ... 还有 ${remaining} 行`}</Text>
                );
              }
              // 保留原始 ANSI 颜色，不使用 Ink 颜色
              return <Text key={i}>{line}</Text>;
            })}
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
    <Box flexDirection="column" marginBottom={0} borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={1}>
      {/* 标题行 */}
      <Box marginBottom={0}>
        {isSelected && <Text color="#FBBF24" bold>{'▶ '}</Text>}
        {parallelPrefix && <Text color="cyan">{parallelPrefix}</Text>}
        <Text color={isSelected ? '#FBBF24' : '#60A5FA'} bold>{displayName}</Text>
        {command && <Text color="gray"> {command}</Text>}
        <Text color="gray"> · {(duration / 1000).toFixed(2)}s</Text>
        <Text color={statusColor}> {statusIcon}</Text>
        {isError && <Text color="red" bold> ERROR</Text>}
      </Box>

      {/* 输入参数 */}
      <Box marginBottom={0} flexDirection="column">
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
          {expandedResultLines.map((line, i) => {
            // 错误时使用红色覆盖
            if (isError) {
              return <Text key={i} color="red">{line}</Text>;
            }
            // 编辑工具：保留原始 ANSI 颜色，不要用 Ink 的 color 属性
            if (EDIT_TOOLS.has(name)) {
              // 直接渲染，保留 ANSI 颜色代码
              return <Text key={i}>{line}</Text>;
            }
            // 其他工具：默认色
            return <Text key={i}>{stripAnsi(line)}</Text>;
          })}
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
