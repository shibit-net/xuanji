// ============================================================
// StatusBar - 状态栏组件
// ============================================================

import React from 'react';
import { useChatStore } from '../stores/chatStore';

export default function StatusBar() {
  const stats = useChatStore((state) => state.stats);
  const currentSkill = useChatStore((state) => state.currentSkill);

  return (
    <div className="h-7 bg-bg-secondary border-t border-bg-tertiary flex items-center justify-between px-4 text-xs text-text-secondary">
      {/* 左侧：当前 Skill + 模型 */}
      <div className="flex items-center gap-4">
        {currentSkill && (
          <>
            <div className="flex items-center gap-2">
              <span>{currentSkill.icon}</span>
              <span>{currentSkill.name}</span>
            </div>
            <div>·</div>
          </>
        )}
        <div>{stats.model}</div>
      </div>

      {/* 右侧：Token 统计 */}
      <div className="flex items-center gap-4">
        <div>
          ↑{stats.tokenUsage.input.toLocaleString()} ↓{stats.tokenUsage.output.toLocaleString()}
        </div>
        <div>${stats.cost.toFixed(4)}</div>
      </div>
    </div>
  );
}
