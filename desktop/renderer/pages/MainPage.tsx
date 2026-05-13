// ============================================================
// MainPage - 主聊天页面（三栏布局）
// ============================================================
// 聊天区 | 监控面板 (可折叠/可调) | 文件树面板 (可折叠/可调)
// ============================================================

import React, { useState, useEffect } from 'react';
import ChatArea from '../components/ChatArea';
import RightPanel from '../components/RightPanel';
import InputArea from '../components/InputArea';
import TodoPanel from '../components/TodoPanel';
import ProjectFilesPanel from '../components/ProjectFilesPanel';
import { Loader2 } from 'lucide-react';
import { useConversationStore } from '../stores/ConversationStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { registerEventAdapter } from '../services/EventAdapter';

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function MainPage() {
  // 初始化事件桥接（只执行一次）
  React.useEffect(() => {
    registerEventAdapter();
  }, []);

  // 监控面板（RightPanel）
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth');
    return saved ? parseInt(saved, 10) : 520;
  });

  // 文件树面板（ProjectFilesPanel）
  const [projectFilesVisible, setProjectFilesVisible] = useState(true);
  const [projectFilesWidth, setProjectFilesWidth] = useState(() => {
    const saved = localStorage.getItem('projectFilesWidth');
    return saved ? parseInt(saved, 10) : 220;
  });
  const [projectFilesResizing, setProjectFilesResizing] = useState(false);
  const [projectFilesStartX, setProjectFilesStartX] = useState(0);
  const [projectFilesStartWidth, setProjectFilesStartWidth] = useState(0);

  // 全局状态统计

  // iteration
  const currentIteration = useConversationStore((s) => s.iteration);

  // session 初始化状态
  const sessionStatus = useSessionInitStore((s) => s.status);

  // token 统计
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

  // 监听右侧面板切换事件
  useEffect(() => {
    const handleToggle = () => {
      setRightPanelVisible((prev) => !prev);
    };
    window.addEventListener('toggle-right-panel', handleToggle);
    return () => {
      window.removeEventListener('toggle-right-panel', handleToggle);
    };
  }, []);

  // 监听文件树面板切换事件
  useEffect(() => {
    const handleToggle = () => {
      setProjectFilesVisible((prev) => !prev);
    };
    window.addEventListener('toggle-project-files', handleToggle);
    return () => {
      window.removeEventListener('toggle-project-files', handleToggle);
    };
  }, []);

  // 文件树面板拖拽调宽
  useEffect(() => {
    if (!projectFilesResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - projectFilesStartX;
      const newWidth = Math.max(200, Math.min(500, projectFilesStartWidth - delta));
      setProjectFilesWidth(newWidth);
    };
    const handleMouseUp = () => {
      setProjectFilesResizing(false);
      localStorage.setItem('projectFilesWidth', projectFilesWidth.toString());
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [projectFilesResizing, projectFilesStartX, projectFilesStartWidth, projectFilesWidth]);

  const handleRightPanelResize = (width: number) => {
    setRightPanelWidth(width);
    localStorage.setItem('rightPanelWidth', width.toString());
  };

  const handleFilePanelResizeStart = (e: React.MouseEvent) => {
    setProjectFilesResizing(true);
    setProjectFilesStartX(e.clientX);
    setProjectFilesStartWidth(projectFilesWidth);
    e.preventDefault();
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 中间内容区 — 对话框 */}
      <div className="flex-[2] min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* 全局状态栏 */}
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-b border-border bg-white/[0.02]">
          {/* Session 状态指示器 */}
          {sessionStatus !== 'ready' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              {sessionStatus === 'initializing' ? (
                <>
                  <Loader2 size={12} className="animate-spin text-blue-400" />
                  <span className="text-blue-400">正在初始化会话...</span>
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
          <div className="flex items-center gap-1.5 text-[11px] text-white/40">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span>{currentIteration} 次迭代</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-white/40">
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg>
              入 {formatToken(totalTokens.input)}
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg>
              出 {formatToken(totalTokens.output)}
            </span>
          </div>
        </div>
        <ChatArea />
        <TodoPanel />
        <InputArea />
      </div>

      {/* 监控面板 — 与对话框 1:1 占比 */}
      {rightPanelVisible && (
        <RightPanel
          onToggle={() => setRightPanelVisible(!rightPanelVisible)}
          width={rightPanelWidth}
          onResize={handleRightPanelResize}
          className="flex-[2] min-w-0"
        />
      )}

      {/* 文件树面板 */}
      {projectFilesVisible && (
        <div className="relative flex-shrink-0">
          {/* 拖拽手柄 */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary transition-colors z-10"
            onMouseDown={handleFilePanelResizeStart}
            style={{ userSelect: 'none' }}
          />
          <div style={{ width: `${projectFilesWidth}px` }} className="h-full">
            <ProjectFilesPanel
              onToggle={() => setProjectFilesVisible(!projectFilesVisible)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
