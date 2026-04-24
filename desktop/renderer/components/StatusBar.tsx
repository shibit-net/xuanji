// ============================================================
// StatusBar - 状态栏组件
// ============================================================

import { useChatStore } from '../stores/chatStore';
import { DownloadQueue } from './DownloadQueue';

export default function StatusBar() {
  const stats = useChatStore((state) => state.stats);
  const currentSkill = useChatStore((state) => state.currentSkill);
  const isPlanMode = useChatStore((state) => state.isPlanMode);

  return (
    <div className="flex-shrink-0 h-7 bg-bg-secondary border-t border-bg-tertiary flex items-center justify-between px-4 text-xs text-text-secondary">
      {/* 左侧：Plan Mode 徽标 + 当前 Skill */}
      <div className="flex items-center gap-4">
        {isPlanMode && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-semibold tracking-wide">
            📋 PLAN MODE
          </span>
        )}
        {currentSkill && (
          <div className="flex items-center gap-2">
            <span>{currentSkill.icon}</span>
            <span>{currentSkill.name}</span>
          </div>
        )}
      </div>

      {/* 右侧：下载队列 */}
      <DownloadQueue />
    </div>
  );
}
