// ============================================================
// M1 终端 UI — 底部状态栏组件
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';
import type { TokenUsage } from '@/types';

export interface StatusBarProps {
  model: string;
  usage: TokenUsage;
  cost: number;
}

/**
 * StatusBar — 底部状态栏，显示模型、Token 用量和费用
 */
export function StatusBar({ model, usage, cost }: StatusBarProps) {
  const costStr = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  const totalTokens = usage.input + usage.output;

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text color="gray">{model}</Text>
      <Text color="gray"> │ </Text>
      <Text color="gray">tokens: {totalTokens.toLocaleString()}</Text>
      <Text color="gray"> │ </Text>
      <Text color="gray">费用: {costStr}</Text>
    </Box>
  );
}
