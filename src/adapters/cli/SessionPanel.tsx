// ============================================================
// 会话管理面板 — 交互式键盘驱动
// ============================================================
//
// 替代 /resume、/save、/sessions 命令。
// ↑↓ 导航、Enter 恢复选中会话、S 保存、D 删除、Esc 返回。

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from './Theme';

export interface SessionItem {
  id: string;
  name: string;
  updatedAt: number;
  messageCount: number;
  /** 内容缩略 */
  preview?: string;
}

export interface SessionPanelProps {
  /** 获取会话列表 */
  onList: () => Promise<SessionItem[]>;
  /** 恢复会话 */
  onResume: (sessionId: string) => Promise<number>;
  /** 保存当前会话 */
  onSave?: (name?: string) => Promise<string>;
  /** 删除会话 */
  onDelete?: (sessionId: string) => Promise<void>;
  /** 关闭面板 */
  onClose: () => void;
}

type PanelState = 'list' | 'loading' | 'confirm-delete' | 'saving' | 'result';

export function SessionPanel({ onList, onResume, onSave, onDelete, onClose }: SessionPanelProps) {
  const theme = getTheme();
  const [state, setState] = useState<PanelState>('loading');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState('');
  const [resultMsg, setResultMsg] = useState('');

  // 加载会话列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await onList();
        if (!cancelled) {
          setSessions(list);
          setState('list');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setState('list');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [onList]);

  useInput((ch, key) => {
    if (state === 'loading' || state === 'saving') return;

    // 确认删除模式
    if (state === 'confirm-delete') {
      if (ch === 'y' || ch === 'Y' || key.return) {
        const session = sessions[selectedIndex];
        if (session && onDelete) {
          setState('loading');
          onDelete(session.id)
            .then(async () => {
              // 刷新列表
              const list = await onList();
              setSessions(list);
              setSelectedIndex(i => Math.min(i, list.length - 1));
              setResultMsg(`已删除: ${session.name}`);
              setState('result');
              setTimeout(() => setState('list'), 1200);
            })
            .catch(err => {
              setError(err instanceof Error ? err.message : String(err));
              setState('list');
            });
        }
        return;
      }
      // 取消删除
      setState('list');
      return;
    }

    // 结果提示模式：任意键返回
    if (state === 'result') {
      setState('list');
      return;
    }

    // 列表模式
    // Esc 关闭面板
    if (key.escape) {
      onClose();
      return;
    }

    // ↑↓ 导航
    if (key.upArrow && sessions.length > 0) {
      setSelectedIndex(i => (i - 1 + sessions.length) % sessions.length);
      return;
    }
    if (key.downArrow && sessions.length > 0) {
      setSelectedIndex(i => (i + 1) % sessions.length);
      return;
    }

    // Enter 恢复选中会话
    if (key.return && sessions.length > 0) {
      const session = sessions[selectedIndex];
      if (!session) return;
      setState('loading');
      setError('');
      onResume(session.id)
        .then(msgCount => {
          setResultMsg(`已恢复「${session.name}」(${msgCount} 条消息)`);
          setState('result');
          setTimeout(() => onClose(), 1500);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : String(err));
          setState('list');
        });
      return;
    }

    // D 删除选中会话
    if ((ch === 'd' || ch === 'D') && sessions.length > 0 && onDelete) {
      setState('confirm-delete');
      return;
    }

    // S 保存当前会话
    if ((ch === 's' || ch === 'S') && onSave) {
      setState('saving');
      setError('');
      onSave()
        .then(sessionId => {
          setResultMsg(`已保存 (${sessionId.slice(0, 8)}...)`);
          setState('result');
          // 刷新列表
          onList().then(list => {
            setSessions(list);
            setSelectedIndex(0);
          }).catch(() => {});
          setTimeout(() => setState('list'), 1200);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : String(err));
          setState('list');
        });
      return;
    }

    // 数字键快速选择
    const num = parseInt(ch, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      setSelectedIndex(num - 1);
      return;
    }
  });

  // ── 加载中 ──
  if (state === 'loading' || state === 'saving') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.primary}
        paddingX={1}
        marginTop={1}
      >
        <Text color={theme.primary} bold>会话管理</Text>
        <Box marginTop={1}>
          <Text color="yellow">{state === 'saving' ? '⠋ 保存中...' : '⠋ 加载中...'}</Text>
        </Box>
      </Box>
    );
  }

  // ── 结果提示 ──
  if (state === 'result') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="green"
        paddingX={1}
        marginTop={1}
      >
        <Text color="green" bold>✓ {resultMsg}</Text>
      </Box>
    );
  }

  // ── 确认删除 ──
  if (state === 'confirm-delete') {
    const session = sessions[selectedIndex];
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        paddingX={1}
        marginTop={1}
      >
        <Text color="red" bold>确认删除</Text>
        <Box marginTop={1}>
          <Text>确定删除「{session?.name}」？</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>Y/Enter 确认 · 其他键取消</Text>
        </Box>
      </Box>
    );
  }

  // ── 会话列表 ──
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.primary}
      paddingX={1}
      marginTop={1}
    >
      {/* 标题 */}
      <Box justifyContent="space-between">
        <Text color={theme.primary} bold>会话管理</Text>
        <Text color="gray" dimColor>共 {sessions.length} 个会话</Text>
      </Box>

      {/* 错误提示 */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      {/* 会话列表 */}
      <Box marginTop={1} flexDirection="column">
        {sessions.length === 0 ? (
          <Text color="gray">暂无保存的会话</Text>
        ) : (
          sessions.slice(0, 15).map((session, i) => {
            const isSelected = i === selectedIndex;
            const date = new Date(session.updatedAt).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <Box key={session.id} flexDirection="column">
                <Box>
                  <Text color={isSelected ? theme.primary : 'gray'}>
                    {isSelected ? '▶ ' : '  '}
                  </Text>
                  <Box width={3}>
                    <Text color="yellow" dimColor>{i + 1}.</Text>
                  </Box>
                  <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                    {session.name}
                  </Text>
                  <Text color="gray" dimColor>
                    {'  '}{session.messageCount}条 · {date}
                  </Text>
                </Box>
                {/* 选中项展示缩略内容 */}
                {isSelected && session.preview && (
                  <Box marginLeft={5}>
                    <Text color="gray" dimColor wrap="truncate-end">
                      {session.preview}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Enter 恢复{onSave ? ' · S 保存当前' : ''}{onDelete ? ' · D 删除' : ''} · Esc 返回
        </Text>
      </Box>
    </Box>
  );
}
