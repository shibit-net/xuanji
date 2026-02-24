// ============================================================
// M1 终端 UI — Spinner 加载指示器
// ============================================================

import React from 'react';
import { Box, Text } from 'ink';
import { useGlobalSpinnerFrame, SPINNER_FRAMES } from './components/SpinnerManager';

export interface SpinnerProps {
  label: string;
}

/**
 * Spinner — 终端旋转加载指示器
 *
 * 优化: 使用全局 frame，不再维护独立的 interval
 */
export function Spinner({ label }: SpinnerProps) {
  const frame = useGlobalSpinnerFrame();

  return (
    <Box>
      <Text color="yellow">{SPINNER_FRAMES[frame]} </Text>
      <Text color="yellow">{label}</Text>
    </Box>
  );
}
