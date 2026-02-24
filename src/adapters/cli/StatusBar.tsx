// ============================================================
// M1 终端 UI — 底部状态栏组件
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';
import type { TokenUsage } from '@/core/types';

export interface StatusBarProps {
  model: string;
  usage: TokenUsage;
  cost: number;
}

/**
 * 格式化大数字（超过 10K 使用 K/M 单位）
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 10_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}

/**
 * StatusBar — 底部状态栏，显示模型和 Token 用量
 */
export function StatusBar({ model, usage }: StatusBarProps) {
  const totalTokens = usage.input + usage.output;

  return (
    <Box borderStyle="round" borderColor="#7C8CF5" paddingX={1} marginTop={1}>
      {/* 模型名称 */}
      <Text color="#7C8CF5" bold>🤖 {model}</Text>

      <Text color="gray" dimColor> │ </Text>

      {/* Token 用量 */}
      <Text color="cyan">📊 Token: </Text>
      <Text color="green">↑{formatNumber(usage.input)}</Text>
      <Text color="gray" dimColor> / </Text>
      <Text color="yellow">↓{formatNumber(usage.output)}</Text>
      <Text color="gray" dimColor> (</Text>
      <Text color="white">{formatNumber(totalTokens)}</Text>
      <Text color="gray" dimColor>)</Text>
    </Box>
  );
}
