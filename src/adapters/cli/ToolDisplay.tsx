// ============================================================
// M1 终端 UI — 工具调用展示组件
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';
import { formatMarkdown } from './utils/MarkdownFormatter';

export interface ToolDisplayProps {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  duration?: number;
}

/**
 * ToolDisplay — 工具调用结果展示
 * 支持完整结果展示（包括多行文本和 markdown 格式）
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

  // 处理结果显示：支持多行和 markdown
  const resultLines = result ? result.split('\n') : [];
  const hasMultipleLines = resultLines.length > 1;
  const { lines: formattedLines, isMarkdown } = result ? formatMarkdown(result) : { lines: [], isMarkdown: false };

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
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
        <Box flexDirection="column" marginLeft={3}>
          {!hasMultipleLines ? (
            // 单行结果：简洁显示
            <Box>
              <Text color={isError ? 'red' : 'green'}>
                └── {isError ? '✗' : '✓'} {result.length > 100 ? result.slice(0, 100) + '...' : result}
              </Text>
            </Box>
          ) : (
            // 多行结果：逐行展示（已格式化）
            <>
              <Box>
                <Text color={isError ? 'red' : 'green'}>
                  └── {isError ? '✗' : '✓'} Result{isMarkdown ? ' (markdown)' : ''}:
                </Text>
              </Box>
              {formattedLines.map((line, i) => (
                <Box key={i} marginLeft={2}>
                  <Text color={isError ? 'red' : 'white'}>
                    {i === formattedLines.length - 1 ? '└' : '├'} {line}
                  </Text>
                </Box>
              ))}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
