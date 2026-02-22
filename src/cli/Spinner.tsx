// ============================================================
// M1 终端 UI — Spinner 加载指示器
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerProps {
  label: string;
}

/**
 * Spinner — 终端旋转加载指示器
 */
export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color="yellow">{SPINNER_FRAMES[frame]} </Text>
      <Text color="yellow">{label}</Text>
    </Box>
  );
}
