// ============================================================
// M1 终端 UI — 文本输入组件（完整 Kitty 协议支持）
// ============================================================
//
// 输入模式:
// - Enter: 发送消息
// - Shift+Enter: 插入换行（通过 Kitty 键盘协议 CSI u）
// - Option+Enter: 插入换行（备选）
// - 反斜杠+Enter: 插入换行（通用后备方案）

import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useStdin, useStdout } from 'ink';
import { t } from '@/core/i18n';
import { enableKittyProtocol, disableKittyProtocol, parseCSIu } from './utils/KittyKeyboard';

export interface InputHandlerProps {
  onSubmit: (text: string) => void;
  isActive: boolean;
  /** 当输入 buffer 为空时按特殊键触发（如 '?' 打开快捷操作面板） */
  onQuickAction?: (key: string) => void;
  /** 隐藏渲染输出（保持 stdin 监听和 Kitty 协议活跃，但不占用终端行数） */
  hidden?: boolean;
  /** 中断追加模式：Agent 执行中可输入补充指令，提示符变为 "+ " */
  interruptMode?: boolean;
}

/**
 * 解析传统的 ANSI 转义序列（作为 CSI u 的 fallback）
 */
function parseTraditionalKey(data: string): {
  type: 'char' | 'return' | 'backspace' | 'left' | 'right' | 'up' | 'down' | 'ctrl' | 'meta' | 'unknown';
  char?: string;
  key?: string;
} {
  // Ctrl+C
  if (data === '\x03') return { type: 'ctrl', key: 'c' };

  // Enter
  if (data === '\r' || data === '\n') return { type: 'return' };

  // Backspace
  if (data === '\x7f' || data === '\b') return { type: 'backspace' };

  // ESC + 字符 = Meta/Option
  if (data.length === 2 && data[0] === '\x1b') {
    const char = data[1];
    if (char === '\r' || char === '\n') return { type: 'meta', key: 'return' };
    return { type: 'meta', char };
  }

  // 箭头键
  if (data === '\x1b[A') return { type: 'up' };
  if (data === '\x1b[B') return { type: 'down' };
  if (data === '\x1b[C') return { type: 'right' };
  if (data === '\x1b[D') return { type: 'left' };

  // 所有非转义序列的字符（包括 ASCII 和 Unicode）
  if (!data.startsWith('\x1b')) return { type: 'char', char: data };

  return { type: 'unknown' };
}

/**
 * InputHandler — 文本输入框（完整 Kitty 协议支持）
 *
 * 不使用 Ink 的 useInput，完全自己解析 stdin：
 * - 支持 Kitty keyboard protocol (CSI u)
 * - Fallback 到传统 ANSI 序列
 * - 支持 Shift+Enter 换行
 */
