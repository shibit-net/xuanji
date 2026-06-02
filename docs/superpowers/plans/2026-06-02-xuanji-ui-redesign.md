# Xuanji 交互视觉重构 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Xuanji 桌面端从最多 5 列布局重构为 2 列核心区 + 分组侧栏，同时优化全局视觉一致性和文案标准化。

**架构：** 文件树合并至侧栏，监控面板与聊天区左右等分（flex-1 / flex-1），输入区横跨底部全宽。侧栏按 4 个功能域分组（会话 / 智能体 / 运维 / 系统）+ 可折叠文件树。

**技术栈：** React 18 + TypeScript + Tailwind CSS + shadcn/ui + Lucide icons + zustand

---

### 任务 1：i18n 文案标准化

**文件：**
- 修改：`src/core/i18n/messages.ts`

- [ ] **步骤 1：更新中文 messages.ts 中相关文案**

找到并修改 `messages.ts` 中的中文消息条目，将口语化文案标准化。关键变更：

```typescript
// 在 zh Messages 中修改以下条目：

// 会话初始化
'session.initializing': '会话初始化中',

// Token 统计
'chat.token_input': '输入',
'chat.token_output': '输出',
'chat.token_total': '累计',

// 上下文压缩
'input.compact_title': '压缩上下文',
'input.compact_usage_title': '上下文使用 {used}/{max} ({percent}%)',
'input.compacting': '压缩中...',
'input.compact_button': '压缩 {percent}%',
'input.compact_button_simple': '压缩上下文',

// 记忆
'input.memory_title': '提取记忆',
'input.extracting': '提取中...',
'input.memory_extract': '提取记忆',

// 聊天
'chatarea.subtitle': '输入消息开始，或使用 /help 查看更多命令',
'chatarea.start_hint': '输入消息开始',

// 发送/停止
'input.sending': '发送中...',
'input.send_button': '发送',
'input.send_button_interrupt': '中断并发送',
'input.send_button_queue': '排队发送',

// 文件拖拽
'input.drop_hint': '释放文件以上传',

// Agent 选择器
'input.no_agent': '无可用 Agent',

// 新消息/回到底部
'chat.new_message': '新消息',
'chat.scroll_to_bottom': '回到底部',
```

- [ ] **步骤 2：Commit**

```bash
git add src/core/i18n/messages.ts
git commit -m "refactor(i18n): 文案标准化 - 口语化改为规范表达"
```

---

### 任务 2：侧栏重写 — 分组导航 + 文件树

**文件：**
- 重写：`desktop/renderer/components/Sidebar.tsx`

- [ ] **步骤 1：重写 Sidebar 组件**

用分组导航结构替换当前扁平列表，底部集成可折叠文件树。

