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
 * StatusBar — 底部状态栏，显示模型和 Token 用量
 */
export function StatusBar({ model, usage }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text color="gray">{model}</Text>
      <Text color="gray"> │ </Text>
      <Text color="gray">↑{usage.input.toLocaleString()} ↓{usage.output.toLocaleString()}</Text>
    </Box>
  );
}
