// ============================================================
// M1 终端 UI — 界面设置子面板
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { t, setLanguage, getLanguage } from '@/core/i18n';
import type { UITheme, UILanguage, AppConfig } from '@/core/types';
import { ConfigManager } from '../utils/ConfigManager';

interface UiSettingsProps {
  onBack: () => void;
  configManager: ConfigManager;
}

/**
 * UiSettings — 界面设置面板
 * 支持主题切换（深色/浅色/自动）和语言切换（中文/English）
 */
export function UiSettings({ onBack, configManager }: UiSettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedTab, setSelectedTab] = useState<'theme' | 'language'>('theme');
  const [themeSelectedIndex, setThemeSelectedIndex] = useState(0);
  const [langSelectedIndex, setLangSelectedIndex] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  const themes: Array<{ id: UITheme; label: string; description: string }> = [
    { id: 'dark', label: t('ui.theme_dark'), description: t('ui.theme_dark_desc') },
    { id: 'light', label: t('ui.theme_light'), description: t('ui.theme_light_desc') },
    { id: 'auto', label: t('ui.theme_auto'), description: t('ui.theme_auto_desc') },
  ];

  const languages: Array<{ id: UILanguage; label: string; description: string }> = [
    { id: 'zh', label: t('ui.lang_zh'), description: t('ui.lang_zh_desc') },
    { id: 'en', label: t('ui.lang_en'), description: t('ui.lang_en_desc') },
  ];

  useEffect(() => {
    try {
      const current = configManager.getConfig();
      setConfig(current);
      // 初始化选中项为当前主题
      const themeIdx = themes.findIndex((t) => t.id === current.ui.theme);
      if (themeIdx >= 0) setThemeSelectedIndex(themeIdx);
      // 初始化选中项为当前语言
      const langIdx = languages.findIndex((l) => l.id === current.ui.language || 'en');
      if (langIdx >= 0) setLangSelectedIndex(langIdx);
    } catch {
      setSaveStatus('error');
      setSaveMessage(t('ui.config_load_failed'));
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
      setSaveMessage(t('ui.theme_changed', { theme }));
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setSaveMessage(error instanceof Error ? error.message : t('ui.switch_failed'));
    }
  };

  const handleSelectLanguage = async (lang: UILanguage) => {
    if (!config) return;
    try {
      setLanguage(lang);
      const newConfig: Partial<AppConfig> = {
        ui: { ...config.ui, language: lang },
      };
      await configManager.save(newConfig);
      setConfig({ ...config, ui: { ...config.ui, language: lang } });
      setSaveStatus('success');
      const langLabel = lang === 'zh' ? t('ui.lang_zh') : t('ui.lang_en');
      setSaveMessage(t('ui.language_changed', { lang: langLabel }));
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setSaveMessage(error instanceof Error ? error.message : t('ui.switch_failed'));
    }
  };

  // 键盘交互
  useInput((input, key) => {
    // 数字键快速选择
    if (input === '1') { handleSelectTheme('dark'); return; }
    if (input === '2') { handleSelectTheme('light'); return; }
    if (input === '3') { handleSelectTheme('auto'); return; }

    // Tab 或左右箭头切换标签页
    if (input === '\t' || key.rightArrow) {
      setSelectedTab(selectedTab === 'theme' ? 'language' : 'theme');
      return;
    }
    if (key.leftArrow) {
      setSelectedTab(selectedTab === 'language' ? 'theme' : 'language');
      return;
    }

    // 上下键导航
    if (key.upArrow) {
      if (selectedTab === 'theme') {
        setThemeSelectedIndex((prev) => Math.max(0, prev - 1));
      } else {
        setLangSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (selectedTab === 'theme') {
        setThemeSelectedIndex((prev) => Math.min(themes.length - 1, prev + 1));
      } else {
        setLangSelectedIndex((prev) => Math.min(languages.length - 1, prev + 1));
      }
      return;
    }

    // Enter 选择当前高亮项
    if (key.return) {
      if (selectedTab === 'theme') {
        const theme = themes[themeSelectedIndex];
        if (theme) handleSelectTheme(theme.id);
      } else {
        const lang = languages[langSelectedIndex];
        if (lang) handleSelectLanguage(lang.id);
      }
      return;
    }

    // Q/Esc 返回
    if (input === 'q' || input === 'Q' || key.escape) {
      onBack();
      return;
    }
  });

  if (!config) {
    return <Text color="gray">{t('ui.loading_config')}</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">{t('ui.theme_title')}</Text>
      </Box>

      {/* 主题选项 */}
      <Box marginBottom={1} flexDirection="column">
        {themes.map((theme, i) => {
          const isCurrent = config.ui.theme === theme.id;
          const isSelected = selectedTab === 'theme' && i === themeSelectedIndex;
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

      {/* 语言设置 */}
      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="#7C8CF5">{t('ui.language_title')}</Text>
        </Box>
        {languages.map((lang, i) => {
          const isCurrent = (config.ui.language || 'en') === lang.id;
          const isSelected = selectedTab === 'language' && i === langSelectedIndex;
          return (
            <Box key={lang.id}>
              <Text color={isSelected ? '#7C8CF5' : 'gray'} bold={isSelected}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text color={isSelected ? '#7C8CF5' : undefined} bold={isSelected}>
                {lang.label}
              </Text>
              <Text color="gray"> — {lang.description}</Text>
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

      {/* 操作提示 */}
      <Box>
        <Text color="gray" dimColor>
          ↑↓ Navigate  ← → Switch tab  Enter Confirm  Q=Back
        </Text>
      </Box>
    </Box>
  );
}
