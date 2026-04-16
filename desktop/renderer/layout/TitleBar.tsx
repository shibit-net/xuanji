// ============================================================
// Xuanji Desktop - TitleBar 组件（新架构）
// ============================================================
// 职责：
// - 显示应用标题和版本
// - 显示当前模型和 Token 统计（从 runtimeStore）
// - 窗口控制按钮（最小化、最大化、关闭）
// ============================================================


import { Minus, Square, X } from 'lucide-react';
import { useRuntimeStore } from '../stores';
import { useConfigStore } from '../stores';

export default function TitleBar() {
  const { tokenUsage, cost } = useRuntimeStore();
  const model = useConfigStore((state) => state.settings?.model?.defaultModel || 'claude-3-5-haiku-20241022');

  const handleMinimize = () => {
    window.electron?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.maximize();
  };

  const handleClose = () => {
    window.electron?.close();
  };

  // 简化模型名称显示
  const displayModel = model?.includes('haiku')
    ? 'Haiku 4.5'
    : model?.includes('sonnet')
    ? 'Sonnet'
    : model?.includes('opus')
    ? 'Opus'
    : model || 'Unknown';

  return (
    <div className="h-10 bg-bg-secondary flex items-center justify-between px-4 select-none drag border-b border-bg-tertiary">
      {/* 左侧：应用标题 */}
      <div className="flex items-center gap-2">
        <div className="text-primary font-bold">⭐ Xuanji</div>
      </div>

      {/* 中间：模型信息和统计 */}
      <div className="flex items-center gap-4 text-sm text-text-secondary">
        <div className="text-text-primary">{displayModel}</div>
        <div>↑{tokenUsage.input.toLocaleString()}</div>
        <div>↓{tokenUsage.output.toLocaleString()}</div>
        <div>${cost.toFixed(4)}</div>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center gap-2 no-drag">
        <button
          onClick={handleMinimize}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          title="最小化"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          title="最大化"
        >
          <Square size={16} />
        </button>
        <button
          onClick={handleClose}
          className="p-1 hover:bg-error/80 rounded transition-colors"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
