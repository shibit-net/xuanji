// ============================================================
// Xuanji Desktop - StatusBar 组件（新架构）
// ============================================================
// 职责：
// - 显示当前状态（空闲、思考中、执行中）
// - 显示当前会话信息
// - 显示 Checkpoint 数量
// ============================================================

import React from 'react';
import { useChatStore } from '../stores';
import { useHistoryStore } from '../stores';

export default function StatusBar() {
  const status = useChatStore((state) => state.status);
  const checkpoints = useHistoryStore((state) => state.checkpoints);

  const statusText = {
    idle: '空闲',
    thinking: '思考中...',
    executing: '执行中...',
  }[status];

  const statusColor = {
    idle: 'text-text-secondary',
    thinking: 'text-yellow-500',
    executing: 'text-green-500',
  }[status];

  return (
    <div className="h-6 bg-bg-secondary border-t border-bg-tertiary flex items-center justify-between px-4 text-xs text-text-secondary">
      {/* 左侧：状态 */}
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-1 ${statusColor}`}>
          <div className="w-2 h-2 rounded-full bg-current" />
          <span>{statusText}</span>
        </div>
      </div>

      {/* 右侧：统计信息 */}
      <div className="flex items-center gap-4">
        {checkpoints.length > 0 && (
          <div>Checkpoint: {checkpoints.length}</div>
        )}
        <div>已连接</div>
      </div>
    </div>
  );
}
