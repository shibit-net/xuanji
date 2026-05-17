// ============================================================
// Sidebar - 左侧边栏组件（导航入口）
// ============================================================
// 🆕 连续会话模式：移除会话列表，仅保留导航入口

import { Settings, HelpCircle, Bot, Wrench, FileText, Brain, LogOut, User as ShieldCheck, Clock } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
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
import appLogo from '../assets/logos/04e91e5e62d18be6f5969ca4fc7cfb99.png';

interface SidebarProps {
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  onOpenTools: () => void;
  onOpenSystemPrompt: () => void;
  onOpenMemory: () => void;
  onOpenScheduler: () => void;
  onOpenPermissions: () => void;
}

export default function Sidebar({ onToggle: _onToggle, onOpenSettings, onOpenAgents, onOpenTools, onOpenSystemPrompt, onOpenMemory, onOpenScheduler, onOpenPermissions }: SidebarProps) {
  const { user, isAuthenticated, logout } = useAuthStore();
  const language = useConfigStore((s) => s.settings.language);

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

      {/* 当前对话 */}
      <div className="p-4 border-b border-border">
        <Button
          variant="outline"
          className="w-full flex items-center gap-3 px-3 py-2 h-auto border-primary/30 bg-primary/10 hover:bg-primary/20"
        >
          <div className="w-[18px] h-[18px] rounded-full overflow-hidden flex-shrink-0">
            <img src={appLogo} alt="Xuanji" className="w-full h-full object-cover" />
          </div>
          <span className="text-sm font-medium text-primary">Xuanji</span>
        </Button>
      </div>

      {/* 间隔 */}
      <div className="flex-1"></div>

      {/* 底部快捷入口 */}
      <div className="border-t border-border p-2 space-y-1">
        <Button variant="ghost" onClick={onOpenAgents} className="w-full justify-start h-9">
          <Bot size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.agents', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenTools} className="w-full justify-start h-9">
          <Wrench size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.tools', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenSystemPrompt} className="w-full justify-start h-9">
          <FileText size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.system_prompt', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenMemory} className="w-full justify-start h-9">
          <Brain size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.memory', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenScheduler} className="w-full justify-start h-9">
          <Clock size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.scheduler', language)}
        </Button>
        <Button variant="ghost" onClick={onOpenPermissions} className="w-full justify-start h-9">
          <ShieldCheck size={16} className="mr-2 text-muted-foreground" />
          {getDesktopLabel('sidebar.permissions', language)}
        </Button>
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
