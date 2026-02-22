// ============================================================
// M1 终端 UI — 工具调用展示组件
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';

export interface ToolDisplayProps {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  duration?: number;
}

/**
 * ToolDisplay — 工具调用结果展示
 */
export function ToolDisplay({ name, input, result, isError, duration }: ToolDisplayProps) {
  // 简化显示输入参数
  const inputSummary = Object.entries(input)
    .map(([k, v]) => {
      const val = typeof v === 'string'
        ? (v.length > 60 ? v.slice(0, 60) + '...' : v)
        : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(', ');

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="#60A5FA" bold>🔧 {name}</Text>
        {duration !== undefined && (
          <Text color="gray"> ({(duration / 1000).toFixed(1)}s)</Text>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text color="gray">├── {inputSummary}</Text>
      </Box>
      {result !== undefined && (
        <Box marginLeft={3}>
          <Text color={isError ? 'red' : 'green'}>
            └── {isError ? '✗' : '✓'} {
              result.length > 100 ? result.slice(0, 100) + '...' : result
            }
          </Text>
        </Box>
      )}
    </Box>
  );
}
