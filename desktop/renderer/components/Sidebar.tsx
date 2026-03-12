// ============================================================
// Sidebar - 左侧边栏组件（会话列表 + 导航）
// ============================================================

import React from 'react';
import { Search, Plus, Settings, HelpCircle } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

interface SidebarProps {
  onToggle: () => void;
  onOpenSettings: () => void;
}

export default function Sidebar({ onToggle, onOpenSettings }: SidebarProps) {
  const reset = useChatStore((state) => state.reset);

  const handleNewChat = () => {
    reset();
  };

  return (
    <div className="w-56 bg-bg-secondary flex flex-col border-r border-bg-tertiary">
      {/* 搜索框 */}
      <div className="p-3 border-b border-bg-tertiary">
        <div className="relative">
          <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="搜索会话..."
            className="w-full bg-bg-primary border border-bg-tertiary rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-xs text-text-secondary px-2 py-1 mb-1">📅 今天</div>

        <div className="mb-1">
          <button className="w-full text-left px-3 py-2 rounded bg-bg-tertiary transition-colors group">
            <div className="text-sm text-text-primary truncate">新对话</div>
            <div className="text-xs text-text-secondary">刚刚</div>
          </button>
        </div>
      </div>

      {/* 底部快捷入口 */}
      <div className="border-t border-bg-tertiary p-2 space-y-1">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Plus size={16} className="text-primary" />
          <span>新建会话</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Settings size={16} className="text-text-secondary" />
          <span>设置</span>
        </button>

        <button className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm">
          <HelpCircle size={16} className="text-text-secondary" />
          <span>帮助</span>
        </button>
      </div>
    </div>
  );
}
