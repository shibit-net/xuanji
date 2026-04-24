// ============================================================
// Sidebar - 左侧边栏组件（导航入口）
// ============================================================
// 🆕 连续会话模式：移除会话列表，仅保留导航入口

import { Settings, HelpCircle, Bot, Wrench, FileText, Package, Brain, MessageSquare, LogOut, User as UserIcon, ChevronDown, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useState, useEffect, useRef } from 'react';

interface SidebarProps {
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  onOpenTools: () => void;
  onOpenSystemPrompt: () => void;
  onOpenMemory: () => void;
  onOpenPermissions: () => void;
}

export default function Sidebar({ onToggle: _onToggle, onOpenSettings, onOpenAgents, onOpenTools, onOpenSystemPrompt, onOpenMemory, onOpenPermissions }: SidebarProps) {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  const handleLogout = async () => {
    await logout();
    setShowUserMenu(false);
    // 刷新页面回到登录界面
    window.location.reload();
  };

  return (
    <div className="w-56 bg-bg-secondary flex flex-col border-r border-bg-tertiary">
      {/* 顶部：用户信息 */}
      {isAuthenticated && user && (
        <div className="p-4 border-b border-bg-tertiary">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors"
            >
              {user.avatar ? (
                <img src={user.avatar} alt={user.nickname || user.email} className="w-8 h-8 rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <UserIcon size={16} className="text-primary" />
                </div>
              )}
              <div className="flex-1 text-left overflow-hidden">
                <div className="text-sm font-medium truncate">{user.nickname || user.email}</div>
                <div className="text-xs text-text-secondary truncate">{user.email}</div>
              </div>
              <ChevronDown size={16} className={`text-text-secondary transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>

            {/* 用户菜单 */}
            {showUserMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-primary border border-bg-tertiary rounded shadow-lg z-50">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors text-sm text-left rounded"
                >
                  <LogOut size={16} className="text-text-secondary" />
                  <span>退出登录</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 当前对话 */}
      <div className="p-4 border-b border-bg-tertiary">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors">
          <MessageSquare size={18} className="text-primary" />
          <span className="text-sm font-medium text-primary">Xuanji</span>
        </button>
      </div>

      {/* 间隔 */}
      <div className="flex-1"></div>

      {/* 底部快捷入口 */}
      <div className="border-t border-bg-tertiary p-2 space-y-1">
        <button
          onClick={onOpenAgents}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Bot size={16} className="text-text-secondary" />
          <span>Agents</span>
        </button>

        <button
          onClick={onOpenTools}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Wrench size={16} className="text-text-secondary" />
          <span>Tools</span>
        </button>

        <button
          onClick={onOpenSystemPrompt}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <FileText size={16} className="text-text-secondary" />
          <span>System Prompt</span>
        </button>

        <button
          onClick={onOpenMemory}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Brain size={16} className="text-text-secondary" />
          <span>Memory</span>
        </button>

        <button
          onClick={onOpenPermissions}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <ShieldCheck size={16} className="text-text-secondary" />
          <span>权限管理</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Settings size={16} className="text-text-secondary" />
          <span>设置</span>
        </button>

        <button
          onClick={() => window.open('https://github.com/shibit/xuanji', '_blank')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <HelpCircle size={16} className="text-text-secondary" />
          <span>帮助</span>
        </button>
      </div>
    </div>
  );
}

