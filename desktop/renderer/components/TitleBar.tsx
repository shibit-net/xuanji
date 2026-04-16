// ============================================================
// TitleBar - 标题栏组件
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

interface TitleBarProps {
  onCompact?: () => void;
  onShowStats?: () => void;
  onShowDiagnostics?: () => void;
  onToggleRightPanel?: () => void;
}

export default function TitleBar({ onCompact, onShowStats, onShowDiagnostics, onToggleRightPanel }: TitleBarProps) {
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
    <div className="flex-shrink-0 h-10 bg-bg-secondary flex items-center justify-between px-4 select-none drag">
      {/* 左侧：占位 */}
      <div className="w-20"></div>

      {/* 中间：应用名称 */}
      <div className="flex items-center gap-2">
        <div className="text-primary font-bold text-lg">璇玑</div>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={handleMinimize}
          className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
          title="最小化"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
          title="最大化"
        >
          <Square size={14} />
        </button>
        <button
          onClick={handleClose}
          className="p-1.5 hover:bg-red-500/80 hover:text-white rounded transition-colors"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
