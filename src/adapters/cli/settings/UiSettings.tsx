// ============================================================
// M1 终端 UI — 界面设置子面板
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { UITheme, AppConfig } from '@/core/types';
import { ConfigManager } from '../utils/ConfigManager';

interface UiSettingsProps {
  onBack: () => void;
  configManager: ConfigManager;
}

/**
 * UiSettings — 界面设置面板
 * 支持主题切换（深色/浅色/自动）
 */
export function UiSettings({ onBack, configManager }: UiSettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  const themes: Array<{ id: UITheme; label: string; description: string }> = [
    { id: 'dark', label: '深色', description: '深色主题（默认）' },
    { id: 'light', label: '浅色', description: '浅色主题' },
    { id: 'auto', label: '自动', description: '跟随系统设置' },
  ];

  useEffect(() => {
    try {
      const current = configManager.getConfig();
      setConfig(current);
      // 初始化选中项为当前主题
      const idx = themes.findIndex((t) => t.id === current.ui.theme);
      if (idx >= 0) setSelectedIndex(idx);
    } catch {
      setSaveStatus('error');
      setSaveMessage('配置加载失败');
    }
  }, [configManager]);

  const handleSelectTheme = async (theme: UITheme) => {
    if (!config) return;
    try {
      const newConfig: Partial<AppConfig> = {
        ui: { ...config.ui, theme },
      };
      await configManager.save(newConfig);
      setConfig({ ...config, ui: { ...config.ui, theme } });
      setSaveStatus('success');
      setSaveMessage(`主题已切换为 ${theme}`);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setSaveMessage(error instanceof Error ? error.message : '切换失败');
    }
  };

  // 键盘交互
  useInput((input, key) => {
    // 数字键快速选择
    if (input === '1') { handleSelectTheme('dark'); return; }
    if (input === '2') { handleSelectTheme('light'); return; }
    if (input === '3') { handleSelectTheme('auto'); return; }

    // 上下键导航
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(themes.length - 1, prev + 1));
      return;
    }

    // Enter 选择当前高亮项
    if (key.return) {
      const theme = themes[selectedIndex];
      if (theme) handleSelectTheme(theme.id);
      return;
    }

    // Q/Esc 返回
    if (input === 'q' || input === 'Q' || key.escape) {
      onBack();
      return;
    }
  });

  if (!config) {
    return <Text color="gray">加载配置中...</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">🎨 主题设置</Text>
      </Box>

      {/* 主题选项 */}
      <Box marginBottom={1} flexDirection="column">
        {themes.map((theme, i) => {
          const isCurrent = config.ui.theme === theme.id;
          const isSelected = i === selectedIndex;
          return (
            <Box key={theme.id}>
              <Text color={isSelected ? '#7C8CF5' : 'gray'} bold={isSelected}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text color={isSelected ? '#7C8CF5' : undefined} bold={isSelected}>
                {theme.label}
              </Text>
              <Text color="gray"> — {theme.description}</Text>
              {isCurrent && <Text color="#34D399"> ✓</Text>}
            </Box>
          );
        })}
      </Box>

      {/* 保存状态 */}
      {saveStatus === 'success' && (
        <Box marginBottom={1}>
          <Text color="#34D399">✓ {saveMessage}</Text>
        </Box>
      )}
      {saveStatus === 'error' && (
        <Box marginBottom={1}>
          <Text color="#F87171">✗ {saveMessage}</Text>
        </Box>
      )}

      {/* 其他设置选项 */}
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text bold color="#7C8CF5">其他设置</Text>
        <Box>
          <Text color="gray">• 显示 Token 用量: </Text>
          <Text>{config.ui.showTokenUsage ? '启用' : '禁用'}</Text>
        </Box>
        <Box>
          <Text color="gray">• 显示费用: </Text>
          <Text>{config.ui.showCost ? '启用' : '禁用'}</Text>
        </Box>
        <Box>
          <Text color="gray">• 显示思考过程: </Text>
          <Text>{config.ui.showThinking ? '启用' : '禁用'}</Text>
        </Box>
      </Box>

      {/* 操作提示 */}
      <Box>
        <Text color="gray" dimColor>
          ↑↓选择  Enter确认  1=深色 2=浅色 3=自动  Q=返回
        </Text>
      </Box>
    </Box>
  );
}
