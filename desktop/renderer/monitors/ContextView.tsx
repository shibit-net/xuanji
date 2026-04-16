// ============================================================
// Xuanji Desktop - 上下文视图组件
// ============================================================
// 职责：
// - 展示当前工作目录
// - 显示正在关注的文件
// - 显示最近访问的文件
// - 显示项目信息（如果有）
// - 数据来源：runtimeStore.contextInfo
// ============================================================


import { Folder, FileText, Clock, Package } from 'lucide-react';
import { useRuntimeStore } from '../stores';

export default function ContextView() {
  const contextInfo = useRuntimeStore((state) => state.contextInfo);

  if (!contextInfo) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">📂 上下文视图</div>
        <div className="p-3 bg-bg-primary rounded-lg text-sm text-text-secondary text-center">
          暂无上下文信息
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="text-sm font-semibold mb-2">📂 上下文视图</div>

      {/* 工作目录 */}
      <div className="p-3 bg-bg-primary rounded-lg space-y-2">
        <div className="flex items-center gap-2">
          <Folder size={14} className="text-primary flex-shrink-0" />
          <span className="text-xs text-text-secondary">工作目录</span>
        </div>
        <div className="text-sm font-mono text-text-primary break-all pl-5">
          {contextInfo.workingDirectory}
        </div>
      </div>

      {/* 项目信息 */}
      {contextInfo.projectInfo && (
        <div className="p-3 bg-bg-primary rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-primary flex-shrink-0" />
            <span className="text-xs text-text-secondary">项目信息</span>
          </div>
          <div className="pl-5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">名称</span>
              <span className="text-sm font-medium">{contextInfo.projectInfo.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">类型</span>
              <span className="text-sm font-mono">{contextInfo.projectInfo.type}</span>
            </div>
            {contextInfo.projectInfo.dependencies && contextInfo.projectInfo.dependencies.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-text-secondary mb-1">主要依赖</div>
                <div className="flex flex-wrap gap-1">
                  {contextInfo.projectInfo.dependencies.slice(0, 5).map((dep) => (
                    <span key={dep} className="text-xs bg-bg-secondary px-1.5 py-0.5 rounded">
                      {dep}
                    </span>
                  ))}
                  {contextInfo.projectInfo.dependencies.length > 5 && (
                    <span className="text-xs text-text-secondary">
                      +{contextInfo.projectInfo.dependencies.length - 5}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 关注的文件 */}
      {contextInfo.focusedFiles.length > 0 && (
        <div className="p-3 bg-bg-primary rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary flex-shrink-0" />
            <span className="text-xs text-text-secondary">关注的文件</span>
            <span className="text-xs text-text-tertiary">({contextInfo.focusedFiles.length})</span>
          </div>
          <div className="pl-5 space-y-1 max-h-40 overflow-y-auto">
            {contextInfo.focusedFiles.map((file, index) => (
              <div
                key={index}
                className="text-sm font-mono text-text-primary hover:text-primary transition-colors cursor-default break-all"
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近访问的文件 */}
      {contextInfo.recentFiles.length > 0 && (
        <div className="p-3 bg-bg-primary rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-primary flex-shrink-0" />
            <span className="text-xs text-text-secondary">最近访问</span>
            <span className="text-xs text-text-tertiary">({contextInfo.recentFiles.length})</span>
          </div>
          <div className="pl-5 space-y-1 max-h-40 overflow-y-auto">
            {contextInfo.recentFiles.map((file, index) => (
              <div
                key={index}
                className="text-sm font-mono text-text-secondary hover:text-text-primary transition-colors cursor-default break-all"
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