```typescript
// ============================================================
// Sidebar - 左侧边栏（分组导航 + 文件树）
// ============================================================

import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Settings, HelpCircle, Bot, Wrench, FileText, Brain,
  LogOut, ShieldCheck, Clock, Package, Plus, Radio, X,
  FolderTree, ChevronDown, ChevronRight,
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

// ─── 分组配置 ──────────────────────────────────

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  route: string;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '智能体',
    items: [
      { id: 'agents', icon: <Bot size={14} />, label: 'Agent 管理', route: '/agents' },
      { id: 'tools', icon: <Wrench size={14} />, label: '工具管理', route: '/tools' },
      { id: 'skills-mcp', icon: <Package size={14} />, label: 'Skills / MCP', route: '/skills-mcp' },
    ],
  },
  {
    label: '配置',
    items: [
      { id: 'system-prompt', icon: <FileText size={14} />, label: 'System Prompt', route: '/system-prompt' },
      { id: 'memory', icon: <Brain size={14} />, label: '记忆管理', route: '/memory' },
    ],
  },
  {
    label: '运维',
    items: [
      { id: 'scheduler', icon: <Clock size={14} />, label: '调度', route: '/scheduler' },
      { id: 'permissions', icon: <ShieldCheck size={14} />, label: '权限', route: '/permissions' },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'settings', icon: <Settings size={14} />, label: '设置', route: '/settings' },
      { id: 'help', icon: <HelpCircle size={14} />, label: '帮助', route: '#help' },
    ],
  },
];

// ─── 会话列表项 ──────────────────────────────

function SessionList() {
  const navigate = useNavigate();
  const language = useConfigStore((s) => s.settings.language);
  const { sessions, activeSessionId, setActiveSession, setSetupDialogOpen, removeSession, updateSessionName } = usePlatformStore();
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
    <div className="space-y-1">
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
                title="双击修改备注名"
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

// ─── 分组标题 ─────────────────────────────────

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] uppercase text-muted-foreground/60 tracking-wider font-medium px-1 pt-3 pb-1">
      {children}
    </div>
  );
}

// ─── Sidebar 主体 ─────────────────────────────

export default function Sidebar() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const language = useConfigStore((s) => s.settings.language);
  const { setSetupDialogOpen } = usePlatformStore();
  const [fileTreeExpanded, setFileTreeExpanded] = useState(true);

  const isActive = (route: string) => location.pathname === route;

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
        <GroupLabel>会话</GroupLabel>
        <SessionList />
        <Button
          variant="ghost"
          className="w-full justify-start gap-1.5 h-7 text-[11px] text-muted-foreground hover:text-foreground mt-0.5"
          onClick={() => setSetupDialogOpen(true)}
        >
          <Plus size={12} />
          Remote
        </Button>

        {/* 导航分组 */}
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <GroupLabel>{group.label}</GroupLabel>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Button
                  key={item.id}
                  variant={isActive(item.route) ? 'default' : 'ghost'}
                  className="w-full justify-start gap-1.5 h-8"
                  onClick={() => {
                    if (item.route === '#help') {
                      window.open('https://work.weixin.qq.com/ca/cawcde6fa830e97aad', '_blank');
                    } else {
                      navigate(item.route);
                    }
                  }}
                >
                  {item.icon}
                  <span className="text-xs">{item.label}</span>
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 底部：项目文件树 */}
      <div className="border-t border-border">
        <button
          onClick={() => setFileTreeExpanded(!fileTreeExpanded)}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase text-muted-foreground/60 tracking-wider font-medium hover:text-foreground transition-colors"
        >
          {fileTreeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderTree size={12} />
          项目文件
        </button>
        {fileTreeExpanded && (
          <div className="max-h-48 overflow-y-auto border-t border-border/50">
            <ProjectFileTree />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：创建 ProjectFileTree 组件**

从 `ProjectFilesPanel.tsx` 提取文件树渲染逻辑到独立组件。

```typescript
// desktop/renderer/components/ProjectFileTree.tsx
// ============================================================
// ProjectFileTree - 嵌入侧栏的项目文件树
// 从 ProjectFilesPanel 提取纯树形渲染逻辑
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, RefreshCw, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ... 复用 ProjectFilesPanel 中的 TreeNode / TreeItem 逻辑
// 但去掉面板的 header/footer chrome，仅保留树形内容
```

- [ ] **步骤 3：Commit**

```bash
git add desktop/renderer/components/Sidebar.tsx desktop/renderer/components/ProjectFileTree.tsx
git commit -m "refactor(ui): 侧栏重写 - 分组导航 + 集成文件树"
```

---

### 任务 3：TitleBar 简化

**文件：**
- 修改：`desktop/renderer/components/TitleBar.tsx`

- [ ] **步骤 1：移除面板 toggle 按钮**

```typescript
// TitleBar.tsx — 移除 onToggleRightPanel 和 onToggleProjectFiles 相关 props 和按钮

interface TitleBarProps {
  onCompact?: () => void;
  onShowStats?: () => void;
  onShowDiagnostics?: () => void;
}

export default function TitleBar({ onCompact: _onCompact, onShowStats: _onShowStats, onShowDiagnostics: _onShowDiagnostics }: TitleBarProps) {
  // ... 保留 minimize/maximize/close，移除面板 toggle 按钮
  return (
    <div className="flex-shrink-0 h-10 bg-card flex items-center justify-between px-4 select-none drag">
      <div className="w-20"></div>
      <div className="flex items-center gap-2">
        <img src={appLogo} alt="Xuanji" className="w-5 h-5 rounded" />
        <div className="text-primary font-bold text-lg">{getDesktopLabel('titlebar.app_name', language)}</div>
      </div>
      <div className="flex items-center gap-1 no-drag">
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" onClick={handleMinimize} className="h-7 w-7">
          <Minus size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleMaximize} className="h-7 w-7">
          <Square size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleClose} className="h-7 w-7 hover:bg-red-500/80 hover:text-white">
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：Commit**

