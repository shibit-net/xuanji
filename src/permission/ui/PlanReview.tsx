// ============================================================
// M5 权限控制 — 计划审查对话框
// ============================================================
//
// LLM 自行判断何时需要计划审查，通过 plan_review 工具触发。
// 展示 LLM 生成的计划文本（markdown），让用户选择:
//   - 确认执行
//   - 拒绝执行
//   - 补充说明后让 LLM 重新规划
//

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '@/core/i18n';
import { renderMarkdownSimple } from '@/adapters/cli/MarkdownRenderer';
import type { PlanReviewResult } from '../types';

interface PlanReviewProps {
  /** LLM 生成的计划文本 (markdown) */
  plan: string;
  /** 用户决策回调 */
  onDecision: (result: PlanReviewResult) => void;
}

/** 选项定义 */
interface ReviewOption {
  labelKey: string;
  hotkey: string;
  color: string;
}

const OPTIONS: ReviewOption[] = [
  { labelKey: 'plan.option_approve', hotkey: 'Y', color: '#34D399' },
  { labelKey: 'plan.option_reject', hotkey: 'N', color: '#F87171' },
  { labelKey: 'plan.option_supplement', hotkey: 'S', color: '#60A5FA' },
];

/**
 * PlanReview — 计划审查对话框
 *
 * LLM 通过 plan_review 工具提交计划文本，本组件展示并等待用户决策。
 * 支持:
 *   - ↑↓ 选择 + Enter 确认
 *   - Y/N/S 快捷键
 *   - S 进入补充文本输入模式
 *
 * 使用 React.memo 避免父组件 state 变化导致不必要的重渲染，
 * 减少 Ink 动态区域重绘次数，防止终端输出闪烁/堆叠。
 */
export const PlanReview = React.memo(function PlanReview({ plan, onDecision }: PlanReviewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSupplementMode, setIsSupplementMode] = useState(false);
  const [supplementText, setSupplementText] = useState('');

  // 翻译选项标签
  const translatedOptions = useMemo(
    () => OPTIONS.map((opt) => ({ ...opt, label: t(opt.labelKey) })),
    [],
  );

  // 渲染计划 markdown
  const renderedPlan = useMemo(
    () => renderMarkdownSimple(plan),
    [plan],
  );

  useInput((input, key) => {
    // 补充输入模式
    if (isSupplementMode) {
      if (key.return) {
        if (supplementText.trim()) {
          onDecision({ decision: 'supplement', supplementText: supplementText.trim() });
        }
        return;
      }
      if (key.escape) {
        setIsSupplementMode(false);
        setSupplementText('');
        return;
      }
      if (key.backspace || key.delete) {
        setSupplementText((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSupplementText((prev) => prev + input);
      }
      return;
    }

    // 正常选择模式
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(OPTIONS.length - 1, prev + 1));
      return;
    }

    if (key.return) {
      const option = OPTIONS[selectedIndex];
      if (option.hotkey === 'S') {
        setIsSupplementMode(true);
        return;
      }
      onDecision({
        decision: option.hotkey === 'Y' ? 'approve' : 'reject',
      });
      return;
    }

    if (key.escape) {
      onDecision({ decision: 'reject' });
      return;
    }

    const upper = input.toUpperCase();
    if (upper === 'Y') {
      onDecision({ decision: 'approve' });
      return;
    }
    if (upper === 'N') {
      onDecision({ decision: 'reject' });
      return;
    }
    if (upper === 'S') {
      setIsSupplementMode(true);
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {/* 标题 */}
      <Box>
        <Text bold color="cyan">{t('plan.title')}</Text>
      </Box>

      {/* 计划内容 (markdown 渲染) */}
      <Box marginTop={1} flexDirection="column" marginLeft={1}>
        {renderedPlan.map((line, i) => (
          <Box key={i}>
            <Text>{line}</Text>
          </Box>
        ))}
      </Box>

      {/* 选项列表 (非补充输入模式时显示) */}
      {!isSupplementMode && (
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
      )}

      {/* 补充输入模式 */}
      {isSupplementMode && (
        <Box marginTop={1} flexDirection="column">
          <Text color="#60A5FA" bold>{t('plan.supplement_prompt')}</Text>
          <Box marginTop={1}>
            <Text color="#60A5FA">{'> '}</Text>
            <Text>{supplementText}</Text>
            <Text color="gray">{'█'}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>{t('plan.supplement_hint')}</Text>
          </Box>
        </Box>
      )}

      {/* 操作提示 (非补充输入模式) */}
      {!isSupplementMode && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {t('plan.hint')}
          </Text>
        </Box>
      )}
    </Box>
  );
});