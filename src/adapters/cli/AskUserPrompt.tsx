// ============================================================
// AskUserPrompt — Agent 向用户提问的 UI 组件
// ============================================================

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from './Theme';

export interface AskUserPromptProps {
  /** Agent 提出的问题 */
  question: string;
  /** 选项列表（可选，提供则显示为选择题） */
  options?: string[];
  /** 是否允许多选 */
  multiSelect?: boolean;
  /** 用户提交回答后的回调 */
  onAnswer: (answer: string) => void;
}

/**
 * Agent 向用户提问的交互组件
 *
 * 三种模式：
 * 1. 无 options：显示文本输入框（Enter 提交，Esc 跳过）
 * 2. options + 单选：↑↓ 导航，Enter 选择
 * 3. options + multiSelect：↑↓ 导航，Space 切换选中，Enter 确认
 *
 * 使用 React.memo 避免父组件 state 变化导致不必要的重渲染，
 * 减少 Ink 动态区域重绘次数，防止终端输出闪烁/堆叠。
 */
export const AskUserPrompt = React.memo(function AskUserPrompt({ question, options, multiSelect, onAnswer }: AskUserPromptProps) {
  const theme = getTheme();

  // 文本输入模式
  if (!options || options.length === 0) {
    return <TextInputMode question={question} onAnswer={onAnswer} />;
  }

  // 选项模式
  return (
    <OptionsMode
      question={question}
      options={options}
      multiSelect={multiSelect ?? false}
      onAnswer={onAnswer}
    />
  );
});

/**
 * 文本输入模式（原有行为）
 */
function TextInputMode({ question, onAnswer }: { question: string; onAnswer: (answer: string) => void }) {
  const theme = getTheme();
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  useInput((ch, key) => {
    if (key.return) {
      onAnswer(input.trim());
      return;
    }
    if (key.escape) {
      onAnswer('');
      return;
    }
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput((prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos((p) => p - 1);
      }
      return;
    }
    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos((p) => Math.min(input.length, p + 1));
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      setInput((prev) => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos((p) => p + ch.length);
    }
  });

  const before = input.slice(0, cursorPos);
  const cursor = input[cursorPos] ?? ' ';
  const after = input.slice(cursorPos + 1);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#60A5FA"
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text color="#60A5FA" bold>{'❓ '}</Text>
        <Text color={theme.primary} bold>Agent 提问</Text>
      </Box>
      <Box marginTop={1}>
        <Text wrap="wrap">{question}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>Enter 提交 · Esc 跳过</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="#60A5FA">{'❯ '}</Text>
        <Text>{before}</Text>
        <Text backgroundColor="#60A5FA" color="black">{cursor}</Text>
        <Text>{after}</Text>
      </Box>
    </Box>
  );
}

/**
 * 选项模式（单选/多选）
 */
function OptionsMode({
  question,
  options,
  multiSelect,
  onAnswer,
}: {
  question: string;
  options: string[];
  multiSelect: boolean;
  onAnswer: (answer: string) => void;
}) {
  const theme = getTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set());

  useInput((ch, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
      return;
    }
    if (key.escape) {
      onAnswer('');
      return;
    }

    if (multiSelect) {
      // Space 切换选中状态
      if (ch === ' ') {
        setSelectedSet((prev) => {
          const next = new Set(prev);
          if (next.has(selectedIndex)) {
            next.delete(selectedIndex);
          } else {
            next.add(selectedIndex);
          }
          return next;
        });
        return;
      }
      // Enter 确认多选
      if (key.return) {
        const selected = Array.from(selectedSet)
          .sort((a, b) => a - b)
          .map((i) => options[i]);
        onAnswer(JSON.stringify(selected));
        return;
      }
    } else {
      // 单选：Enter 选择当前项
      if (key.return) {
        onAnswer(options[selectedIndex]);
        return;
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#60A5FA"
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text color="#60A5FA" bold>{'❓ '}</Text>
        <Text color={theme.primary} bold>Agent 提问</Text>
      </Box>
      <Box marginTop={1}>
        <Text wrap="wrap">{question}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, i) => {
          const isFocused = i === selectedIndex;
          const isChecked = selectedSet.has(i);

          let prefix: string;
          if (multiSelect) {
            prefix = isChecked ? '◉ ' : '○ ';
          } else {
            prefix = isFocused ? '❯ ' : '  ';
          }

          return (
            <Box key={i}>
              <Text
                color={isFocused ? '#60A5FA' : undefined}
                bold={isFocused}
              >
                {prefix}{option}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {multiSelect
            ? '↑↓ 导航 · Space 切换 · Enter 确认 · Esc 跳过'
            : '↑↓ 导航 · Enter 选择 · Esc 跳过'}
        </Text>
      </Box>
    </Box>
  );
}