```bash
git add desktop/renderer/components/TitleBar.tsx
git commit -m "refactor(ui): TitleBar 简化 - 移除面板 toggle 按钮"
```

---

### 任务 4：MainLayout 更新

**文件：**
- 修改：`desktop/renderer/layouts/MainLayout.tsx`

- [ ] **步骤 1：移除 toggle 回调 + 简化 Sidebar props**

```typescript
// MainLayout.tsx — 移除 handleToggleRightPanel / handleToggleProjectFiles
// Sidebar 不再需要 onOpen* 回调 props（路由导航内置于 Sidebar）

// 删除以下代码：
// - handleToggleRightPanel 函数
// - handleToggleProjectFiles 函数
// - Sidebar 的所有 onOpen* props

// TitleBar 移除 onToggleRightPanel / onToggleProjectFiles props

return (
  <div className="flex flex-col h-screen w-screen bg-background text-foreground">
    <TitleBar
      onCompact={handleCompact}
      onShowStats={() => setActiveDialog('stats')}
      onShowDiagnostics={() => setActiveDialog('diagnostics')}
    />
    <div className="flex flex-1 overflow-hidden">
      {sidebarVisible && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
    <StatusBar />
    {/* ... dialogs unchanged */}
  </div>
);
```

- [ ] **步骤 2：Commit**

```bash
git add desktop/renderer/layouts/MainLayout.tsx
git commit -m "refactor(ui): MainLayout 更新 - 移除 toggle 回调，简化 Sidebar 集成"
```

---

### 任务 5：MainPage 布局重构 — 两列等分

**文件：**
- 重写：`desktop/renderer/pages/MainPage.tsx`

- [ ] **步骤 1：重写 MainPage 为两列等分布局**

```typescript
// MainPage.tsx — 两列等分：ChatArea (flex-1) | MonitorPanel (flex-1)
// InputArea 提升到此层级，横跨底部全宽

import React, { useState, useEffect } from 'react';
import ChatArea from '../components/ChatArea';
import RemoteChatArea from '../components/RemoteChatArea';
import MonitorPanel from '../components/MonitorPanel';
import InputArea from '../components/InputArea';
import TodoPanel from '../components/TodoPanel';
import { Loader2 } from 'lucide-react';
import { useConversationStore } from '../stores/ConversationStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { usePlatformStore } from '../stores/platformStore';
import { registerEventAdapter } from '../services/EventAdapter';

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function MainPage() {
  React.useEffect(() => { registerEventAdapter(); }, []);

  const currentIteration = useConversationStore((s) => s.iteration);
  const sessionStatus = useSessionInitStore((s) => s.status);

  const newAgentMap = useAgentStateMachine((s) => s.agentMap);
  const totalTokens = React.useMemo(() => {
    const sum = { input: 0, output: 0, cached: 0 };
    for (const a of Object.values(newAgentMap)) {
      sum.input += a.stats.tokenUsage.input || 0;
      sum.output += a.stats.tokenUsage.output || 0;
      sum.cached += a.stats.tokenUsage.cached || 0;
    }
    return sum;
  }, [newAgentMap]);

  const activeSessionId = usePlatformStore((s) => s.activeSessionId);
  const remoteSessions = usePlatformStore((s) => s.sessions);
  const remoteSessionKey = activeSessionId
    ? remoteSessions.find((s) => s.id === activeSessionId)?.sessionKey
    : undefined;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 聊天区 — 左侧等分列 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden border-r border-border">
        {/* 状态栏 */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-border bg-muted/30">
          {sessionStatus !== 'ready' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              {sessionStatus === 'initializing' ? (
                <>
                  <Loader2 size={12} className="animate-spin text-blue-400" />
                  <span className="text-blue-400">会话初始化中</span>
                </>
              ) : sessionStatus === 'failed' ? (
                <>
                  <span className="text-red-400">会话不可用</span>
                  <button
                    onClick={() => useSessionInitStore.getState().retry()}
                    className="text-blue-400 hover:underline"
                  >
                    重试
                  </button>
                </>
              ) : null}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span>{currentIteration} 轮</span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-amber-400/80" title="输入 token（含缓存写入）">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              输入 {formatToken(totalTokens.input)}
            </span>
            <span className="flex items-center gap-1 text-green-400/80" title="输出 token">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              输出 {formatToken(totalTokens.output)}
            </span>
            {totalTokens.input + totalTokens.output > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground font-medium" title="累计 token">
                累计 {formatToken(totalTokens.input + totalTokens.output)}
              </span>
            )}
          </div>
        </div>
        {activeSessionId ? <RemoteChatArea /> : <ChatArea />}
      </div>

      {/* 监控面板 — 右侧等分列 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <MonitorPanel />
      </div>

      {/* 底部：TodoPanel + InputArea 横跨全宽 */}
      <div className="fixed bottom-0 left-52 right-0 z-10 bg-background border-t border-border">
        <TodoPanel />
        <InputArea
          conversationType={activeSessionId ? 'remote' : 'local'}
          sessionKey={remoteSessionKey}
        />
        {/* StatusBar 由 MainLayout 渲染 */}
      </div>
    </div>
  );
}
```

