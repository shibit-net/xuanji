// ============================================================
// Xuanji Desktop - ChatView 组件
// ============================================================
// 职责：
// - 对话视图的容器组件
// - 包装现有的 ChatArea 和 InputArea
// - 悬浮任务面板
// - 多 agent 场景的 EnhancedWorkspace
// ============================================================

import { useState } from 'react';
import ChatArea from '../components/ChatArea';
import InputArea from '../components/InputArea';
import { FloatingTodoPanel } from '../components/FloatingTodoPanel';
import EnhancedWorkspace from '../layout/EnhancedWorkspace';

export default function ChatView() {
  // 模拟是否启用多 agent 模式
  // 实际应用中，这个状态应该从 store 中获取
  const [isMultiAgentMode, setIsMultiAgentMode] = useState(true);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 切换模式按钮 */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setIsMultiAgentMode(!isMultiAgentMode)}
          className="px-4 py-2 bg-bg-secondary text-text-primary rounded-md hover:bg-bg-tertiary transition-colors shadow-md"
        >
          {isMultiAgentMode ? '切换到普通模式' : '切换到多 Agent 模式'}
        </button>
      </div>

      {/* 根据模式渲染不同的工作区 */}
      {isMultiAgentMode ? (
        <EnhancedWorkspace />
      ) : (
        <>
          {/* 对话区域 - 占据剩余空间，内部可滚动 */}
          <ChatArea />

          {/* 输入区域 - 固定在底部，带相对定位供浮动面板使用 */}
          <div className="relative">
            {/* 浮动任务面板 - 悬浮在输入框上方 */}
            <FloatingTodoPanel />

            <InputArea />
          </div>
        </>
      )}
    </div>
  );
}
