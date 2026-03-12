// ============================================================
// M1 终端 UI — TODO 进度面板
// ============================================================
// 将 todo_create / todo_update 工具结果中的结构化进度数据
// 渲染为可视化的任务列表，替代纯文本的工具结果显示。

import React from 'react';
import { Box, Text } from 'ink';

// ============================================================
// 类型定义
// ============================================================

/** 单个 TODO 任务（从 JSON 中解析） */
export interface TodoItem {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/** 从工具结果中提取的 TODO 进度数据 */
export interface TodoProgressData {
  completed: number;
  total: number;
  items: TodoItem[];
  /** 工具操作摘要（如 "✅ 已创建: Fix auth bug (todo-001)"） */
  action?: string;
}

// ============================================================
// JSON 标记解析
// ============================================================

/**
 * 用于在工具结果中标记结构化 TODO 进度数据的 tag
 *
 * 格式：
 * 操作摘要文本
 * <!--TODO_PROGRESS:{"completed":1,"total":3,"items":[...]}-->
 */
const TODO_PROGRESS_TAG = '<!--TODO_PROGRESS:';
const TODO_PROGRESS_TAG_END = '-->';

/**
 * 从工具结果字符串中提取 TODO 进度数据
 * @returns 解析成功返回 TodoProgressData，失败返回 null
 */
export function parseTodoProgress(result: string): TodoProgressData | null {
  const tagStart = result.indexOf(TODO_PROGRESS_TAG);
  if (tagStart === -1) return null;

  const jsonStart = tagStart + TODO_PROGRESS_TAG.length;
  const jsonEnd = result.indexOf(TODO_PROGRESS_TAG_END, jsonStart);
  if (jsonEnd === -1) return null;

  try {
    const jsonStr = result.slice(jsonStart, jsonEnd);
    const data = JSON.parse(jsonStr) as TodoProgressData;

    // 提取 action（标记之前的文本）
    const actionText = result.slice(0, tagStart).trim();
    if (actionText) {
      data.action = actionText;
    }

    return data;
  } catch {
    return null;
  }
}

// ============================================================
// 进度条渲染
// ============================================================

/** 生成文本进度条 */
function renderProgressBar(completed: number, total: number, width: number = 20): string {
  if (total === 0) return '░'.repeat(width);
  const filled = Math.round((completed / total) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ============================================================
// TodoPanel 组件
// ============================================================

export interface TodoPanelProps {
  data: TodoProgressData;
}

/**
 * TodoPanel — TODO 进度可视化面板
 *
 * 显示：
 * ┌─ 📋 任务进度 [2/5] ██████████░░░░░░░░░░ ─┐
 * │ ✔ 已完成的任务                              │
 * │ ⟳ 正在执行的任务 (执行中文案)                │
 * │ ☐ 待执行的任务                              │
 * └─────────────────────────────────────────────┘
 */
export const TodoPanel = React.memo(function TodoPanel({ data }: TodoPanelProps) {
  const { completed, total, items, action } = data;
  const allDone = completed === total && total > 0;

  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* 操作摘要行（如 "✅ 已创建: Fix auth bug"） */}
      {action && (
        <Text color="gray" dimColor>{action}</Text>
      )}

      {/* 进度头部 */}
      <Box>
        <Text color={allDone ? 'green' : 'cyan'} bold>
          📋 任务进度{' '}
        </Text>
        <Text color={allDone ? 'green' : 'white'} bold>
          [{completed}/{total}]
        </Text>
        <Text> </Text>
        <Text color={allDone ? 'green' : 'cyan'}>
          {renderProgressBar(completed, total, 16)}
        </Text>
      </Box>

      {/* 任务列表 */}
      {items.map((item, i) => {
        const icon =
          item.status === 'completed' ? '✔' :
          item.status === 'in_progress' ? '⟳' : '☐';

        const iconColor =
          item.status === 'completed' ? 'green' :
          item.status === 'in_progress' ? 'cyan' : 'gray';

        const textDim = item.status === 'completed';

        // activeForm 后缀（仅 in_progress 时显示）
        const suffix = item.status === 'in_progress' && item.activeForm
          ? ` (${item.activeForm})`
          : '';

        return (
          <Box key={i} marginLeft={1}>
            <Text color={iconColor}>{icon} </Text>
            <Text dimColor={textDim}>
              {item.title}{suffix}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});