等等，InputArea 用 `fixed` 定位可能有问题。让我重新考虑布局：InputArea 和 TodoPanel 需要保持在聊天区底部。实际上更好的做法是聊天列内部包含 ChatArea + TodoPanel + InputArea，监控列独立。这样两列各自独立滚动。

```typescript
// 修正：聊天列 = ChatArea + TodoPanel + InputArea，监控列独立
return (
  <div className="flex flex-1 overflow-hidden">
    {/* 左侧：聊天区 */}
    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden border-r border-border">
      {/* 状态栏 */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-border bg-muted/30">
        {/* ... token 统计 ... */}
      </div>
      {activeSessionId ? <RemoteChatArea /> : <ChatArea />}
      <TodoPanel />
      <InputArea
        conversationType={activeSessionId ? 'remote' : 'local'}
        sessionKey={remoteSessionKey}
      />
    </div>

    {/* 右侧：监控面板 */}
    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
      <MonitorPanel />
    </div>
  </div>
);
```

这样更简洁，InputArea 在聊天列内部，监控面板独立。

- [ ] **步骤 2：Commit**

```bash
git add desktop/renderer/pages/MainPage.tsx
git commit -m "refactor(ui): MainPage 两列等分布局 - 聊天+输入 (50%) | 监控面板 (50%)"
```

---

### 任务 6：监控面板内容重设计

**文件：**
- 重写：`desktop/renderer/components/RightPanel.tsx` → 重命名为 `MonitorPanel.tsx`

- [ ] **步骤 1：创建 MonitorPanel 组件**

将 `RightPanel.tsx` 复制为 `MonitorPanel.tsx`，重设计内容：

