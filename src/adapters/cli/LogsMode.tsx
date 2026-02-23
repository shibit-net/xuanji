// ============================================================
// M1 终端 UI — 日志模式组件
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '@/core/i18n';
import type { LogEntry } from './types';
import { LogSystem } from './utils/LogSystem';

interface LogsModeProps {
  onExit: () => void;
  logSystem: LogSystem;
}

/**
 * LogsMode — 日志查看面板
 * 显示最近的日志，支持暂停/清空
 */
export function LogsMode({ onExit, logSystem }: LogsModeProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // 初始化：加载历史日志
  useEffect(() => {
    const init = async () => {
      try {
        const recentLogs = await logSystem.loadRecentLogs(3, 100);
        setLogs(recentLogs.reverse()); // 倒序（最新在顶部）
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [logSystem]);

  // 注册新日志监听
  useEffect(() => {
    const unsub = logSystem.onLog((entry) => {
      if (!isPaused) {
        setLogs((prev) => [entry, ...prev.slice(0, 99)]);
      }
    });
    return () => unsub();
  }, [logSystem, isPaused]);

  // 键盘输入：p 暂停，c 清空，q/Esc 返回
  useInput((input, key) => {
    if (input === 'p' || input === 'P') {
      setIsPaused((prev) => !prev);
    } else if (input === 'c' || input === 'C') {
      setLogs([]);
      logSystem.clearMemoryCache();
    } else if (input === 'q' || input === 'Q' || key.escape) {
      onExit();
    }
  });

  if (isLoading) {
    return <Text color="gray">{t('logs.loading')}</Text>;
  }

  const getSourceIcon = (source: LogEntry['source']): string => {
    switch (source) {
      case 'Chat':
        return '💬';
      case 'Bot':
        return '🤖';
      case 'Config':
        return '⚙️';
      default:
        return '📋';
    }
  };

  const getLogColor = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error':
        return 'red';
      case 'warn':
        return 'yellow';
      default:
        return 'white';
    }
  };

  const maxLines = 20;
  const displayLogs = logs.slice(0, maxLines);

  return (
    <Box flexDirection="column">
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">{t('logs.title')}</Text>
        <Text color="gray"> ({t('logs.count', { count: logs.length })})</Text>
        {isPaused && <Text color="#FBBF24"> {t('logs.paused')}</Text>}
      </Box>

      {/* 日志列表 */}
      {displayLogs.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {displayLogs.map((log, i) => (
            <Box key={`${log.timestamp}-${i}`}>
              <Text color="gray">[{log.timestamp}] </Text>
              <Text>{getSourceIcon(log.source)} </Text>
              <Text color={getLogColor(log.level)} bold={log.level !== 'info'}>
                {log.message}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color="gray">{t('logs.empty')}</Text>
        </Box>
      )}

      {/* 日志过多提示 */}
      {logs.length > maxLines && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            {t('logs.more', { remaining: logs.length - maxLines, max: maxLines })}
          </Text>
        </Box>
      )}

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {t('logs.hint')}
        </Text>
      </Box>
    </Box>
  );
}
