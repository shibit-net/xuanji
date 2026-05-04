// ============================================================
// MainPage - 主聊天页面（三栏布局）
// ============================================================
// 聊天区 | 监控面板 (可折叠/可调) | 文件树面板 (可折叠/可调)
// ============================================================

import { useState, useEffect } from 'react';
import ChatArea from '../components/ChatArea';
import RightPanel from '../components/RightPanel';
import InputArea from '../components/InputArea';
import TodoPanel from '../components/TodoPanel';
import ProjectFilesPanel from '../components/ProjectFilesPanel';

export default function MainPage() {
  // 监控面板（RightPanel）
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth');
    return saved ? parseInt(saved, 10) : 380;
  });

  // 文件树面板（ProjectFilesPanel）
  const [projectFilesVisible, setProjectFilesVisible] = useState(true);
  const [projectFilesWidth, setProjectFilesWidth] = useState(() => {
    const saved = localStorage.getItem('projectFilesWidth');
    return saved ? parseInt(saved, 10) : 280;
  });
  const [projectFilesResizing, setProjectFilesResizing] = useState(false);
  const [projectFilesStartX, setProjectFilesStartX] = useState(0);
  const [projectFilesStartWidth, setProjectFilesStartWidth] = useState(0);

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
      {/* 中间内容区 */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatArea />
        <TodoPanel />
        <InputArea />
      </div>

      {/* 监控面板 */}
      {rightPanelVisible && (
        <RightPanel
          onToggle={() => setRightPanelVisible(!rightPanelVisible)}
          width={rightPanelWidth}
          onResize={handleRightPanelResize}
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
