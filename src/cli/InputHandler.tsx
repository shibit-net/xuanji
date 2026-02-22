// ============================================================
// M1 终端 UI — 文本输入组件
// ============================================================

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface InputHandlerProps {
  onSubmit: (text: string) => void;
  isActive: boolean;
}

/**
 * TextInput — 单行文本输入框
 */
export function InputHandler({ onSubmit, isActive }: InputHandlerProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (!isActive) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value.trim());
        setValue('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    // Ctrl+C 退出
    if (key.ctrl && input === 'c') {
      return; // useApp().exit() 在上层处理
    }

    // 普通字符输入
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  }, { isActive });

  return (
    <Box>
      <Text color="#7C8CF5" bold>❯ </Text>
      <Text>{value}</Text>
      <Text color="gray">█</Text>
    </Box>
  );
}
