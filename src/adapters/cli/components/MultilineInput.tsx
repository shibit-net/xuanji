// ============================================================
// M1 终端 UI — 多行文本输入框
// ============================================================

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface MultilineInputProps {
  onSubmit: (text: string) => void;
  isActive: boolean;
  placeholder?: string;
}

/**
 * MultilineInput — 支持多行输入的文本框
 * - Enter: 发送
 * - Shift+Enter: 换行
 * - 最多显示 5 行
 */
export function MultilineInput({
  onSubmit,
  isActive,
  placeholder = 'Type your message (Shift+Enter to break line)',
}: MultilineInputProps) {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  useInput((input, key) => {
    if (!isActive) return;

    // Shift+Enter: 换行
    if (key.return && key.shift) {
      setLines((prev) => {
        const newLines = [...prev];
        const currentLine = newLines[cursorLine] || '';
        const before = currentLine.slice(0, cursorCol);
        const after = currentLine.slice(cursorCol);
        newLines[cursorLine] = before;
        newLines.splice(cursorLine + 1, 0, after);
        setCursorLine(cursorLine + 1);
        setCursorCol(0);
        return newLines;
      });
      return;
    }

    // Enter: 发送
    if (key.return) {
      const text = lines.join('\n').trim();
      if (text) {
        onSubmit(text);
        setLines(['']);
        setCursorLine(0);
        setCursorCol(0);
      }
      return;
    }

    // Backspace: 删除字符或合并行
    if (key.backspace) {
      setLines((prev) => {
        const newLines = [...prev];
        if (cursorCol > 0) {
          // 删除当前位置前的字符
          const line = newLines[cursorLine] || '';
          newLines[cursorLine] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
          setCursorCol(cursorCol - 1);
        } else if (cursorLine > 0) {
          // 合并前一行
          const prevLine = newLines[cursorLine - 1] || '';
          const currentLine = newLines[cursorLine] || '';
          newLines[cursorLine - 1] = prevLine + currentLine;
          newLines.splice(cursorLine, 1);
          setCursorLine(cursorLine - 1);
          setCursorCol(prevLine.length);
        }
        return newLines;
      });
      return;
    }

    // Delete: 删除光标后的字符
    if (key.delete) {
      setLines((prev) => {
        const newLines = [...prev];
        const line = newLines[cursorLine] || '';
        if (cursorCol < line.length) {
          newLines[cursorLine] = line.slice(0, cursorCol) + line.slice(cursorCol + 1);
        } else if (cursorLine < newLines.length - 1) {
          // 删除换行符（合并下一行）
          const nextLine = newLines[cursorLine + 1] || '';
          newLines[cursorLine] = line + nextLine;
          newLines.splice(cursorLine + 1, 1);
        }
        return newLines;
      });
      return;
    }

    // 左键: 移动光标
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(cursorCol - 1);
      } else if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1] || '';
        setCursorLine(cursorLine - 1);
        setCursorCol(prevLine.length);
      }
      return;
    }

    // 右键: 移动光标
    if (key.rightArrow) {
      const line = lines[cursorLine] || '';
      if (cursorCol < line.length) {
        setCursorCol(cursorCol + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine(cursorLine + 1);
        setCursorCol(0);
      }
      return;
    }

    // 上键: 移动到上一行
    if (key.upArrow) {
      if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1] || '';
        const newCol = Math.min(cursorCol, prevLine.length);
        setCursorLine(cursorLine - 1);
        setCursorCol(newCol);
      }
      return;
    }

    // 下键: 移动到下一行
    if (key.downArrow) {
      if (cursorLine < lines.length - 1) {
        const nextLine = lines[cursorLine + 1] || '';
        const newCol = Math.min(cursorCol, nextLine.length);
        setCursorLine(cursorLine + 1);
        setCursorCol(newCol);
      }
      return;
    }

    // Ctrl+A: 移动到行首
    if (key.ctrl && input === 'a') {
      setCursorCol(0);
      return;
    }

    // Ctrl+E: 移动到行尾
    if (key.ctrl && input === 'e') {
      const line = lines[cursorLine] || '';
      setCursorCol(line.length);
      return;
    }

    // Ctrl+C 退出
    if (key.ctrl && input === 'c') {
      return;
    }

    // 普通字符输入
    if (input && !key.ctrl && !key.meta && !key.shift) {
      setLines((prev) => {
        const newLines = [...prev];
        const line = newLines[cursorLine] || '';
        newLines[cursorLine] = line.slice(0, cursorCol) + input + line.slice(cursorCol);
        setCursorCol(cursorCol + 1);
        return newLines;
      });
    }
  }, { isActive });

  // 最多显示 5 行
  const maxDisplayLines = 5;
  const startLine = Math.max(0, cursorLine - maxDisplayLines + 1);
  const displayLines = lines.slice(startLine, startLine + maxDisplayLines);
  const displayCursorLine = cursorLine - startLine;

  // 如果没有输入内容，显示占位符
  const isEmpty = lines.length === 1 && lines[0] === '';

  return (
    <Box flexDirection="column">
      {isEmpty ? (
        <Text color="gray" dimColor>{placeholder}</Text>
      ) : (
        displayLines.map((line, i) => (
          <Box key={i}>
            {i === displayCursorLine && <Text color="#7C8CF5" bold>❯ </Text>}
            {i !== displayCursorLine && <Text>  </Text>}
            <Text>
              {line.slice(0, i === displayCursorLine ? cursorCol : undefined)}
              {i === displayCursorLine && <Text color="gray">█</Text>}
              {line.slice(i === displayCursorLine ? cursorCol : undefined)}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