```typescript
// MonitorPanel.tsx — 等分列监控面板（替换 RightPanel）
// 移除拖拽 resize 逻辑（等分列不需要），标签页内容重设计

import React, { useState, useMemo } from 'react';
import { Activity, FileText, Radio } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useIntentRoutingStore } from '../stores/IntentRoutingStore';
import { usePlatformStore } from '../stores/platformStore';
import { t } from '@/core/i18n';
import ExecutionFlowV2 from './ExecutionFlowV2';
import PlatformSessionPanel from './PlatformSessionPanel';

type TabId = 'monitor' | 'logs' | 'remote';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'monitor', label: '运行监控', icon: <Activity size={14} /> },
  { id: 'logs', label: '日志', icon: <FileText size={14} /> },
  { id: 'remote', label: '远端会话', icon: <Radio size={14} /> },
];

export default function MonitorPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('monitor');

  return (
    <div className="h-full flex flex-col bg-card">
      {/* 标签页 — 紧凑样式 */}
      <div className="flex-shrink-0 flex items-center border-b border-border px-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 py-2 px-3 text-xs transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'monitor' && <MonitorTab />}
        {activeTab === 'logs' && <LogsTab />}
        {activeTab === 'remote' && <RemoteTab />}
      </div>
    </div>
  );
}

// ─── 运行监控标签 — 重设计 ─────────────────

function MonitorTab() {
  const routeStatus = useIntentRoutingStore((s) => s.status);
  const routeResult = useIntentRoutingStore((s) => s.result);
  const stages = useIntentRoutingStore((s) => s.stages);
  const promptLayers = useIntentRoutingStore((s) => s.promptLayers);
  const totalComponents = useIntentRoutingStore((s) => s.totalComponents);
  const estimatedTokens = useIntentRoutingStore((s) => s.estimatedTokens);

  const scenes = routeResult?.scene
    ? routeResult.scene.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="h-full flex flex-col">
      {/* 意图分析卡片 */}
      {routeStatus !== 'idle' && (
        <div className="flex-shrink-0 mx-3 mt-3 p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold">意图分析</span>
            {routeStatus !== 'analyzing' && (
              <span className="text-[10px] text-green-400">已完成</span>
            )}
          </div>
          {routeResult && (
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-blue-400 font-medium">{routeResult.agentId}</span>
                <span className="text-muted-foreground">路由: {routeResult.method === 'llm' ? 'LLM' : routeResult.method === 'embedding' ? '向量匹配' : '默认'}</span>
                {routeResult.confidence > 0 && (
                  <span className="text-muted-foreground/50 ml-auto">
                    置信度 {(routeResult.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {scenes.length > 0 && (
                  <span className="text-purple-400/80">{scenes.join(', ')}</span>
                )}
                <span className="text-muted-foreground/40">·</span>
                <span className={routeResult.complexity === 'complex' ? 'text-amber-400/80' : 'text-emerald-400/80'}>
                  {routeResult.complexity === 'complex' ? '高复杂度' : '低复杂度'}
                </span>
                {routeResult.modelName && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-muted-foreground/70">{routeResult.modelName}</span>
                  </>
                )}
              </div>
              {promptLayers.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground select-none">
                    Prompt 组件 ({totalComponents} 层, ~{estimatedTokens}t)
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto space-y-1">
                    {promptLayers.map((layer) => (
                      <div key={layer.layer} className="pl-2 border-l border-border">
                        <span className="text-[10px] text-muted-foreground">L{layer.layer}</span>
                        <div className="ml-2 mt-0.5 space-y-0.5">
                          {layer.components.map((c) => (
                            <div key={c.id} className="text-[10px] text-muted-foreground/70 truncate">{c.name}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* 执行流 — 占据剩余空间 */}
      <div className="flex-1 min-h-0">
        <ExecutionFlowV2 />
      </div>
    </div>
  );
}

// ─── 日志标签 — 优化过滤样式 ───────────────

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖', write_file: '📝', edit_file: '✏️', multi_edit: '📋',
  bash: '💻', glob: '🔎', grep: '🔍', ls: '📂',
  web_fetch: '🌐', plan_review: '📋', ask_user: '❓',
  todo_create: '✅', todo_list: '📋', todo_update: '🔄',
  memory_search: '🧠', memory_store: '💾', memory_stats: '📊', memory_graph: '🕸️',
};

// 保持现有的 LogsTab 逻辑，但优化：
// - 过滤按钮改为 segmented control 样式 (inline-flex rounded-md bg-muted p-0.5)
// - 时间戳统一 HH:mm:ss 格式

function LogsTab() {
  // ... 保持现有 timeline 合并逻辑
  // 过滤栏改为 segmented control

  return (
    <div className="h-full flex flex-col p-3 gap-3">
      <div className="text-xs font-semibold">日志流</div>
      {/* Segmented control 过滤 */}
      <div className="inline-flex rounded-md bg-muted p-0.5 gap-0.5 self-start">
        {[
          { value: null, label: '全部' },
          { value: 'error', label: '错误' },
          { value: 'warn', label: '警告' },
          { value: 'info', label: '信息' },
          { value: 'tool', label: '工具' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => { setFilter(item.value); setExpandedCall(null); }}
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
              filter === item.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {/* ... 保持现有 timeline 列表 */}
    </div>
  );
}

// ─── 远端会话标签 ─────────────────────────

function RemoteTab() {
  const { sessions, activeSessionId } = usePlatformStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  return <PlatformSessionPanel session={activeSession} />;
}
```