export function InputHandler({ onSubmit, isActive, onQuickAction, hidden, interruptMode }: InputHandlerProps) {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  // 历史记录状态
  const [history, setHistory] = useState<string[]>([]);
  const [historyPointer, setHistoryPointer] = useState(-1); // -1 表示当前输入（未导航）
  const [tempInput, setTempInput] = useState(''); // 保存用户开始导航前的输入

  const linesRef = useRef<string[]>(['']);
  const cursorLineRef = useRef(0);
  const cursorColRef = useRef(0);
  const lastCharTimeRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const historyPointerRef = useRef(-1);
  const tempInputRef = useRef('');
  const onQuickActionRef = useRef(onQuickAction);

  // 同步 ref
  linesRef.current = lines;
  cursorLineRef.current = cursorLine;
  cursorColRef.current = cursorCol;
  onQuickActionRef.current = onQuickAction;

  // 同步历史记录 ref
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    historyPointerRef.current = historyPointer;
  }, [historyPointer]);

  useEffect(() => {
    tempInputRef.current = tempInput;
  }, [tempInput]);

  // 获取 stdin
  // Ink 内部 API（非公开合约），版本升级时需重点回归测试
  const { stdin, internal_eventEmitter } = useStdin();

  // 加载历史记录（初始化时）
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const { ConfigManager } = await import('./utils/ConfigManager');
        const configManager = new ConfigManager();
        await configManager.load();
        const savedHistory = configManager.getConfig().history || [];
        setHistory(savedHistory);
      } catch (err) {
        // ENOENT is expected on first run
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          // ENOENT 是正常情况（首次运行），非 ENOENT 错误静默忽略
        }
      }
    };
    loadHistory();
  }, []);

  // 保存历史记录（防抖）
  useEffect(() => {
    if (history.length === 0) return;

    const saveHistory = async () => {
      try {
        const { ConfigManager } = await import('./utils/ConfigManager');
        const configManager = new ConfigManager();
        await configManager.load();
        await configManager.save({ history });
      } catch (err) {
        // 历史记录保存失败：非关键错误，静默忽略
      }
    };

    // 防抖保存，避免频繁写入
    const timer = setTimeout(saveHistory, 1000);
    return () => clearTimeout(timer);
  }, [history]);

  // 插入换行
  const insertNewline = () => {
    const cl = cursorLineRef.current;
    const cc = cursorColRef.current;
    setLines((prev) => {
      const newLines = [...prev];
      const currentLine = newLines[cl] || '';
      const before = currentLine.slice(0, cc);
      const after = currentLine.slice(cc);
      newLines[cl] = before;
      newLines.splice(cl + 1, 0, after);
      return newLines;
    });
    setCursorLine(cl + 1);
    setCursorCol(0);
  };

  // 历史记录导航
  const navigateHistory = (direction: 'up' | 'down') => {
    const hist = historyRef.current;
    if (hist.length === 0) return;

    if (direction === 'up') {
      // 上箭头：浏览更旧的记录
      if (historyPointerRef.current === -1) {
        // 首次按上箭头：保存当前输入，跳转到最新的历史记录
        const currentText = linesRef.current.join('\n');
        setTempInput(currentText); // 保存当前输入

        const newPointer = hist.length - 1;
        setHistoryPointer(newPointer);
        const historyText = hist[newPointer];
        const historyLines = historyText.split('\n');
        setLines(historyLines);
        setCursorLine(historyLines.length - 1);
        setCursorCol(historyLines[historyLines.length - 1].length);
      } else if (historyPointerRef.current > 0) {
        // 继续向上浏览
        const newPointer = historyPointerRef.current - 1;
        setHistoryPointer(newPointer);
        const historyText = hist[newPointer];
        const historyLines = historyText.split('\n');
        setLines(historyLines);
        setCursorLine(historyLines.length - 1);
        setCursorCol(historyLines[historyLines.length - 1].length);
      }
      // 已到达最旧记录，不操作
    } else {
      // 下箭头：浏览更新的记录
      if (historyPointerRef.current === -1) {
        // 未在浏览历史，不操作
        return;
      } else if (historyPointerRef.current < hist.length - 1) {
        // 继续向下浏览
        const newPointer = historyPointerRef.current + 1;
        setHistoryPointer(newPointer);
        const historyText = hist[newPointer];
        const historyLines = historyText.split('\n');
        setLines(historyLines);
        setCursorLine(historyLines.length - 1);
        setCursorCol(historyLines[historyLines.length - 1].length);
      } else {
        // 到达最新记录，恢复之前保存的输入
        setHistoryPointer(-1);
        const savedInput = tempInputRef.current;
        const savedLines = savedInput ? savedInput.split('\n') : [''];
        setLines(savedLines);
        setCursorLine(savedLines.length - 1);
        setCursorCol(savedLines[savedLines.length - 1].length);
        setTempInput(''); // 清空临时输入
      }
    }
  };

  // 插入字符
  const insertChar = (char: string) => {
    // Buffer 为空时，特殊字符触发快捷操作（如 '?' 打开操作面板）
    const isBufferEmpty = linesRef.current.length === 1 && linesRef.current[0] === '';
    if (isBufferEmpty && onQuickActionRef.current && char === '?') {
      onQuickActionRef.current(char);
      return;
    }

    // 用户开始输入新内容，退出历史导航模式
    if (historyPointerRef.current !== -1) {
      setHistoryPointer(-1);
      setTempInput(''); // 清空临时保存的输入
    }

    lastCharTimeRef.current = Date.now();
    const cl = cursorLineRef.current;
    const cc = cursorColRef.current;
    setLines((prev) => {
      const newLines = [...prev];
      const line = newLines[cl] || '';
      newLines[cl] = line.slice(0, cc) + char + line.slice(cc);
      return newLines;
    });
    setCursorCol(cc + char.length);
  };

  // 删除字符
  const deleteChar = () => {
    // 用户开始编辑内容，退出历史导航模式
    if (historyPointerRef.current !== -1) {
      setHistoryPointer(-1);
      setTempInput(''); // 清空临时保存的输入
    }

    const cl = cursorLineRef.current;
    const cc = cursorColRef.current;
    if (cc > 0) {
      setLines((prev) => {
        const newLines = [...prev];
        const line = newLines[cl] || '';
        newLines[cl] = line.slice(0, cc - 1) + line.slice(cc);
        return newLines;
      });
      setCursorCol(cc - 1);
    } else if (cl > 0) {
      const prevLine = linesRef.current[cl - 1] || '';
      const currentLine = linesRef.current[cl] || '';
      setLines((prev) => {
        const newLines = [...prev];
        newLines[cl - 1] = prevLine + currentLine;
        newLines.splice(cl, 1);
        return newLines;
      });
      setCursorLine(cl - 1);
      setCursorCol(prevLine.length);
    }
  };

  // 发送消息
  const submit = () => {
    const text = linesRef.current.join('\n').trim();
    const now = Date.now();
    const timeSinceLastChar = now - lastCharTimeRef.current;

    // 输入法兼容
    if (timeSinceLastChar < 500 && timeSinceLastChar > 0 && text) {
      setTimeout(() => {
        const currentText = linesRef.current.join('\n').trim();
        if (currentText === text && currentText) {
          // 追加到历史记录
          setHistory(prev => {
            const lastEntry = prev[prev.length - 1];
            if (lastEntry === currentText) {
              return prev; // 连续相同命令，不重复添加
            }
            const newHistory = [...prev, currentText];
            // 限制历史记录大小（最多 50 条）
            if (newHistory.length > 50) {
              return newHistory.slice(-50);
            }
            return newHistory;
          });

          // 重置历史导航状态
          setHistoryPointer(-1);

          onSubmit(currentText);
          setLines(['']);
          setCursorLine(0);
          setCursorCol(0);
        }
      }, 200);
      return;
    }

    if (text) {
      // 追加到历史记录（去重：仅当与最后一条不同时才添加）
      setHistory(prev => {
        const lastEntry = prev[prev.length - 1];
        if (lastEntry === text) {
          return prev; // 连续相同命令，不重复添加
        }
        const newHistory = [...prev, text];
        // 限制历史记录大小（最多 50 条）
        if (newHistory.length > 50) {
          return newHistory.slice(-50);
        }
        return newHistory;
      });

      // 重置历史导航状态
      setHistoryPointer(-1);

      onSubmit(text);
      setLines(['']);
      setCursorLine(0);
      setCursorCol(0);
    }
  };

  // 监听 raw stdin
  useEffect(() => {
    if (!internal_eventEmitter) return;

    // 启用 Kitty 键盘协议
    enableKittyProtocol();

    // 确保 stdin 进入 raw mode
    const rawStdin = stdin as NodeJS.ReadStream | undefined;
    if (rawStdin?.setRawMode) {
      rawStdin.setRawMode(true);
    }

    const handleInput = (data: string) => {
      // Ctrl+C: \x03 — 永远不拦截，让 Ink App 层处理
      if (data === '\x03') return;

      // 不活跃时：将 CSI u 序列转译为传统序列，让 Ink useInput 能正确解析
      // 原因：启用 Kitty 键盘协议后，终端发送 CSI u 编码的按键事件，
      //       但 Ink 的 parseKeypress 不理解 CSI u，导致 Tab/Enter/q/Esc 等全部失效。
      //       这里将 CSI u 转译为传统转义序列后重新 emit。
      if (!isActive) {
        const csiKey = parseCSIu(data);
        if (csiKey) {
          let translated: string | null = null;
          switch (csiKey.name) {
            case 'tab': translated = '\t'; break;
            case 'return': translated = '\r'; break;
            case 'escape': translated = '\x1b'; break;
            case 'backspace': translated = '\x7f'; break;
            case 'space': translated = ' '; break;
            case 'char':
              if (csiKey.ctrl && csiKey.char === 'c') {
                // Ctrl+C: 不转译，直接 passthrough（已被上面的 \x03 检查覆盖，此为防御）
                return;
              }
              if (csiKey.char) {
                // 字母/数字等字符：转译为原始字符（如 q → 'q'）
                if (csiKey.ctrl) {
                  // Ctrl+字母：转为控制字符 (Ctrl+A = 0x01, etc.)
                  const code = csiKey.char.toLowerCase().charCodeAt(0) - 96;
                  if (code >= 1 && code <= 26) {
                    translated = String.fromCharCode(code);
                  }
                } else {
                  translated = csiKey.char;
                }
              }
              break;
          }
          // 将转译后的序列重新 emit，让 Ink useInput 处理
          if (translated !== null && internal_eventEmitter) {
            internal_eventEmitter.emit('input', translated);
          }
        }
        // 非 CSI u 序列（传统序列）在 !isActive 时直接穿透给 Ink useInput
        return;
      }

      // 尝试解析 CSI u
      const csiKey = parseCSIu(data);
      if (csiKey) {
        // 先检查 Ctrl+C（CSI u 格式下 name='char', char='c', ctrl=true）
        if (csiKey.name === 'char' && csiKey.char === 'c' && csiKey.ctrl) {
          // Ctrl+C: 不处理，让 App 层的 raw stdin 监听器处理
          return;
        }
        if (csiKey.name === 'char' && csiKey.char) {
          // CSI u 编码的字符（含中文等 Unicode）
          if (!csiKey.ctrl && !csiKey.meta) {
            insertChar(csiKey.char);
          }
          return;
        }
        if (csiKey.name === 'return') {
          if (csiKey.shift || csiKey.meta) {
            insertNewline();
          } else {
            submit();
          }
          return;
        }
        if (csiKey.name === 'backspace') {
          deleteChar();
          return;
        }
        if (csiKey.name === 'space') {
          insertChar(' ');
          return;
        }
        if (csiKey.name === 'tab') {
          // Tab: 不拦截，让 App 层处理工具导航
          return;
        }
        // 其他 CSI u 按键暂不处理
        return;
      }

      // Fallback: 传统序列
      const traditionalKey = parseTraditionalKey(data);
      switch (traditionalKey.type) {
        case 'char':
          if (traditionalKey.char) insertChar(traditionalKey.char);
          break;
        case 'return':
          // 反斜杠+Enter: 换行
          const currentLine = linesRef.current[cursorLineRef.current] || '';
          const cc = cursorColRef.current;
          if (cc > 0 && currentLine[cc - 1] === '\\') {
            const cl = cursorLineRef.current;
            setLines((prev) => {
              const newLines = [...prev];
              const line = newLines[cl] || '';
              const before = line.slice(0, cc - 1);
              const after = line.slice(cc);
              newLines[cl] = before;
              newLines.splice(cl + 1, 0, after);
              return newLines;
            });
            setCursorLine(cl + 1);
            setCursorCol(0);
          } else {
            submit();
          }
          break;
        case 'backspace':
          deleteChar();
          break;
        case 'left':
          if (cursorColRef.current > 0) {
            setCursorCol(cursorColRef.current - 1);
          } else if (cursorLineRef.current > 0) {
            const prevLine = linesRef.current[cursorLineRef.current - 1] || '';
            setCursorLine(cursorLineRef.current - 1);
            setCursorCol(prevLine.length);
          }
          break;
        case 'right':
          const line = linesRef.current[cursorLineRef.current] || '';
          if (cursorColRef.current < line.length) {
            setCursorCol(cursorColRef.current + 1);
          } else if (cursorLineRef.current < linesRef.current.length - 1) {
            setCursorLine(cursorLineRef.current + 1);
            setCursorCol(0);
          }
          break;
        case 'up':
          // 多行模式下，如果已经在浏览历史记录，继续使用历史导航而非行内导航
          if (historyPointerRef.current !== -1) {
            navigateHistory('up');
          } else if (linesRef.current.length > 1) {
            // 多行模式：行内导航
            if (cursorLineRef.current > 0) {
              const prevLine = linesRef.current[cursorLineRef.current - 1] || '';
              setCursorLine(cursorLineRef.current - 1);
              setCursorCol(Math.min(cursorColRef.current, prevLine.length));
            } else {
              // 已到第一行，开始历史导航
              navigateHistory('up');
            }
          } else {
            // 单行模式：历史记录导航（无论是否为空）
            navigateHistory('up');
          }
          break;
        case 'down':
          // 多行模式下，如果已经在浏览历史记录，继续使用历史导航而非行内导航
          if (historyPointerRef.current !== -1) {
            navigateHistory('down');
          } else if (linesRef.current.length > 1) {
            // 多行模式：行内导航
            if (cursorLineRef.current < linesRef.current.length - 1) {
              const nextLine = linesRef.current[cursorLineRef.current + 1] || '';
              setCursorLine(cursorLineRef.current + 1);
              setCursorCol(Math.min(cursorColRef.current, nextLine.length));
            } else {
              // 已到最后一行，开始历史导航
              navigateHistory('down');
            }
          } else {
            // 单行模式：历史记录导航（无论是否为空）
            navigateHistory('down');
          }
          break;
        case 'meta':
          if (traditionalKey.key === 'return') {
            // Option+Enter: 换行
            insertNewline();
          }
          break;
        case 'ctrl':
          // Ctrl+C 等由 App 层处理，这里不拦截
          break;
        default:
          // 未识别的按键，忽略
          break;
      }
    };

    internal_eventEmitter.on('input', handleInput);

    return () => {
      internal_eventEmitter.removeListener('input', handleInput);
      disableKittyProtocol();
    };
  }, [isActive, internal_eventEmitter]);

  // 隐藏模式：不渲染任何内容（保持 stdin 监听和 Kitty 协议活跃）
  if (hidden) return null;

  const isMultiline = lines.length > 1;
  const maxDisplayLines = 5;
  const startLine = Math.max(0, cursorLine - maxDisplayLines + 1);
  const displayLines = lines.slice(startLine, startLine + maxDisplayLines);
  const displayCursorLine = cursorLine - startLine;

  // 提示符：正常模式 "❯ "，中断追加模式 "+ "
  const promptChar = interruptMode ? '+ ' : '❯ ';
  const promptColor = interruptMode ? '#FBBF24' : '#7C8CF5';

  // 获取终端宽度，用于单行超长文本的视口滚动
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const promptWidth = 2; // "❯ " 占 2 个字符宽度（含空格）
  const cursorWidth = 1; // 光标 █ 占 1 个字符
  const availableWidth = termWidth - promptWidth - cursorWidth;

  // ---------------------------------------------------------------
  // 统一用 <Box flexDirection="column"> 包裹单行和多行，
  // 避免单行/多行切换时 Ink 渲染树不同导致旧行残留在终端上。
  // ---------------------------------------------------------------

  // 单行模式：超长文本做视口滚动
  if (!isMultiline) {
    const line = lines[0] || '';

    // 超长文本：视口滚动，确保 Ink 知道组件只占一行，避免终端软换行导致重绘异常
    let lineContent: React.ReactNode;
    if (line.length > availableWidth) {
      // 计算可见窗口：光标在窗口的 70% 位置（偏左），留出右侧空间
      const ellipsisWidth = 1; // "…" 占位
      const windowSize = availableWidth;

      let viewStart = Math.max(0, cursorCol - Math.floor(windowSize * 0.7));
      let viewEnd = viewStart + windowSize;
      if (viewEnd > line.length) {
        viewEnd = line.length;
        viewStart = Math.max(0, viewEnd - windowSize);
      }

      // 左右省略号占位调整
      const hasLeftEllipsis = viewStart > 0;
      const hasRightEllipsis = viewEnd < line.length;
      const adjustedStart = hasLeftEllipsis ? viewStart + ellipsisWidth : viewStart;
      const adjustedEnd = hasRightEllipsis ? viewEnd - ellipsisWidth : viewEnd;

      const visibleBefore = line.slice(adjustedStart, cursorCol);
      const visibleAfter = line.slice(cursorCol, adjustedEnd);

      lineContent = (
        <Text>
          {hasLeftEllipsis && <Text color="gray">…</Text>}
          {visibleBefore}
          <Text color="gray">█</Text>
          {visibleAfter}
          {hasRightEllipsis && <Text color="gray">…</Text>}
        </Text>
      );
    } else {
      lineContent = (
        <Text>
          {line.slice(0, cursorCol)}
          <Text color="gray">█</Text>
          {line.slice(cursorCol)}
        </Text>
      );
    }

    // 与多行模式共用同一棵组件树（都是 <Box flexDirection="column"> 包裹），
    // 避免模式切换时 Ink diff 不对齐导致残行
    return (
      <Box flexDirection="column">
        <Box key={0}>
          <Text color={promptColor} bold>{promptChar}</Text>
          {lineContent}
        </Box>
      </Box>
    );
  }

  // 多行模式
  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => {
        // 使用全局行号作为 key，确保 Ink 能正确识别哪一行被删除，
        // 避免 backspace 合并行时旧行内容残留在终端上
        const globalLineIndex = startLine + i;
        return (
          <Box key={globalLineIndex}>
            {i === 0 && <Text color={promptColor} bold>{promptChar}</Text>}
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
        );
      })}
      {lines.length > maxDisplayLines && (
        <Box>
          <Text color="gray" dimColor>  {t('input.multiline_hint', { count: lines.length })}</Text>
        </Box>
      )}
    </Box>
  );
}
