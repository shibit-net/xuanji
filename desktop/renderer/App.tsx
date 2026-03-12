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

type ViewMode = 'chat' | 'settings';

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');

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
    </div>
  );
}
