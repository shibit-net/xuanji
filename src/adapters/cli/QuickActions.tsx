// ============================================================
// 快捷操作面板 — 交互式键盘驱动
// ============================================================
//
// 空闲时按 ? 触发，显示所有可用操作及快捷键。
// ↑↓ 导航、Enter 执行、Esc 关闭、数字/字母快捷键直接触发。

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from './Theme';

export interface QuickAction {
  /** 快捷键标签（如 'S', 'A', '1'） */
  key: string;
  /** 操作名称 */
  label: string;
  /** 简要描述 */
  description: string;
  /** 执行回调 */
  action: () => void;
  /** 分组标题（相邻相同 group 归为一组） */
  group?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 图标（emoji） */
  icon?: string;
  /** 优先级（越小越靠前） */
  priority?: number;
}

export interface QuickActionsProps {
  actions: QuickAction[];
  onClose: () => void;
}

export function QuickActions({ actions, onClose }: QuickActionsProps) {
  const theme = getTheme();
  
  // 排序和过滤
  const enabledActions = actions
    .filter(a => !a.disabled)
    .sort((a, b) => {
      // 按优先级排序
      const aPriority = a.priority ?? 999;
      const bPriority = b.priority ?? 999;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // 同优先级按 key 排序
      return a.key.localeCompare(b.key);
    });
    
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((ch, key) => {
    // Esc / Q 关闭
    if (key.escape || ch === 'q' || ch === 'Q') {
      onClose();
      return;
    }

    // ↑↓ 导航
    if (key.upArrow) {
      setSelectedIndex(i => (i - 1 + enabledActions.length) % enabledActions.length);
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => (i + 1) % enabledActions.length);
      return;
    }

    // Enter 执行选中项
    if (key.return) {
      if (enabledActions[selectedIndex]) {
        enabledActions[selectedIndex].action();
      }
      return;
    }

    // 快捷键匹配（不区分大小写）
    if (ch) {
      const upper = ch.toUpperCase();
      const match = enabledActions.find(a => a.key.toUpperCase() === upper);
      if (match) {
        match.action();
      }
    }
  });

  // 分组渲染
  let lastGroup = '';

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
        <Text color={theme.primary} bold>快捷操作</Text>
        <Text color="gray" dimColor>↑↓ 导航 · Enter 执行 · Esc 关闭</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {enabledActions.map((action, i) => {
          const showGroupHeader = action.group && action.group !== lastGroup;
          if (action.group) lastGroup = action.group;
          const isSelected = i === selectedIndex;

          return (
            <Box key={action.key} flexDirection="column">
              {/* 分组标题 */}
              {showGroupHeader && (
                <Box marginTop={i === 0 ? 0 : 1}>
                  <Text color="gray" dimColor bold>── {action.group} ──</Text>
                </Box>
              )}
              {/* 操作项 */}
              <Box>
                <Text color={isSelected ? theme.primary : 'gray'}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Box width={4}>
                  <Text color="yellow" bold>{action.key}</Text>
                </Box>
                <Box width={2}>
                  {action.icon && <Text>{action.icon}</Text>}
                </Box>
                <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                  {action.label}
                </Text>
                <Text color="gray" dimColor>  {action.description}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
