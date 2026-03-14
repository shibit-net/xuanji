// ============================================================
// Xuanji Desktop - 主应用组件
// ============================================================

import React, { useState } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import RightPanel from './components/RightPanel';
import InputArea from './components/InputArea';
import StatusBar from './components/StatusBar';
import SettingsPanel from './components/SettingsPanel';
import AgentManager from './components/AgentManager';
import PermissionDialog from './components/PermissionDialog';
import PlanReviewDialog from './components/PlanReviewDialog';
import AskUserDialog from './components/AskUserDialog';
import StatsDialog from './components/StatsDialog';
import DiagnosticsDialog from './components/DiagnosticsDialog';
import { ToastProvider } from './components/Toast';
import { useChatStore } from './stores/chatStore';

type ViewMode = 'chat' | 'settings' | 'agents';
type DialogType = 'stats' | 'diagnostics' | null;

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);

  // 权限交互状态
  const permissionRequest = useChatStore((state) => state.permissionRequest);
  const planReviewRequest = useChatStore((state) => state.planReviewRequest);
  const askUserRequest = useChatStore((state) => state.askUserRequest);
  const setPermissionRequest = useChatStore((state) => state.setPermissionRequest);
  const setPlanReviewRequest = useChatStore((state) => state.setPlanReviewRequest);
  const setAskUserRequest = useChatStore((state) => state.setAskUserRequest);

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
    <ToastProvider>
      <div className="flex flex-col h-screen w-screen bg-bg-primary text-text-primary">
        {/* 标题栏 */}
        <TitleBar
          onCompact={handleCompact}
          onShowStats={() => setActiveDialog('stats')}
          onShowDiagnostics={() => setActiveDialog('diagnostics')}
          onToggleRightPanel={() => setRightPanelVisible(!rightPanelVisible)}
        />

        {/* 主内容区域 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧边栏 */}
          {sidebarVisible && (
            <Sidebar
              onToggle={() => setSidebarVisible(!sidebarVisible)}
              onOpenSettings={() => setViewMode(viewMode === 'settings' ? 'chat' : 'settings')}
              onOpenAgents={() => setViewMode(viewMode === 'agents' ? 'chat' : 'agents')}
            />
          )}

          {/* 中间内容区 */}
          {viewMode === 'settings' ? (
            <SettingsPanel onClose={() => setViewMode('chat')} />
          ) : viewMode === 'agents' ? (
            <AgentManager onClose={() => setViewMode('chat')} />
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <ChatArea />
              <InputArea />
            </div>
          )}

          {/* 右侧面板（仅对话模式显示） */}
          {viewMode === 'chat' && rightPanelVisible && (
            <RightPanel onToggle={() => setRightPanelVisible(!rightPanelVisible)} />
          )}
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
    </ToastProvider>
  );
}
