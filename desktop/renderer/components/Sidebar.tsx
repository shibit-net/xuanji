// ============================================================
// Sidebar - 左侧边栏（分组导航 + 文件树）
// ============================================================

import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Settings, HelpCircle, Bot, Wrench, FileText, Brain,
  LogOut, ShieldCheck, Clock, Package, Plus, Radio, X,
  FolderTree, ChevronDown, ChevronRight, GitBranch,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { usePlatformStore } from '../stores/platformStore';
import { getDesktopLabel } from '../i18n';
import { Avatar } from './Avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ProjectFileTree from './ProjectFileTree';

// ─── 导航分组配置 ──────────────────────────

interface NavItem {
  id: string;
  icon: React.ReactNode;
  labelKey: string;
  route: string;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'sidebar.group_agent',
    items: [
      { id: 'agents', icon: <Bot size={14} />, labelKey: 'sidebar.agents', route: '/agents' },
      { id: 'tools', icon: <Wrench size={14} />, labelKey: 'sidebar.tools', route: '/tools' },
      { id: 'skills-mcp', icon: <Package size={14} />, labelKey: 'sidebar.skills_mcp', route: '/skills-mcp' },
    ],
  },
  {
    labelKey: 'sidebar.group_config',
    items: [
      { id: 'system-prompt', icon: <FileText size={14} />, labelKey: 'sidebar.system_prompt', route: '/system-prompt' },
      { id: 'memory', icon: <Brain size={14} />, labelKey: 'sidebar.memory', route: '/memory' },
    ],
  },
  {
    labelKey: 'sidebar.group_ops',
    items: [
      { id: 'scheduler', icon: <Clock size={14} />, labelKey: 'sidebar.scheduler', route: '/scheduler' },
      { id: 'permissions', icon: <ShieldCheck size={14} />, labelKey: 'sidebar.permissions', route: '/permissions' },
    ],
  },
];

// ─── 分组标题 ─────────────────────────────

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] uppercase text-muted-foreground/50 tracking-wider font-medium px-1 pt-3 pb-1">
      {children}
    </div>
  );
}

// ─── 会话列表 ─────────────────────────────

