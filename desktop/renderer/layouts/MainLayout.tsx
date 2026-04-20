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
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';

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

  // 权限交互状态
  const permissionRequest = useChatStore((state) => state.permissionRequest);
  const planReviewRequest = useChatStore((state) => state.planReviewRequest);
  const askUserRequest = useChatStore((state) => state.askUserRequest);
  const setPermissionRequest = useChatStore((state) => state.setPermissionRequest);
  const setPlanReviewRequest = useChatStore((state) => state.setPlanReviewRequest);
  const setAskUserRequest = useChatStore((state) => state.setAskUserRequest);

  // 用户登录成功后，加载 agent 配置
  useEffect(() => {
    if (user?.userId) {
      console.log('用户已登录，加载 agent 配置，userId:', user.userId);
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

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-primary text-text-primary">
      {/* 标题栏 */}
      <TitleBar
        onCompact={handleCompact}
        onShowStats={() => setActiveDialog('stats')}
        onShowDiagnostics={() => setActiveDialog('diagnostics')}
        onToggleRightPanel={() => {
          // 仅在聊天页面有效
          if (location.pathname === '/chat' || location.pathname === '/') {
            // 通过事件通知 MainPage 切换右侧面板
            window.dispatchEvent(new CustomEvent('toggle-right-panel'));
          }
        }}
      />

      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧边栏 */}
        {sidebarVisible && (
          <Sidebar
            onToggle={() => setSidebarVisible(!sidebarVisible)}
            onOpenAgents={() => navigate(location.pathname === '/agents' ? '/chat' : '/agents')}
            onOpenMemory={() => navigate(location.pathname === '/memory' ? '/chat' : '/memory')}
          />
        )}

        {/* 页面内容 */}
        {children}
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
    </div>
  );
}
