// ============================================================
// M1 终端 UI — IM 机器人配置子面板
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '@/core/i18n';
import type { AppConfig } from '@/core/types';
import type { BotType } from '../types';
import { ConfigManager } from '../utils/ConfigManager';

interface BotsConfigPanelProps {
  onBack: () => void;
  configManager: ConfigManager;
}

const BOT_ITEMS: Array<{ type: BotType; icon: string; label: string; fields: string[] }> = [
  {
    type: 'dingtalk',
    icon: '🔴',
    label: t('bots.dingtalk'),
    fields: ['AppKey', 'AppSecret'],
  },
  {
    type: 'feishu',
    icon: '🔵',
    label: t('bots.feishu'),
    fields: ['App ID', 'App Secret'],
  },
  {
    type: 'wecom',
    icon: '🟢',
    label: t('bots.wecom'),
    fields: ['CorpID', 'Secret', 'AgentID', 'Token', 'AES Key', 'Port'],
  },
];

/**
 * BotsConfigPanel — IM 机器人配置面板
 * 支持 ↑↓ 导航选择机器人类型查看配置
 */
export function BotsConfigPanel({ onBack, configManager }: BotsConfigPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 键盘交互
  useInput((input, key) => {
    // 数字键快速选择
    if (input === '1') { setSelectedIndex(0); return; }
    if (input === '2') { setSelectedIndex(1); return; }
    if (input === '3') { setSelectedIndex(2); return; }

    // 上下键导航
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(BOT_ITEMS.length - 1, prev + 1));
      return;
    }

    // Q/Esc 返回
    if (input === 'q' || input === 'Q' || key.escape) {
      onBack();
      return;
    }
  });

  const selectedBot = BOT_ITEMS[selectedIndex];

  return (
    <Box flexDirection="column">
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">{t('bots_config.title')}</Text>
      </Box>

      {/* 机器人列表 */}
      <Box marginBottom={1} flexDirection="column">
        {BOT_ITEMS.map((bot, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={bot.type}>
              <Text color={isSelected ? '#7C8CF5' : 'gray'} bold={isSelected}>
                {isSelected ? '▶ ' : '  '}
                {bot.icon} {bot.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* 选中的机器人配置字段 */}
      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="#7C8CF5">
            {t('bots_config.fields_title', { icon: selectedBot.icon, name: selectedBot.label })}
          </Text>
        </Box>
        {selectedBot.fields.map((field) => (
          <Box key={field}>
            <Text color="gray">  • {field}: </Text>
            <Text dimColor>{t('bots_config.not_configured')}</Text>
          </Box>
        ))}
      </Box>

      {/* 配置说明 */}
      <Box marginBottom={1}>
        <Text color="gray" italic>
          {t('bots_config.edit_hint')}
        </Text>
      </Box>

      {/* 操作提示 */}
      <Box>
        <Text color="gray" dimColor>
          {t('bots_config.hint')}
        </Text>
      </Box>
    </Box>
  );
}
