// ============================================================
// Sidebar - 左侧边栏组件（导航入口）
// ============================================================
// 🆕 连续会话模式：移除会话列表，仅保留导航入口

import { useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { Settings, HelpCircle, Bot, Wrench, FileText, Brain, LogOut, User as ShieldCheck, Clock, Package, Plus, Radio, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { usePlatformStore } from '../stores/platformStore';
import { getDesktopLabel } from '../i18n';
import { Avatar } from './Avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// 应用图标
interface SidebarProps {
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  onOpenTools: () => void;
  onOpenSystemPrompt: () => void;
  onOpenMemory: () => void;
  onOpenScheduler: () => void;
  onOpenPermissions: () => void;
  onOpenSkillsMCP: () => void;
}

export default function Sidebar({ onToggle: _onToggle, onOpenSettings, onOpenAgents, onOpenTools, onOpenSystemPrompt, onOpenMemory, onOpenScheduler, onOpenPermissions, onOpenSkillsMCP }: SidebarProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const language = useConfigStore((s) => s.settings.language);
  const { sessions, activeSessionId, setActiveSession, setSetupDialogOpen, removeSession, updateSessionName } = usePlatformStore();

  // 备注名编辑状态
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // 点击 Xuanji 回到本地对话
  const handleXuanjiClick = () => {
    setActiveSession(null);
    navigate('/chat');
  };

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  // 删除远端会话（持久化：禁用平台连接，确保重启后不恢复）
  const handleDeleteSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      await window.electron.platformDisable(session.platform);
    }
    if (activeSessionId === sessionId) {
      setActiveSession(null);
      navigate('/chat');
    }
    removeSession(sessionId);
  };

  // 开始编辑备注名
  const handleStartRename = (sessionId: string, currentName: string) => {
    setRenamingId(sessionId);
    setRenameText(currentName);
  };

  // 确认备注名
  const handleConfirmRename = async () => {
    if (renamingId && renameText.trim()) {
      const name = renameText.trim();
      updateSessionName(renamingId, name);
      // 持久化到磁盘
      await window.electron.platformSaveSessionName({ sessionId: renamingId, name });
    }
    setRenamingId(null);
    setRenameText('');
  };

  return (
    <div className="w-56 bg-secondary flex flex-col border-r border-border">
      {/* 顶部：用户信息 + 下拉菜单 */}
      {isAuthenticated && user && (
        <div className="p-4 border-b border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full flex items-center gap-3 px-3 py-2 h-auto"
              >
                {user.avatar ? (
                  <img src={user.avatar} alt={user.nickname || user.email} className="w-8 h-8 rounded-full" />
                ) : (
                  <Avatar seed={user.email || user.nickname || 'user'} size={32} />
                )}
                <div className="flex-1 text-left overflow-hidden">
                  <div className="text-sm font-medium truncate">{user.nickname || user.email}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut size={16} className="mr-2 text-muted-foreground" />
                {getDesktopLabel('sidebar.logout', language)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* 会话列表区 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Xuanji 本地对话 */}
        <Button
          variant={activeSessionId === null ? 'default' : 'ghost'}
          className="w-full justify-start gap-2 h-9"
          onClick={handleXuanjiClick}
        >
          <span className={`text-sm ${activeSessionId === null ? '' : 'text-foreground'}`}>Xuanji</span>
        </Button>

        {/* 远端会话列表 */}
        {sessions.map((session) => (
          <div key={session.id} className="group relative flex items-center">
            <Button
              variant={activeSessionId === session.id ? 'default' : 'ghost'}
              className="w-full justify-start gap-2 h-9 pr-6"
              onClick={() => { setActiveSession(session.id); navigate('/chat'); }}
            >
              <Radio size={14} className={session.status === 'online' ? 'text-green-500 flex-shrink-0' : 'text-muted-foreground flex-shrink-0'} />
              {renamingId === session.id ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="flex-1 text-xs text-foreground bg-background border border-primary rounded px-1 py-0 h-5 min-w-0"
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={handleConfirmRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmRename();
                    if (e.key === 'Escape') { setRenamingId(null); setRenameText(''); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="text-xs truncate flex-1 text-left cursor-pointer hover:text-primary min-w-0"
                  title="双击修改备注名"
                  onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(session.id, session.name || ''); }}
                >
                  {session.name || getDesktopLabel(`sidebar.platform_${session.platform}`, language)}
                </span>
              )}
              {session.unreadCount > 0 && (
                <span className="flex-shrink-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {session.unreadCount}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hidden group-hover:flex hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/20"
              onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
              title="删除会话"
            >
              <X size={12} />
            </Button>
          </div>
        ))}
      </div>

      {/* 间隔 */}
      <div className="flex-1"></div>

      {/* 添加远端 ——正好在底部菜单上方 */}
      <div className="px-2 pb-1">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setSetupDialogOpen(true)}
        >
          <Plus size={14} />
          Remote
        </Button>
      </div>

      {/* 底部快捷入口 */}
      <div className="border-t border-border p-2 space-y-1">
        {/* 智能体核心能力 */}
        <Button variant="ghost" onClick={onOpenAgents} className="w-full justify-start h-9">
          <Bot size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.agents', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenTools} className="w-full justify-start h-9">
          <Wrench size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.tools', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenSkillsMCP} className="w-full justify-start h-9">
          <Package size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.skills_mcp', language)}
        </Button>
        {/* 智能体配置 */}
        <Button variant="ghost" onClick={onOpenSystemPrompt} className="w-full justify-start h-9">
          <FileText size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.system_prompt', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenMemory} className="w-full justify-start h-9">
          <Brain size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.memory', language)}
        </Button>
        {/* 运维管理 */}
        <Button variant="ghost" onClick={onOpenScheduler} className="w-full justify-start h-9">
          <Clock size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.scheduler', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenPermissions} className="w-full justify-start h-9">
          <ShieldCheck size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.permissions', language)}
        </Button>
        {/* 系统 */}
        <Button variant="ghost" onClick={onOpenSettings} className="w-full justify-start h-9">
          <Settings size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.settings', language)}
        </Button>
        <Button
          variant="ghost"
          onClick={() => window.open('https://github.com/shibit/xuanji', '_blank')}
          className="w-full justify-start h-9"
        >
          <HelpCircle size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.help', language)}
        </Button>
      </div>
    </div>
  );
}
