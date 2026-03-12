// ============================================================
// SubAgent 执行进度显示组件
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type { SubAgentState } from './App';

interface SubAgentProgressProps {
  agents: Map<string, SubAgentState>;
}

/** 角色 → 图标 + 标签 */
function getRoleLabel(role: string): { icon: string; label: string; color: string } {
  switch (role) {
    case 'explore':
      return { icon: '🔍', label: 'Explore', color: '#60A5FA' };
    case 'plan':
      return { icon: '📐', label: 'Plan', color: '#A78BFA' };
    case 'coder':
      return { icon: '💻', label: 'Coder', color: '#34D399' };
    default:
      return { icon: '⚙️', label: 'Task', color: 'cyan' };
  }
}

export function SubAgentProgress({ agents }: SubAgentProgressProps) {
  // activeSubAgents 中只包含运行中的 SubAgent（完成时已从 Map 删除）
  const activeAgents = Array.from(agents.values());

  // 每 2 秒触发重渲染以更新经过时间（降低频率减少终端输出）
  const [, setTick] = useState(0);
  const hasActive = activeAgents.length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => setTick(t => t + 1), 2000);
    return () => clearInterval(timer);
  }, [hasActive]);

  if (activeAgents.length === 0) return null;

  const sorted = activeAgents.sort((a, b) => a.depth - b.depth);

  return (
    <Box flexDirection="column">
      {sorted.map(agent => {
        const elapsed = Math.floor((Date.now() - agent.startTime) / 1000);
        const { icon, label, color } = getRoleLabel(agent.role);
        const taskPreview = agent.task.slice(0, 40) + (agent.task.length > 40 ? '...' : '');
        const toolStatus = agent.lastToolName || '启动中';
        const stats = `${agent.toolCount} 步, ${elapsed}s`;

        return (
          <Box key={agent.subAgentId} marginLeft={agent.depth - 1}>
            <Text color={color}>{icon} {label}</Text>
            <Text color="gray" dimColor> │ </Text>
            <Text color="yellow">{taskPreview}</Text>
            <Text color="gray" dimColor> — {toolStatus} ({stats})</Text>
          </Box>
        );
      })}
    </Box>
  );
}
