// ============================================================
// M1 终端 UI — 并行工具组展示（树状结构）
// ============================================================

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { formatToolName, formatToolCommand } from './CollapsibleToolResult';

export interface ParallelToolItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  receivedBytes?: number;
  completed?: boolean;
  isError?: boolean;
  duration?: number;
  result?: string;
}

export interface ParallelToolGroupProps {
  /** 并行工具组的所有工具 */
  tools: ParallelToolItem[];
  /** 是否已全部完成 */
  completed?: boolean;
  /** 是否折叠显示（默认展开） */
  collapsed?: boolean;
}

/**
 * ParallelToolGroup — 并行工具组的树状展示
 * 
 * 展示样式:
 * ┌─ ⚡ Parallel Execution (3 tools)
 * ├─ ✓ Read file  src/index.ts  (0.12s)
 * ├─ ✓ Grep  pattern="foo" in /src  (0.15s)
 * └─ ✓ Glob  src/**\/*.ts  (0.08s)
 * 
 * 进行中样式:
 * ┌─ ⚡ Parallel Execution (3/5 completed)
 * ├─ ✓ Read file  src/index.ts  (0.12s)
 * ├─ ⏳ Grep  pattern="foo" in /src  (1.2KB)
 * ├─ ✓ Glob  src/**\/*.ts  (0.08s)
 * ├─ ⏳ Read file  src/types.ts  (3.5KB)
 * └─ ⏳ Read file  src/utils.ts
 */
export const ParallelToolGroup = React.memo(function ParallelToolGroup({
  tools,
  completed = false,
  collapsed = false,
}: ParallelToolGroupProps) {
  // 统计完成情况
  const stats = useMemo(() => {
    const total = tools.length;
    const completedCount = tools.filter(t => t.completed).length;
    const hasError = tools.some(t => t.isError);
    return { total, completedCount, hasError };
  }, [tools]);

  // 折叠模式：只显示汇总行
  if (collapsed) {
    const statusIcon = stats.hasError ? '✗' : (completed ? '✓' : '⏳');
    const statusColor = stats.hasError ? 'red' : (completed ? 'green' : 'yellow');
    return (
      <Box>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text color="cyan" bold>{' ⚡ Parallel Execution'}</Text>
        <Text color="gray">
          {' '}({completed ? `${stats.total} tools` : `${stats.completedCount}/${stats.total} completed`})
        </Text>
      </Box>
    );
  }

  // 展开模式：树状结构
  return (
    <Box flexDirection="column">
      {/* 顶部标题行 */}
      <Box>
        <Text color="cyan" bold>{'┌─ ⚡ Parallel Execution'}</Text>
        <Text color="gray">
          {' '}({completed ? `${stats.total} tools` : `${stats.completedCount}/${stats.total} completed`})
        </Text>
      </Box>

      {/* 工具列表 */}
      {tools.map((tool, index) => {
        const isLast = index === tools.length - 1;
        const prefix = isLast ? '└─' : '├─';
        
        // 状态图标
        const statusIcon = tool.isError ? '✗' : (tool.completed ? '✓' : '⏳');
        const statusColor = tool.isError ? 'red' : (tool.completed ? 'green' : 'yellow');
        
        // 工具名和命令
        const displayName = formatToolName(tool.name, tool.input);
        const command = formatToolCommand(tool.name, tool.input);
        
        // 进度信息
        let progressInfo = '';
        if (!tool.completed && tool.receivedBytes && tool.receivedBytes > 0) {
          const kb = (tool.receivedBytes / 1024).toFixed(1);
          progressInfo = ` (${kb}KB)`;
        } else if (tool.completed && tool.duration !== undefined) {
          progressInfo = ` (${(tool.duration / 1000).toFixed(2)}s)`;
        }

        return (
          <Box key={tool.id}>
            <Text color="cyan">{prefix}</Text>
            <Text color={statusColor}>{' ' + statusIcon}</Text>
            <Text color="#60A5FA" bold>{' ' + displayName}</Text>
            {command && <Text color="gray">{'  ' + command}</Text>}
            {progressInfo && <Text color="gray" dimColor>{progressInfo}</Text>}
            {tool.isError && <Text color="red" bold>{' ERROR'}</Text>}
          </Box>
        );
      })}
    </Box>
  );
});

