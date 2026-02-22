// ============================================================
// M1 终端 UI — 机器人管理模式
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { BotType, BotStatus } from './types';
import { BotManager } from './utils/BotManager';

interface BotsModeProps {
  onExit: () => void;
  botManager: BotManager;
}

/**
 * BotsMode — 机器人启停管理面板
 * 显示 3 种机器人状态和操作菜单
 */
export function BotsMode({ onExit, botManager }: BotsModeProps) {
  const [statuses, setStatuses] = useState<BotStatus[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 加载机器人状态
  useEffect(() => {
    setStatuses(botManager.getStatuses());
  }, [botManager]);

  const botLabels: Record<BotType, { icon: string; label: string }> = {
    dingtalk: { icon: '🔴', label: '钉钉机器人' },
    feishu: { icon: '🔵', label: '飞书机器人' },
    wecom: { icon: '🟢', label: '企业微信机器人' },
  };

  const handleToggle = async (status: BotStatus) => {
    setIsLoading(true);
    setActionResult(null);

    try {
      if (status.running) {
        await botManager.stopBot(status.type);
        setActionResult({
          type: 'success',
          message: `${botLabels[status.type].label} 已停止`,
        });
      } else {
        // 注意: CLI 启动机器人需要 ChatSession
        setActionResult({
          type: 'error',
          message: '请通过 /bots start <type> 命令启动（需要先配置机器人密钥）',
        });
      }

      // 刷新状态
      setStatuses(botManager.getStatuses());
    } catch (error) {
      setActionResult({
        type: 'error',
        message: error instanceof Error ? error.message : '操作失败',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 键盘输入
  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      setActionResult(null);
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(statuses.length - 1, prev + 1));
      setActionResult(null);
    } else if (key.return) {
      const status = statuses[selectedIndex];
      if (status) {
        handleToggle(status);
      }
    } else if (input === 'q' || input === 'Q' || key.escape) {
      onExit();
    }
  });

  const getStatusLabel = (status: BotStatus): React.ReactNode => {
    if (status.running) {
      return <Text color="#34D399" bold>● 运行中</Text>;
    }
    if (status.lastError) {
      return <Text color="#F87171">● 错误</Text>;
    }
    return <Text color="gray">○ 已停止</Text>;
  };

  const formatUptime = (startTime?: number): string => {
    if (!startTime) return '';
    const elapsed = Date.now() - startTime;
    const minutes = Math.floor(elapsed / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h${minutes % 60}m`;
    }
    return `${minutes}m`;
  };

  return (
    <Box flexDirection="column">
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">🤖 IM 机器人管理</Text>
      </Box>

      {/* 机器人列表 */}
      <Box flexDirection="column" marginBottom={1}>
        {statuses.map((status, index) => {
          const info = botLabels[status.type];
          const isSelected = index === selectedIndex;
          return (
            <Box key={status.type} flexDirection="column">
              <Box>
                <Text color={isSelected ? '#7C8CF5' : 'gray'} bold={isSelected}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text>{info.icon} </Text>
                <Text bold={isSelected}>{info.label}</Text>
                <Text>  </Text>
                {getStatusLabel(status)}
                {status.running && status.lastStartTime && (
                  <Text color="gray"> ({formatUptime(status.lastStartTime)})</Text>
                )}
              </Box>
              {/* 错误信息 */}
              {status.lastError && isSelected && (
                <Box marginLeft={4}>
                  <Text color="#F87171" dimColor>└ {status.lastError}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 操作结果提示 */}
      {actionResult && (
        <Box marginBottom={1}>
          <Text color={actionResult.type === 'success' ? '#34D399' : '#F87171'}>
            {actionResult.type === 'success' ? '✓' : '✗'} {actionResult.message}
          </Text>
        </Box>
      )}

      {/* 加载中 */}
      {isLoading && (
        <Box marginBottom={1}>
          <Text color="gray">操作中...</Text>
        </Box>
      )}

      {/* 操作提示 */}
      <Box>
        <Text color="gray" dimColor>
          ↑↓ 选择机器人  Enter 启动/停止  Q 返回
        </Text>
      </Box>
    </Box>
  );
}