function SessionList() {
  const navigate = useNavigate();
  const language = useConfigStore((s) => s.settings.language);
  const { sessions, activeSessionId, setActiveSession, removeSession, updateSessionName } = usePlatformStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleXuanjiClick = () => {
    setActiveSession(null);
    navigate('/chat');
  };

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

  const handleStartRename = (sessionId: string, currentName: string) => {
    setRenamingId(sessionId);
    setRenameText(currentName);
  };

  const handleConfirmRename = async () => {
    if (renamingId && renameText.trim()) {
      const name = renameText.trim();
      updateSessionName(renamingId, name);
      await window.electron.platformSaveSessionName({ sessionId: renamingId, name });
    }
    setRenamingId(null);
    setRenameText('');
  };

  return (
    <div className="space-y-0.5">
      <Button
        variant={activeSessionId === null ? 'default' : 'ghost'}
        className="w-full justify-start gap-1.5 h-8"
        onClick={handleXuanjiClick}
      >
        <span className="text-xs">Xuanji</span>
      </Button>
      {sessions.map((session) => (
        <div key={session.id} className="group relative flex items-center">
          <Button
            variant={activeSessionId === session.id ? 'default' : 'ghost'}
            className="w-full justify-start gap-1.5 h-8 pr-6"
            onClick={() => { setActiveSession(session.id); navigate('/chat'); }}
          >
            <Radio size={12} className={session.status === 'online' ? 'text-green-500 flex-shrink-0' : 'text-muted-foreground flex-shrink-0'} />
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
                title={getDesktopLabel('sidebar.rename_hint', language)}
                onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(session.id, session.name || ''); }}
              >
                {session.name || getDesktopLabel(`sidebar.platform_${session.platform}`, language)}
              </span>
            )}
            {session.unreadCount > 0 && (
              <span className="flex-shrink-0 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {session.unreadCount}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0 hidden group-hover:flex hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/20"
            onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
          >
            <X size={10} />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ─── Sidebar 主体 ─────────────────────────

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthStore();
  const language = useConfigStore((s) => s.settings.language);
  const { setSetupDialogOpen } = usePlatformStore();
  const [fileTreeExpanded, setFileTreeExpanded] = useState(true);
  const [fileTreeHeight, setFileTreeHeight] = useState(192);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const draggingRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const isActive = (route: string) => location.pathname === route;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = { startY: e.clientY, startHeight: fileTreeHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [fileTreeHeight]);

  useEffect(() => {
    let didDrag = false;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = draggingRef.current.startY - e.clientY;
      if (Math.abs(delta) > 3) didDrag = true;
      const next = Math.max(80, Math.min(500, draggingRef.current.startHeight + delta));
      setFileTreeHeight(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      if (!didDrag) {
        // 纯点击 → 切换折叠
        setFileTreeExpanded(prev => !prev);
      }
      draggingRef.current = null;
      didDrag = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  return (
    <div className="w-52 bg-secondary flex flex-col border-r border-border">
      {/* 用户信息 */}
      {isAuthenticated && user && (
        <div className="p-3 border-b border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full flex items-center gap-2 px-2 py-1.5 h-auto">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.nickname || user.email} className="w-7 h-7 rounded-full" />
                ) : (
                  <Avatar seed={user.email || user.nickname || 'user'} size={28} />
                )}
                <div className="flex-1 text-left overflow-hidden">
                  <div className="text-xs font-medium truncate">{user.nickname || user.email}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut size={14} className="mr-2 text-muted-foreground" />
                {getDesktopLabel('sidebar.logout', language)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* 滚动区域：会话 + 导航分组 */}
      <div className="flex-1 overflow-y-auto px-2">
        {/* 会话区 */}
        <GroupLabel>{getDesktopLabel('sidebar.group_session', language)}</GroupLabel>
        <SessionList />
        <Button
          variant="ghost"
          className="w-full justify-start gap-1.5 h-7 text-[11px] text-muted-foreground hover:text-foreground mt-0.5"
          onClick={() => setSetupDialogOpen(true)}
        >
          <Plus size={12} />
          {getDesktopLabel('sidebar.add_remote', language)}
        </Button>

        {/* 导航分组 */}
        {NAV_GROUPS.map((group) => (
          <div key={group.labelKey}>
            <GroupLabel>{getDesktopLabel(group.labelKey, language)}</GroupLabel>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Button
                  key={item.id}
                  variant={isActive(item.route) ? 'default' : 'ghost'}
                  className="w-full justify-start gap-1.5 h-8"
                  onClick={() => navigate(item.route)}
                >
                  {item.icon}
                  <span className="text-xs">{getDesktopLabel(item.labelKey, language)}</span>
                </Button>
              ))}
            </div>
          </div>
        ))}

        {/* 系统组：设置 + 帮助 */}
        <GroupLabel>{getDesktopLabel('sidebar.group_system', language)}</GroupLabel>
        <div className="space-y-0.5">
          <Button
            variant={isActive('/settings') ? 'default' : 'ghost'}
            className="w-full justify-start gap-1.5 h-8"
            onClick={() => navigate('/settings')}
          >
            <Settings size={14} />
            <span className="text-xs">{getDesktopLabel('sidebar.settings', language)}</span>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-1.5 h-8"
            onClick={() => window.open('https://work.weixin.qq.com/ca/cawcde6fa830e97aad', '_blank')}
          >
            <HelpCircle size={14} />
            <span className="text-xs">{getDesktopLabel('sidebar.help', language)}</span>
          </Button>
        </div>
      </div>

      {/* 底部：项目文件树 */}
      <div className="border-t border-border">
        <button
          onMouseDown={handleResizeStart}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase text-muted-foreground/50 tracking-wider font-medium hover:text-foreground transition-colors cursor-row-resize"
        >
          {fileTreeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderTree size={12} />
          <span className="flex-1 text-left">{getDesktopLabel('sidebar.project_files', language)}</span>
          {gitBranch && (
            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground/50 normal-case tracking-normal font-normal">
              <GitBranch size={9} className="flex-shrink-0" />
              <span className="truncate max-w-[80px]">{gitBranch}</span>
            </span>
          )}
        </button>
        {fileTreeExpanded && (
          <div className="overflow-y-auto" style={{ height: fileTreeHeight }}>
            <ProjectFileTree onGitBranchChange={setGitBranch} />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(Sidebar);
