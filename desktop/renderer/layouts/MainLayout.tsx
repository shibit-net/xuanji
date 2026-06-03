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
import { useMessageStore } from '../stores/messageStore';
import { getDesktopLabel } from '../i18n';

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

  // 用户登录成功后，加载 agent 配置 + 初始化 session
  useEffect(() => {
    if (user?.userId) {
      loadAgents();
      // 延迟初始化 session（让 UI 先渲染再发起重量级操作）
      const timer = setTimeout(() => {
        window.electron.agentInit?.().catch((err: any) => {
          console.warn('[MainLayout] session init failed:', err);
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [user?.userId, loadAgents]);

  // Persona 更新事件监听
  useEffect(() => {
    window.electron.onPersonaUpdated((_data) => {
      // persona 已保存，无需前端额外处理
    });
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') {
        e.preventDefault();
        const messages = useMessageStore.getState().messages;
        if (messages.length === 0) return;
        const language = useConfigStore.getState().settings.language as 'zh' | 'en';
        const confirmed = confirm(language === 'en' ? 'Start a new session? Current messages will be cleared.' : '开始新会话？当前消息将被清除。');
        if (confirmed) {
          useMessageStore.getState().reset();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 压缩上下文
  const handleCompact = async () => {
    try {
      const language = useConfigStore.getState().settings.language as 'zh' | 'en';
      const result = await window.electron.compact({});
      if (result.success && result.result) {
        alert(getDesktopLabel('mainlayout.compact_done', language)
          .replace('{original}', String(result.result.originalTokens))
          .replace('{compressed}', String(result.result.compressedTokens))
          .replace('{ratio}', (result.result.compressionRatio * 100).toFixed(1)));
      } else if (result.error) {
        alert(getDesktopLabel('mainlayout.compact_failed', language).replace('{error}', result.error));
      } else {
        alert(getDesktopLabel('mainlayout.compact_skip', language));
      }
    } catch (err) {
      const language = useConfigStore.getState().settings.language as 'zh' | 'en';
      alert(getDesktopLabel('mainlayout.compact_failed', language).replace('{error}', err instanceof Error ? err.message : String(err)));
    }
  };

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
