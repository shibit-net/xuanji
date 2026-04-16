// ============================================================
// M1 终端 UI — LLM 配置子面板
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '@/core/i18n';
import type { AppConfig } from '@/core/types';
import { ConfigManager } from '../utils/ConfigManager';

interface LlmSettingsProps {
  onBack: () => void;
  configManager: ConfigManager;
}

type EditableField = 'model' | 'apiKey' | 'adapter' | 'baseURL';

const FIELD_ITEMS: Array<{ key: EditableField; label: string; shortcut: string }> = [
  { key: 'model', label: t('llm.field_model'), shortcut: '1' },
  { key: 'apiKey', label: t('llm.field_apikey'), shortcut: '2' },
  { key: 'adapter', label: t('llm.field_adapter'), shortcut: '3' },
  { key: 'baseURL', label: t('llm.field_baseurl'), shortcut: '4' },
];

/**
 * LlmSettings — LLM 配置编辑面板
 *
 * 交互流程：
 * 1. 展示当前配置（只读）
 * 2. 数字键 / ↑↓+Enter 选择字段进入编辑
 * 3. 键入新值，Enter 保存，Esc 取消
 */
export function LlmSettings({ onBack, configManager }: LlmSettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    try {
      const current = configManager.getConfig();
      setConfig(current);
    } catch {
      setSaveStatus('error');
      setSaveMessage(t('ui.config_load_failed'));
    }
  }, [configManager]);

  const maskApiKey = (key: string | undefined): string => {
    if (!key) return t('llm.not_set');
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '*'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
  };

  const getFieldValue = (field: EditableField): string => {
    if (!config) return '';
    switch (field) {
      case 'model': return config.provider.model || '';
      case 'apiKey': return config.provider.apiKey || '';
      case 'adapter': return config.provider.adapter || '';
      case 'baseURL': return config.provider.baseURL || '';
    }
  };

  const getFieldDisplay = (field: EditableField): string => {
    if (!config) return t('llm.not_loaded');
    switch (field) {
      case 'model': return config.provider.model || t('llm.not_set');
      case 'apiKey': return maskApiKey(config.provider.apiKey);
      case 'adapter': return config.provider.adapter || t('llm.auto');
      case 'baseURL': return config.provider.baseURL || 'https://api.anthropic.com';
    }
  };

  const startEditing = (field: EditableField) => {
    setEditingField(field);
    setEditValue(getFieldValue(field));
    setSaveStatus('idle');
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveField = async () => {
    if (!editingField || !config) return;

    const trimmedValue = editValue.trim();
    if (!trimmedValue) {
      cancelEditing();
      return;
    }

    try {
      const newProvider = { ...config.provider };
      switch (editingField) {
        case 'model': newProvider.model = trimmedValue; break;
        case 'apiKey': newProvider.apiKey = trimmedValue; break;
        case 'adapter': newProvider.adapter = trimmedValue; break;
        case 'baseURL': newProvider.baseURL = trimmedValue; break;
      }

      await configManager.save({ provider: newProvider });
      setConfig({ ...config, provider: newProvider });

      const fieldLabel = FIELD_ITEMS.find((f) => f.key === editingField)?.label ?? editingField;
      setSaveStatus('success');
      setSaveMessage(t('llm.saved', { field: fieldLabel }));
      setEditingField(null);
      setEditValue('');

      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setSaveMessage(error instanceof Error ? error.message : t('llm.save_failed'));
    }
  };

  // 键盘交互
  useInput((input, key) => {
    // ---- 编辑模式 ----
    if (editingField) {
      if (key.return) {
        saveField();
        return;
      }
      if (key.escape) {
        cancelEditing();
        return;
      }
      if (key.backspace || key.delete) {
        setEditValue((prev) => prev.slice(0, -1));
        return;
      }
      // 普通字符
      if (input && !key.ctrl && !key.meta) {
        setEditValue((prev) => prev + input);
      }
      return;
    }

    // ---- 菜单模式 ----
    // 数字键快速进入编辑
    if (input === '1') { startEditing('model'); return; }
    if (input === '2') { startEditing('apiKey'); return; }
    if (input === '3') { startEditing('adapter'); return; }
    if (input === '4') { startEditing('baseURL'); return; }

    // 上下键导航
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(FIELD_ITEMS.length - 1, prev + 1));
      return;
    }

    // Enter 编辑选中项
    if (key.return) {
      startEditing(FIELD_ITEMS[selectedIndex].key);
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
        <Text bold color="#7C8CF5">{t('llm.title')}</Text>
      </Box>

      {/* 配置项列表 */}
      <Box marginBottom={1} flexDirection="column">
        {FIELD_ITEMS.map((item, i) => {
          const isSelected = i === selectedIndex;
          const isEditing = editingField === item.key;
          return (
            <Box key={item.key}>
              <Text color={isSelected ? '#7C8CF5' : 'gray'} bold={isSelected}>
                {isSelected ? '▶ ' : '  '}
                {item.shortcut}. {item.label}:
              </Text>
              <Text> </Text>
              {isEditing ? (
                <Box>
                  <Text color="#FBBF24">{editValue}</Text>
                  <Text color="#FBBF24">█</Text>
                </Box>
              ) : (
                <Text>{getFieldDisplay(item.key)}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 编辑提示 */}
      {editingField && (
        <Box marginBottom={1}>
          <Text color="#FBBF24" dimColor>
            {t('llm.edit_hint')}
          </Text>
        </Box>
      )}

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
      {!editingField && (
        <Box>
          <Text color="gray" dimColor>
            {t('llm.hint')}
          </Text>
        </Box>
      )}
    </Box>
  );
}
