// ============================================================
// M1 终端 UI — 设置模式主组件
// ============================================================

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '@/core/i18n';
import type { SettingsTab } from '../types';
import { LlmSettings } from './LlmSettings';
import { UiSettings } from './UiSettings';
import { BotsConfigPanel } from './BotsConfigPanel';
import { ConfigManager } from '../utils/ConfigManager';

interface SettingsModeProps {
  onExit: () => void;
  configManager: ConfigManager;
}

const TABS: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'llm', label: t('settings.tab.llm'), icon: '🤖' },
  { id: 'ui', label: t('settings.tab.ui'), icon: '🎨' },
  { id: 'bots_config', label: t('settings.tab.bots'), icon: '💬' },
];

/**
 * SettingsMode — 设置模式主组件
 * 显示标签页菜单，支持 ↑↓ 导航 + Enter 进入 + Q/Esc 返回
 */
export function SettingsMode({ onExit, configManager }: SettingsModeProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<SettingsTab | null>(null);

  // 从子面板返回
  const handleBack = () => {
    setActiveTab(null);
  };

  // 键盘交互（仅在菜单级别生效）
  useInput((input, key) => {
    // 只在菜单级别处理按键，子面板有自己的键盘处理
    if (activeTab !== null) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(TABS.length - 1, prev + 1));
      return;
    }

    // Enter 进入选中的标签页
    if (key.return) {
      setActiveTab(TABS[selectedIndex].id);
      return;
    }

    // 数字键快速跳转
    if (input === '1') { setActiveTab('llm'); return; }
    if (input === '2') { setActiveTab('ui'); return; }
    if (input === '3') { setActiveTab('bots_config'); return; }

    // Q/Esc 返回对话模式
    if (input === 'q' || input === 'Q' || key.escape) {
      onExit();
      return;
    }
  });

  // 渲染子面板
  if (activeTab === 'llm') {
    return <LlmSettings onBack={handleBack} configManager={configManager} />;
  }
  if (activeTab === 'ui') {
    return <UiSettings onBack={handleBack} configManager={configManager} />;
  }
  if (activeTab === 'bots_config') {
    return <BotsConfigPanel onBack={handleBack} configManager={configManager} />;
  }

  // 渲染菜单
  return (
    <Box flexDirection="column">
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">{t('settings.title')}</Text>
      </Box>

      {/* 标签页菜单 */}
      <Box marginBottom={1} flexDirection="column">
        {TABS.map((tab, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={tab.id}>
              <Text color={isSelected ? '#7C8CF5' : 'gray'} bold={isSelected}>
                {isSelected ? '▶ ' : '  '}
                {tab.icon} {tab.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* 操作提示 */}
      <Box>
        <Text color="gray" dimColor>{t('settings.hint')}</Text>
      </Box>
    </Box>
  );
}
