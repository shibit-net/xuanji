// ============================================================
// Sidebar - 左侧边栏组件（导航入口）
// ============================================================
// 🆕 连续会话模式：移除会话列表，仅保留导航入口

import { Settings, HelpCircle, Bot, Wrench, FileText, Brain, LogOut, User as ShieldCheck, Clock, Package, Plus, Radio } from 'lucide-react';
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
  const { user, isAuthenticated, logout } = useAuthStore();
  const language = useConfigStore((s) => s.settings.language);
  const { sessions, activeSessionId, setActiveSession, setSetupDialogOpen } = usePlatformStore();

  // 点击 Xuanji 回到本地对话
  const handleXuanjiClick = () => {
    setActiveSession(null);
  };

  const handleLogout = async () => {
    await logout();
    window.location.reload();
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
          <Button
            key={session.id}
            variant={activeSessionId === session.id ? 'default' : 'ghost'}
            className="w-full justify-start gap-2 h-9"
            onClick={() => setActiveSession(session.id)}
          >
            <Radio size={14} className={session.status === 'online' ? 'text-green-500' : 'text-muted-foreground'} />
            <span className="text-xs truncate flex-1 text-left">
              {getDesktopLabel('sidebar.session_platform', language).replace('{platform}', getDesktopLabel(`sidebar.platform_${session.platform}`, language)).replace('{name}', session.name)}
            </span>
            {session.unreadCount > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {session.unreadCount}
              </span>
            )}
          </Button>
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
