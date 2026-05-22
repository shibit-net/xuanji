// ============================================================
// MainLayout - 主应用布局
// ============================================================

import { useState, useEffect, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import TitleBar from '../components/TitleBar';
import Sidebar from '../components/Sidebar';
import StatusBar from '../components/StatusBar';
import PermissionDialog from '../components/PermissionDialog';
import PlanReviewDialog from '../components/PlanReviewDialog';
import AskUserDialog from '../components/AskUserDialog';
import StatsDialog from '../components/StatsDialog';
import DiagnosticsDialog from '../components/DiagnosticsDialog';
import PlatformSetupDialog from '../components/PlatformSetupDialog';
import { usePlatformEvents } from '../hooks/usePlatformEvents';
import { useSessionStore } from '../stores/sessionStore';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { usePlatformStore } from '../stores/platformStore';

interface MainLayoutProps {
  children: ReactNode;
}

type DialogType = 'stats' | 'diagnostics' | null;

export default function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);

  const { user } = useAuthStore();
  const { loadAgents } = useConfigStore();
  const { setupDialogOpen } = usePlatformStore();
  const activeSessionId = usePlatformStore((s) => s.activeSessionId);

  // 监听远端平台 IPC 事件
  usePlatformEvents();

  // 权限交互状态
  const permissionRequest = useSessionStore((state) => state.permissionRequest);
  const planReviewRequest = useSessionStore((state) => state.planReviewRequest);
  const askUserRequest = useSessionStore((state) => state.askUserRequest);
  const setPermissionRequest = useSessionStore((state) => state.setPermissionRequest);
  const setPlanReviewRequest = useSessionStore((state) => state.setPlanReviewRequest);
  const setAskUserRequest = useSessionStore((state) => state.setAskUserRequest);

  // 用户登录成功后，加载 agent 配置（UI 设置由 SessionInit 同步）
  useEffect(() => {
    if (user?.userId) {
      loadAgents();
    }
  }, [user?.userId, loadAgents]);

  // Persona 更新事件监听
  useEffect(() => {
    window.electron.onPersonaUpdated((_data) => {
      // persona 已保存，无需前端额外处理
    });
  }, []);

  // 压缩上下文
  const handleCompact = async () => {
    try {
      const result = await window.electron.compact({});
      if (result.success && result.result) {
        alert(`压缩完成！\n原始: ${result.result.originalTokens} tokens\n压缩后: ${result.result.compressedTokens} tokens\n压缩率: ${(result.result.compressionRatio * 100).toFixed(1)}%`);
      } else if (result.error) {
        alert(`压缩失败: ${result.error}`);
      } else {
        alert('没有足够的上下文需要压缩');
      }
    } catch (err) {
      alert(`压缩失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleRightPanel = () => {
    if (location.pathname === '/chat' || location.pathname === '/') {
      window.dispatchEvent(new CustomEvent('toggle-right-panel'));
    }
  };

  const handleToggleProjectFiles = () => {
    if (location.pathname === '/chat' || location.pathname === '/') {
      window.dispatchEvent(new CustomEvent('toggle-project-files'));
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground">
      {/* 标题栏 */}
      <TitleBar
        onCompact={handleCompact}
        onShowStats={() => setActiveDialog('stats')}
        onShowDiagnostics={() => setActiveDialog('diagnostics')}
        onToggleRightPanel={handleToggleRightPanel}
        onToggleProjectFiles={handleToggleProjectFiles}
      />

      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧边栏 */}
        {sidebarVisible && (
          <Sidebar
            onToggle={() => setSidebarVisible(!sidebarVisible)}
            onOpenAgents={() => navigate(location.pathname === '/agents' ? '/chat' : '/agents')}
            onOpenMemory={() => navigate(location.pathname === '/memory' ? '/chat' : '/memory')}
            onOpenScheduler={() => navigate(location.pathname === '/scheduler' ? '/chat' : '/scheduler')}
            onOpenSystemPrompt={() => navigate(location.pathname === '/system-prompt' ? '/chat' : '/system-prompt')}
            onOpenPermissions={() => navigate(location.pathname === '/permissions' ? '/chat' : '/permissions')}
            onOpenSkillsMCP={() => navigate(location.pathname === '/skills-mcp' ? '/chat' : '/skills-mcp')}
            onOpenSettings={() => navigate(location.pathname === '/settings' ? '/chat' : '/settings')}
            onOpenTools={() => navigate(location.pathname === '/tools' ? '/chat' : '/tools')}
          />
        )}

        {/* 页面内容 — 始终渲染 MainPage，监控面板保持可见 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>

      {/* 状态栏 */}
      <StatusBar />

      {/* 权限交互对话框 */}
      {permissionRequest && (
        <PermissionDialog
          request={permissionRequest}
          onClose={() => setPermissionRequest(null)}
        />
      )}

      {planReviewRequest && (
        <PlanReviewDialog
          request={planReviewRequest}
          onClose={() => setPlanReviewRequest(null)}
        />
      )}

      {askUserRequest && (
        <AskUserDialog
          request={askUserRequest}
          onClose={() => setAskUserRequest(null)}
        />
      )}

      {/* 功能对话框 */}
      {activeDialog === 'stats' && (
        <StatsDialog onClose={() => setActiveDialog(null)} />
      )}

      {activeDialog === 'diagnostics' && (
        <DiagnosticsDialog onClose={() => setActiveDialog(null)} />
      )}

      {/* 远端平台接入配置 */}
      {setupDialogOpen && <PlatformSetupDialog />}
    </div>
  );
}
