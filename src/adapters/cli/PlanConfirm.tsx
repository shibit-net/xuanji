// ============================================================
// 执行计划确认对话框
// ============================================================

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ExecutionPlan } from '@/core/routing/types';

export interface PlanConfirmProps {
  plan: ExecutionPlan;
  onConfirm: (confirmed: boolean) => void;
}

/**
 * 执行计划确认对话框
 * 显示任务分解计划，让用户确认是否执行
 */
export function PlanConfirm({ plan, onConfirm }: PlanConfirmProps) {
  const [input, setInput] = useState('');

  useInput((char, key) => {
    if (key.return) {
      const normalized = input.trim().toLowerCase();
      if (normalized === 'y' || normalized === 'yes' || normalized === 'confirm') {
        onConfirm(true);
      } else if (normalized === 'n' || normalized === 'no' || normalized === 'cancel') {
        onConfirm(false);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (!key.ctrl && !key.meta && char) {
      setInput((prev) => prev + char);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="yellow">
      <Box marginBottom={1}>
        <Text bold color="yellow">📋 执行计划确认</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>任务: {plan.taskDescription}</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold>计划步骤 ({plan.steps.length} 步):</Text>
        {plan.steps.map((step, idx) => (
          <Box key={idx} marginLeft={2}>
            <Text>
              {step.order}. {step.description}
              {step.agentId && <Text dimColor> [{step.agentId}]</Text>}
              {step.dependsOn && step.dependsOn.length > 0 && (
                <Text dimColor> (依赖: {step.dependsOn.join(', ')})</Text>
              )}
            </Text>
          </Box>
        ))}
      </Box>

      {plan.requiredAgents.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold>需要的 Agent:</Text>
          {plan.requiredAgents.map((agent, idx) => (
            <Box key={idx} marginLeft={2}>
              <Text>• {agent.name} - {agent.role}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginBottom={1}>
        <Text dimColor>预估耗时: ~{plan.estimatedTotalDuration}秒</Text>
        {plan.estimatedTokens && (
          <Text dimColor> | 预估消耗: ~{plan.estimatedTokens} tokens</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text color="yellow">是否执行此计划? (y/n): </Text>
        <Text color="cyan">{input}</Text>
      </Box>

      <Box>
        <Text dimColor>提示: 输入 y 确认 / n 取消，按 Enter 提交</Text>
      </Box>
    </Box>
  );
}