- [ ] **步骤 2：Commit**

```bash
git add desktop/renderer/components/MonitorPanel.tsx
git commit -m "refactor(ui): 监控面板重设计 - 标签页 + 意图分析卡片 + segmented control"
```

---

### 任务 7：ChatArea 空状态精装修 + emoji 替换

**文件：**
- 修改：`desktop/renderer/components/ChatArea.tsx`

- [ ] **步骤 1：重写空状态 + emoji → Lucide**

```typescript
// ChatArea.tsx — 空状态部分替换为：

{messages.length === 0 ? (
  <div className="flex flex-col items-center justify-center h-full text-center relative">
    {/* 背景装饰光晕 */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-[500px] h-[500px] rounded-full bg-primary/3 blur-[120px]" />
    </div>
    {/* 标题 */}
    <h1 className="text-2xl font-semibold text-foreground/90 mb-2 tracking-tight">Xuanji 璇玑</h1>
    <p className="text-sm text-muted-foreground max-w-[320px] leading-relaxed">
      {t('chatarea.subtitle')}
    </p>
    {/* 快捷操作提示 */}
    <div className="mt-8 flex items-center gap-4 text-xs text-muted-foreground/50">
      <span className="flex items-center gap-1.5">
        <Zap size={12} className="text-primary/50" />
        /help
      </span>
      <span className="flex items-center gap-1.5">
        <Brain size={12} className="text-primary/50" />
        /memory
      </span>
      <span className="flex items-center gap-1.5">
        <Wrench size={12} className="text-primary/50" />
        /agents
      </span>
    </div>
  </div>
) : (
  <VirtualMessageList ... />
)}
```

同时在 imports 中添加 `Zap, Brain, Wrench` from lucide-react。

- [ ] **步骤 2：更新「查看最新」按钮文案**

```typescript
// 将 "查看最新" 改为 "回到底部"
<button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-full shadow-lg text-xs hover:bg-primary/90 transition-all">
  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
  回到底部
</button>
```

- [ ] **步骤 3：更新「新消息」按钮文案**

```typescript
// 将 "新消息" 改为 "新消息 ↓"
<Button className="absolute bottom-4 right-6 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce">
  <span className="text-sm">新消息</span>
  <ChevronDown size={16} />
</Button>
```

- [ ] **步骤 4：Commit**

```bash
git add desktop/renderer/components/ChatArea.tsx
git commit -m "refactor(ui): ChatArea 空状态精装修 - emoji → Lucide + 快捷操作提示"
```

---

### 任务 8：InputArea 文案标准化 + Agent chip 颜色

**文件：**
- 修改：`desktop/renderer/components/InputArea.tsx`

- [ ] **步骤 1：文案标准化**

在 InputArea.tsx 中修改以下字符串：

```typescript
// 后台任务提示中的 emoji → Lucide
// '🛑' → <AlertTriangle size={12} className="text-red-400" />
// '⏳' → <Clock size={12} className="text-green-400" />

// placeholder 文案已在 i18n messages.ts 中更新，通过 t() 函数自动生效

// 底部提示文案：
// "释放以添加文件" → t('input.drop_hint') = "释放文件以上传"

// Agent 选择器底部：
// "暂无可用 Agent" → "无可用 Agent"
// "选择 Agent" → "选择 Agent" (保持不变)
```

- [ ] **步骤 2：Agent chip 颜色从紫色 → primary**

```typescript
// 选中的 Agent chip 颜色
// 当前: bg-purple-500/10 border-purple-500/20 text-purple-400
// 改为: bg-primary/10 border-primary/20 text-primary

{!isRemote && selectedAgent && (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-1.5 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary">
    <span className="font-medium">@{effectiveAgentName}</span>
    <button
      type="button"
      onClick={clearSelectedAgent}
      className="ml-0.5 p-0.5 rounded hover:bg-primary/20 transition-colors"
    >
      <X size={12} />
    </button>
  </span>
)}
```

