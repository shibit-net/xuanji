// ============================================================
// TitleBar - 标题栏组件
// ============================================================

import { Minus, Square, X, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TitleBarProps {
  onCompact?: () => void;
  onShowStats?: () => void;
  onShowDiagnostics?: () => void;
  onToggleRightPanel?: () => void;
  onToggleProjectFiles?: () => void;
}

export default function TitleBar({ onCompact: _onCompact, onShowStats: _onShowStats, onShowDiagnostics: _onShowDiagnostics, onToggleRightPanel, onToggleProjectFiles }: TitleBarProps) {
  const handleMinimize = () => {
    window.electron?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.maximize();
  };

  const handleClose = () => {
    window.electron?.close();
  };

  return (
    <div className="flex-shrink-0 h-10 bg-bg-secondary flex items-center justify-between px-4 select-none drag">
      {/* 左侧：占位 */}
      <div className="w-20"></div>

      {/* 中间：应用名称 */}
      <div className="flex items-center gap-2">
        <div className="text-primary font-bold text-lg">璇玑</div>
      </div>

      {/* 右侧：工具按钮 + 窗口控制 */}
      <div className="flex items-center gap-1 no-drag">
        {/* 文件树开关 */}
        {onToggleProjectFiles && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleProjectFiles}
            title="项目文件"
            className="h-7 w-7"
          >
            <FolderTree size={14} />
          </Button>
        )}

        {/* 右侧监控面板开关 */}
        {onToggleRightPanel && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleRightPanel}
            title="监控面板"
            className="h-7 w-7"
          >
            <Square size={14} />
          </Button>
        )}

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={handleMinimize}
          title="最小化"
          className="h-7 w-7"
        >
          <Minus size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleMaximize}
          title="最大化"
          className="h-7 w-7"
        >
          <Square size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          title="关闭"
          className="h-7 w-7 hover:bg-red-500/80 hover:text-white"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
