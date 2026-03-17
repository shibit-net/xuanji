// ============================================================
// Xuanji Desktop - ChatView 组件
// ============================================================
// 职责：
// - 对话视图的容器组件
// - 包装现有的 ChatArea 和 InputArea
// - 悬浮任务面板
// ============================================================

import React from 'react';
import ChatArea from '../components/ChatArea';
import InputArea from '../components/InputArea';
import { FloatingTodoPanel } from '../components/FloatingTodoPanel';

export default function ChatView() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 对话区域 - 占据剩余空间，内部可滚动 */}
      <ChatArea />

      {/* 输入区域 - 固定在底部，带相对定位供浮动面板使用 */}
      <div className="relative">
        {/* 浮动任务面板 - 悬浮在输入框上方 */}
        <FloatingTodoPanel />

        <InputArea />
      </div>
    </div>
  );
}
