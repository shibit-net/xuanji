// ============================================================
// M1 终端 UI — 文本输入组件
// ============================================================
//
// 支持两种输入模式:
// - 单行输入（默认，Enter 发送）
// - 多行输入（Shift+Enter 换行，Enter 发送）

import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

export interface InputHandlerProps {
  onSubmit: (text: string) => void;
  isActive: boolean;
}

/**
 * InputHandler — 文本输入框（支持多行）
 *
 * - Enter: 发送消息
 * - Shift+Enter: 插入换行
 * - 上下箭头: 多行时移动光标
 * - 最多显示 5 行
 *
 * 输入法问题修复：
 * - 跟踪最后一次字符输入的时间戳
 * - Enter 按下时，检查是否在输入法刚完成的时间窗口内（< 300ms）
 * - 如果是，延迟 150ms 处理，给输入法时间完成并追加候选词
 * - 在延迟期间，检查 lines 是否有新字符被追加（IME 选词的信号）
 * - 如果有新字符，说明是 IME 选词，不发送；否则执行发送
 */
export function InputHandler({ onSubmit, isActive }: InputHandlerProps) {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  // 跟踪最后一次字符输入的时间，用于检测输入法
  const lastCharInputTimeRef = useRef<number>(0);
  // 用于在 setTimeout 回调中读取最新的 lines，避免闭包问题
  const linesRef = useRef<string[]>(['']);

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
        linesRef.current = newLines;
        return newLines;
      });
      setCursorLine((prev) => prev + 1);
      setCursorCol(0);
      return;
    }

    // Enter: 发送
    if (key.return) {
      const now = Date.now();
      const timeSinceLastChar = now - lastCharInputTimeRef.current;
      const text = lines.join('\n').trim();

      // 如果在较短的时间内（< 500ms）有字符输入，可能是输入法刚完成
      // 这时候延迟处理，等待 IME 的候选词字符到达
      if (timeSinceLastChar < 500 && timeSinceLastChar > 0 && text) {
        // 延迟 200ms 再处理，给输入法充足时间完成
        setTimeout(() => {
          // 重新检查当前的 lines 是否改变
          const currentText = linesRef.current.join('\n').trim();

          // 如果文本没有变化，说明不是 IME 追加字符的情况，执行发送
          if (currentText === text) {
            if (currentText) {
              onSubmit(currentText);
              setLines(['']);
              setCursorLine(0);
              setCursorCol(0);
            }
          }
          // 如果文本变化了，说明 IME 刚追加了字符，不发送，等待下一次 Enter
        }, 200);
        return;
      }

      // 超过 500ms 或输入框为空，直接发送（不是 IME 情况）
      if (text) {
        onSubmit(text);
        setLines(['']);
        setCursorLine(0);
        setCursorCol(0);
      }
      return;
    }

    // Backspace: 删除字符或合并行
    if (key.backspace || key.delete) {
      setLines((prev) => {
        const newLines = [...prev];
        if (cursorCol > 0) {
          const line = newLines[cursorLine] || '';
          newLines[cursorLine] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
          setCursorCol(cursorCol - 1);
        } else if (cursorLine > 0) {
          const prevLine = newLines[cursorLine - 1] || '';
          const currentLine = newLines[cursorLine] || '';
          newLines[cursorLine - 1] = prevLine + currentLine;
          newLines.splice(cursorLine, 1);
          setCursorLine(cursorLine - 1);
          setCursorCol(prevLine.length);
        }
        linesRef.current = newLines;
        return newLines;
      });
      return;
    }

    // 左键
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

    // 右键
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

    // 上键: 多行时移动
    if (key.upArrow && lines.length > 1) {
      if (cursorLine > 0) {
        const prevLine = lines[cursorLine - 1] || '';
        setCursorLine(cursorLine - 1);
        setCursorCol(Math.min(cursorCol, prevLine.length));
      }
      return;
    }

    // 下键: 多行时移动
    if (key.downArrow && lines.length > 1) {
      if (cursorLine < lines.length - 1) {
        const nextLine = lines[cursorLine + 1] || '';
        setCursorLine(cursorLine + 1);
        setCursorCol(Math.min(cursorCol, nextLine.length));
      }
      return;
    }

    // Ctrl+C 退出
    if (key.ctrl && input === 'c') {
      return; // useApp().exit() 在上层处理
    }

    // 普通字符输入
    if (input && !key.ctrl && !key.meta) {
      // 记录字符输入时间，用于检测输入法
      lastCharInputTimeRef.current = Date.now();

      setLines((prev) => {
        const newLines = [...prev];
        const line = newLines[cursorLine] || '';
        newLines[cursorLine] = line.slice(0, cursorCol) + input + line.slice(cursorCol);
        linesRef.current = newLines;
        return newLines;
      });
      setCursorCol(cursorCol + input.length);
    }
  }, { isActive });

  const isMultiline = lines.length > 1;
  const maxDisplayLines = 5;
  const startLine = Math.max(0, cursorLine - maxDisplayLines + 1);
  const displayLines = lines.slice(startLine, startLine + maxDisplayLines);
  const displayCursorLine = cursorLine - startLine;

  // 单行模式（兼容旧样式）
  if (!isMultiline) {
    return (
      <Box>
        <Text color="#7C8CF5" bold>❯ </Text>
        <Text>{lines[0]}</Text>
        <Text color="gray">█</Text>
      </Box>
    );
  }

  // 多行模式
  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => (
        <Box key={i}>
          {i === 0 && i === displayCursorLine && <Text color="#7C8CF5" bold>❯ </Text>}
          {i === 0 && i !== displayCursorLine && <Text color="#7C8CF5" bold>❯ </Text>}
          {i !== 0 && i === displayCursorLine && <Text color="#A78BFA">│ </Text>}
          {i !== 0 && i !== displayCursorLine && <Text color="gray">│ </Text>}
          <Text>
            {i === displayCursorLine ? (
              <>
                {line.slice(0, cursorCol)}
                <Text color="gray">█</Text>
                {line.slice(cursorCol)}
              </>
            ) : (
              line
            )}
          </Text>
        </Box>
      ))}
      {lines.length > maxDisplayLines && (
        <Box>
          <Text color="gray" dimColor>  ↕ {lines.length} 行 (Shift+Enter 换行)</Text>
        </Box>
      )}
    </Box>
  );
}
