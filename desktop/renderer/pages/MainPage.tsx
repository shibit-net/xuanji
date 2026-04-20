// ============================================================
// MainPage - 主聊天页面
// ============================================================

import { useState, useEffect } from 'react';
import ChatArea from '../components/ChatArea';
import RightPanel from '../components/RightPanel';
import InputArea from '../components/InputArea';
import TodoPanel from '../components/TodoPanel';

export default function MainPage() {
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth');
    return saved ? parseInt(saved, 10) : 320;
  });

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

  const handleRightPanelResize = (width: number) => {
    setRightPanelWidth(width);
    localStorage.setItem('rightPanelWidth', width.toString());
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 中间内容区 */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatArea />
        <TodoPanel />
        <InputArea />
      </div>

      {/* 右侧面板 */}
      {rightPanelVisible && (
        <RightPanel
          onToggle={() => setRightPanelVisible(!rightPanelVisible)}
          width={rightPanelWidth}
          onResize={handleRightPanelResize}
        />
      )}
    </div>
  );
}
