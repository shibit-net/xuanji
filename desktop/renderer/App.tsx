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
import PermissionDialog from './components/PermissionDialog';
import PlanReviewDialog from './components/PlanReviewDialog';
import AskUserDialog from './components/AskUserDialog';
import { useChatStore } from './stores/chatStore';

type ViewMode = 'chat' | 'settings';

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');

  // 权限交互状态
  const permissionRequest = useChatStore((state) => state.permissionRequest);
  const planReviewRequest = useChatStore((state) => state.planReviewRequest);
  const askUserRequest = useChatStore((state) => state.askUserRequest);
  const setPermissionRequest = useChatStore((state) => state.setPermissionRequest);
  const setPlanReviewRequest = useChatStore((state) => state.setPlanReviewRequest);
  const setAskUserRequest = useChatStore((state) => state.setAskUserRequest);

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-primary text-text-primary">
      {/* 标题栏 */}
      <TitleBar />

      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧边栏 */}
        {sidebarVisible && (
          <Sidebar
            onToggle={() => setSidebarVisible(!sidebarVisible)}
            onOpenSettings={() => setViewMode(viewMode === 'settings' ? 'chat' : 'settings')}
          />
        )}

        {/* 中间内容区 */}
        {viewMode === 'settings' ? (
          <SettingsPanel onClose={() => setViewMode('chat')} />
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
    </div>
  );
}