/**
 * ParallelToolGroupCompact — 紧凑版并行工具组（用于历史记录）
 * 
 * 展示样式:
 * ⚡ Parallel (3 tools): Read file, Grep, Glob ✓ 0.15s
 */
export interface ParallelToolGroupCompactProps {
  tools: ParallelToolItem[];
  isSelected?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export const ParallelToolGroupCompact = React.memo(function ParallelToolGroupCompact({
  tools,
  isSelected = false,
  expanded = false,
  onToggleExpand,
}: ParallelToolGroupCompactProps) {
  const stats = useMemo(() => {
    const total = tools.length;
    const hasError = tools.some(t => t.isError);
    const maxDuration = Math.max(...tools.map(t => t.duration || 0));
    const toolNames = tools.map(t => formatToolName(t.name, t.input)).join(', ');
    return { total, hasError, maxDuration, toolNames };
  }, [tools]);

  const statusIcon = stats.hasError ? '✗' : '✓';
  const statusColor = stats.hasError ? 'red' : 'green';

  // 折叠状态：单行紧凑显示
  if (!expanded) {
    return (
      <Box>
        {isSelected && <Text color="#FBBF24" bold>{'▶ '}</Text>}
        <Text color="cyan">{'⚡ Parallel'}</Text>
        <Text color="gray">{' (' + stats.total + ' tools): '}</Text>
        <Text color="gray">{stats.toolNames.slice(0, 60) + (stats.toolNames.length > 60 ? '...' : '')}</Text>
        <Text color={statusColor}>{' ' + statusIcon}</Text>
        <Text color="gray" dimColor>{' ' + (stats.maxDuration / 1000).toFixed(2) + 's'}</Text>
      </Box>
    );
  }

  // 展开状态：树状结构
  return (
    <Box flexDirection="column" marginBottom={0} borderStyle="round" borderColor={isSelected ? '#FBBF24' : 'cyan'} paddingX={1} paddingY={1}>
      {/* 标题行 */}
      <Box marginBottom={0}>
        {isSelected && <Text color="#FBBF24" bold>{'▶ '}</Text>}
        <Text color="cyan" bold>{'⚡ Parallel Execution'}</Text>
        <Text color="gray">{' (' + stats.total + ' tools) · ' + (stats.maxDuration / 1000).toFixed(2) + 's'}</Text>
        <Text color={statusColor}>{' ' + statusIcon}</Text>
      </Box>

      {/* 工具列表 */}
      {tools.map((tool, index) => {
        const isLast = index === tools.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const toolStatusIcon = tool.isError ? '✗' : '✓';
        const toolStatusColor = tool.isError ? 'red' : 'green';
        const displayName = formatToolName(tool.name, tool.input);
        const command = formatToolCommand(tool.name, tool.input);
        const duration = tool.duration ? ` (${(tool.duration / 1000).toFixed(2)}s)` : '';

        return (
          <Box key={tool.id} marginLeft={2}>
            <Text color="cyan">{prefix}</Text>
            <Text color={toolStatusColor}>{' ' + toolStatusIcon}</Text>
            <Text color="#60A5FA" bold>{' ' + displayName}</Text>
            {command && <Text color="gray">{'  ' + command}</Text>}
            {duration && <Text color="gray" dimColor>{duration}</Text>}
            {tool.isError && <Text color="red" bold>{' ERROR'}</Text>}
          </Box>
        );
      })}

      {/* 导航提示 */}
      {isSelected && (
        <Box marginTop={1}>
          <Text color="#FBBF24" dimColor>{'▶ Enter 收起'}</Text>
        </Box>
      )}
    </Box>
  );
});
