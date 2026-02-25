// ============================================================
// M5 权限控制 — 确认对话框 (Select 风格)
// ============================================================
//
// 使用上下箭头选择 + Enter 确认的 Select 组件风格。
// 两种类型的选项:
//   - 单次操作: 允许本次 / 拒绝本次
//   - 记住选择: 总是允许此类操作 / 总不允许此类操作
//
// 对于 danger 级别的操作，给出 ⛔ 极强警告提示（红色高亮）。
// 所有 UI 文本通过 i18n 国际化。
//

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '@/core/i18n';
import type { PermissionRequest, GuardCheckResult, UserConfirmation } from '../types';

interface PermissionPromptProps {
  /** 权限请求 */
  request: PermissionRequest;
  /** 守卫检查结果 */
  guardResult: GuardCheckResult;
  /** 确认回调 */
  onConfirm: (confirmation: UserConfirmation) => void;
}

/**
 * 选项定义
 */
interface PromptOption {
  labelKey: string;
  /** 快捷键 */
  hotkey: string;
  allowed: boolean;
  remember: boolean;
  color: string;
}

const OPTIONS: PromptOption[] = [
  { labelKey: 'perm.option_allow', hotkey: 'Y', allowed: true, remember: false, color: '#34D399' },
  { labelKey: 'perm.option_deny', hotkey: 'N', allowed: false, remember: false, color: '#F87171' },
  { labelKey: 'perm.option_always', hotkey: 'A', allowed: true, remember: true, color: '#60A5FA' },
  { labelKey: 'perm.option_never', hotkey: 'V', allowed: false, remember: true, color: '#FBBF24' },
];

/**
 * 格式化工具操作描述 (i18n)
 */
function formatOperation(request: PermissionRequest): string {
  const { toolName, input } = request;
  const filePath = String(input.file_path ?? input.path ?? '');
  switch (toolName) {
    case 'write_file':
      return t('perm.op_write_file', { path: filePath });
    case 'edit_file':
      return t('perm.op_edit_file', { path: filePath });
    case 'read_file':
      return t('perm.op_read_file', { path: filePath });
    case 'bash': {
      const cmd = String(input.command ?? input.cmd ?? '');
      return t('perm.op_bash', { cmd: cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd });
    }
    case 'glob':
      return t('perm.op_glob', { pattern: String(input.pattern ?? input.path ?? '') });
    case 'grep':
      return t('perm.op_grep', { pattern: String(input.pattern ?? '') });
    default:
      return t('perm.op_default', { name: toolName });
  }
}

/**
 * PermissionPrompt — 权限确认对话框
 *
 * Select 风格的选择器，支持:
 *   - ↑↓ 上下箭头选择
 *   - Enter 确认选择
 *   - Y/N/A/V 快捷键直接选择
 *   - Esc 等同于拒绝本次
 */
export function PermissionPrompt({ request, guardResult, onConfirm }: PermissionPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isDanger = guardResult.riskLevel === 'danger';
  const isWarn = guardResult.riskLevel === 'warn';

  // 翻译选项标签 (useMemo 避免每次渲染重复调用 t())
  const translatedOptions = useMemo(
    () => OPTIONS.map((opt) => ({ ...opt, label: t(opt.labelKey) })),
    [],
  );

  useInput((input, key) => {
    // ↑: 上一个选项
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    // ↓: 下一个选项
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(OPTIONS.length - 1, prev + 1));
      return;
    }

    // Enter: 确认当前选择
    if (key.return) {
      const option = OPTIONS[selectedIndex];
      onConfirm({ allowed: option.allowed, remember: option.remember });
      return;
    }

    // Esc: 拒绝本次
    if (key.escape) {
      onConfirm({ allowed: false, remember: false });
      return;
    }

    // 快捷键
    const upperInput = input.toUpperCase();
    const optionIndex = OPTIONS.findIndex((o) => o.hotkey === upperInput);
    if (optionIndex !== -1) {
      const option = OPTIONS[optionIndex];
      onConfirm({ allowed: option.allowed, remember: option.remember });
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isDanger ? 'red' : isWarn ? 'yellow' : 'cyan'} paddingX={1}>
      {/* 标题行 */}
      <Box>
        {isDanger ? (
          <Text color="red" bold>{t('perm.title_danger')}</Text>
        ) : isWarn ? (
          <Text color="yellow" bold>{t('perm.title_warn')}</Text>
        ) : (
          <Text color="cyan" bold>{t('perm.title_safe')}</Text>
        )}
      </Box>

      {/* 操作描述 */}
      <Box marginTop={1}>
        <Text color="white" bold>{t('perm.label_operation')}: </Text>
        <Text>{formatOperation(request)}</Text>
      </Box>

      {/* 风险描述 */}
      <Box>
        <Text color="white" bold>{t('perm.label_reason')}: </Text>
        <Text color={isDanger ? 'red' : isWarn ? 'yellow' : 'white'}>
          {guardResult.description}
        </Text>
      </Box>

      {/* danger 级别额外强警告 */}
      {isDanger && (
        <Box marginTop={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red" bold>
            {t('perm.danger_warning')}
          </Text>
        </Box>
      )}

      {/* 选项列表 */}
      <Box marginTop={1} flexDirection="column">
        {translatedOptions.map((option, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={option.hotkey}>
              <Text color={isSelected ? option.color : 'gray'} bold={isSelected}>
                {isSelected ? '▶ ' : '  '}
                [{option.hotkey}] {option.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {t('perm.hint')}
        </Text>
      </Box>
    </Box>
  );
}
