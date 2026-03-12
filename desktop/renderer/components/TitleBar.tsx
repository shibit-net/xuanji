// ============================================================
// TitleBar - 标题栏组件
// ============================================================

import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

export default function TitleBar() {
  const stats = useChatStore((state) => state.stats);

  const handleMinimize = () => {
    window.electron?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.maximize();
  };

  const handleClose = () => {
    window.electron?.close();
  };

  return (
    <div className="h-10 bg-bg-secondary flex items-center justify-between px-4 select-none drag">
      {/* 左侧：应用标题 */}
      <div className="flex items-center gap-2">
        <div className="text-primary font-bold">⭐ Xuanji</div>
        <div className="text-text-secondary text-sm">·</div>
        <div className="text-text-secondary text-sm">新对话</div>
      </div>

      {/* 中间：模型信息（从 store 读取） */}
      <div className="flex items-center gap-4 text-sm text-text-secondary">
        <div>{stats.model}</div>
        <div>↑{stats.tokenUsage.input.toLocaleString()} ↓{stats.tokenUsage.output.toLocaleString()}</div>
        <div>${stats.cost.toFixed(4)}</div>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center gap-2 no-drag">
        <button
          onClick={handleMinimize}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          title="最小化"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          title="最大化"
        >
          <Square size={16} />
        </button>
        <button
          onClick={handleClose}
          className="p-1 hover:bg-error/80 rounded transition-colors"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
