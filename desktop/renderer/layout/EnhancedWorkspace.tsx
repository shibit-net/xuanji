// ============================================================
// EnhancedWorkspace - 增强版工作区组件
// ============================================================
// 职责：
// - 作为多 agent 场景的主容器
// - 管理不同面板的布局和交互
// - 协调不同组件之间的数据流
// ============================================================

import React from 'react';
import AgentExecutionPanel from '../components/AgentExecutionPanel';
import ChatArea from '../components/ChatArea';
import InputArea from '../components/InputArea';

interface EnhancedWorkspaceProps {
  children?: React.ReactNode;
}

export default function EnhancedWorkspace(_props: EnhancedWorkspaceProps) {
  return (
    <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden">
      {/* Agent 执行面板 - 上方，占据 40% 高度 */}
      <div className="flex-2 min-h-[200px] border-b border-border-secondary">
        <AgentExecutionPanel />
      </div>

      {/* 对话区域 - 下方，占据 60% 高度 */}
      <div className="flex-3 min-h-[300px]">
        <ChatArea />
      </div>

      {/* 输入区域 - 底部，固定高度 */}
      <div className="relative border-t border-border-secondary">
        <InputArea />
      </div>
    </div>
  );
}