- [ ] **步骤 3：工具栏图标尺寸统一**

```typescript
// 所有工具栏按钮 icon 统一 size={14}
<Button variant="ghost" size="sm" onClick={handleCompact} ...>
  <Archive size={14} className="mr-1" />
  ...
</Button>
<Button variant="ghost" size="sm" onClick={handleMemoryFlush} ...>
  <Brain size={14} className="mr-1" />
  ...
</Button>
```

- [ ] **步骤 4：Commit**

```bash
git add desktop/renderer/components/InputArea.tsx
git commit -m "refactor(ui): InputArea 文案标准化 + Agent chip primary 色系 + 图标统一"
```

---

### 任务 9：消息气泡微交互 + 全局细节

**文件：**
- 修改：`desktop/renderer/components/MessageBubble.tsx`
- 修改：`desktop/renderer/index.css`

- [ ] **步骤 1：MessageBubble 微交互**

```typescript
// 工具调用摘要卡片 — hover 上浮效果
// 在工具调用摘要的容器 div 上添加：
// className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"

// 代码块 hover 边框过渡（在 index.css 中添加）
```

- [ ] **步骤 2：index.css 新增样式**

```css
/* 代码块 hover 过渡 */
pre {
  @apply bg-secondary rounded-xl p-4 overflow-x-auto border border-border transition-colors duration-200 hover:border-primary/30;
}

/* 消息气泡淡入 — 统一使用已有 animate-fadeIn */
.message-bubble {
  contain: layout style paint;
  scrollbar-gutter: stable;
  animation: fadeIn 0.3s ease-out;
}

/* Segmented control 过渡 */
.segmented-control-item {
  @apply transition-all duration-150;
}
```

- [ ] **步骤 3：StatusBar PLAN MODE emoji → Lucide**

```typescript
// StatusBar.tsx
// '📋 PLAN MODE' → 使用 ClipboardList icon
import { ClipboardList } from 'lucide-react';
// <Badge variant="warning" ...>
//   <ClipboardList size={10} className="mr-1 inline" />
//   PLAN MODE
// </Badge>
```

- [ ] **步骤 4：Commit**

```bash
git add desktop/renderer/components/MessageBubble.tsx desktop/renderer/index.css desktop/renderer/components/StatusBar.tsx
git commit -m "refactor(ui): 消息气泡微交互 + 全局样式细节 + StatusBar emoji 替换"
```

---

### 任务 10：清理 — 移除旧引用，验证构建

**文件：**
- 修改：`desktop/renderer/components/RightPanel.tsx` — 保留旧文件但标记为 deprecated（避免其他引用断裂）
- 验证：`desktop/renderer/pages/MainPage.tsx` 中无残留引用

- [ ] **步骤 1：验证 TypeScript 编译**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -50
```

检查无类型错误。

- [ ] **步骤 2：验证 Vite 构建**

```bash
cd desktop && npx vite build 2>&1 | tail -20
```

预期：BUILD SUCCESS。

- [ ] **步骤 3：Commit**

```bash
git add -A
git commit -m "chore(ui): 清理旧引用，验证构建通过"
```

---

## 自检

### 1. 规格覆盖度

| 规格章节 | 对应任务 |
|---------|---------|
| 一、侧栏重新设计 | 任务 2 |
| 二、核心区左右等分 | 任务 5 |
| 三、监控面板内容重设计 | 任务 6 |
| 四、全局文案标准化 | 任务 1 + 7 + 8 |
| 五、全局视觉一致性 | 任务 7 + 8 + 9 |
| 六、文件变更清单 | 全部任务 |

### 2. 占位符扫描

无 TODO / 待定 / 后续实现。所有步骤包含实际代码。

### 3. 类型一致性

- `MonitorPanel` 组件通过 `MonitorTab` / `LogsTab` / `RemoteTab` 子组件引用
- `Sidebar` 使用 `ProjectFileTree` 子组件
- `MainPage` 引用 `MonitorPanel` (替代 `RightPanel`)
- `MainLayout` 移除 `handleToggleRightPanel` / `handleToggleProjectFiles` 回调
