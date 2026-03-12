// ============================================================
// TitleBar - 标题栏组件
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Minus, Square, X, ChevronDown, Shrink, Activity, Stethoscope, PanelRight } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

interface TitleBarProps {
  onCompact?: () => void;
  onShowStats?: () => void;
  onShowDiagnostics?: () => void;
  onToggleRightPanel?: () => void;
}

export default function TitleBar({ onCompact, onShowStats, onShowDiagnostics, onToggleRightPanel }: TitleBarProps) {
  const stats = useChatStore((state) => state.stats);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleMinimize = () => {
    window.electron?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.maximize();
  };

  const handleClose = () => {
    window.electron?.close();
  };

  const menuItems = [
    { icon: <Shrink size={14} />, label: '压缩上下文', action: onCompact },
    { icon: <Activity size={14} />, label: '使用统计', action: onShowStats },
    { icon: <Stethoscope size={14} />, label: '系统诊断', action: onShowDiagnostics },
    { icon: <PanelRight size={14} />, label: '右侧面板', action: onToggleRightPanel },
  ];

  return (
    <div className="h-10 bg-bg-secondary flex items-center justify-between px-4 select-none drag">
      {/* 左侧：应用标题 + 功能菜单 */}
      <div className="flex items-center gap-2">
        <div className="text-primary font-bold">⭐ Xuanji</div>
        <div className="text-text-secondary text-sm">·</div>

        {/* 功能菜单 */}
        <div className="relative no-drag" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1 px-2 py-0.5 text-sm text-text-secondary hover:bg-bg-tertiary rounded transition-colors"
          >
            <span>功能</span>
            <ChevronDown size={12} />
          </button>
          {menuOpen && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-bg-secondary border border-bg-tertiary rounded-lg shadow-lg z-50 py-1">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setMenuOpen(false);
                    item.action?.();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
