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


import { memo } from 'react';
import { Folder, FileText, Clock, Package } from 'lucide-react';
import { useConversationStore } from '../stores/ConversationStore';
import { getDesktopLabel } from '../i18n';
import { useConfigStore } from '../stores/configStore';

export default memo(function ContextView() {
  const contextInfo = useConversationStore((state) => state.contextInfo);
  const language = useConfigStore((s) => s.settings.language);

  if (!contextInfo) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">{getDesktopLabel('context.title', language)}</div>
        <div className="p-3 bg-background rounded-lg text-sm text-muted-foreground text-center">
          {getDesktopLabel('context.empty', language)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="text-sm font-semibold mb-2">{getDesktopLabel('context.title', language)}</div>

      {/* 工作目录 */}
      <div className="p-3 bg-background rounded-lg space-y-2">
        <div className="flex items-center gap-2">
          <Folder size={14} className="text-primary flex-shrink-0" />
          <span className="text-xs text-muted-foreground">{getDesktopLabel('context.working_directory', language)}</span>
        </div>
        <div className="text-sm font-mono text-foreground break-all pl-5">
          {contextInfo.workingDirectory}
        </div>
      </div>

      {/* 项目信息 */}
      {contextInfo.projectInfo && (
        <div className="p-3 bg-background rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-primary flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{getDesktopLabel('context.project_info', language)}</span>
          </div>
          <div className="pl-5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{getDesktopLabel('context.name', language)}</span>
              <span className="text-sm font-medium">{contextInfo.projectInfo.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{getDesktopLabel('context.type', language)}</span>
              <span className="text-sm font-mono">{contextInfo.projectInfo.type}</span>
            </div>
            {contextInfo.projectInfo.dependencies && contextInfo.projectInfo.dependencies.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">{getDesktopLabel('context.main_deps', language)}</div>
                <div className="flex flex-wrap gap-1">
                  {contextInfo.projectInfo.dependencies.slice(0, 5).map((dep) => (
                    <span key={dep} className="text-xs bg-card px-1.5 py-0.5 rounded">
                      {dep}
                    </span>
                  ))}
                  {contextInfo.projectInfo.dependencies.length > 5 && (
                    <span className="text-xs text-muted-foreground">
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
      {(contextInfo?.focusedFiles?.length ?? 0) > 0 && (
        <div className="p-3 bg-background rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{getDesktopLabel('context.focused_files', language)}</span>
            <span className="text-xs text-muted-foreground/70">({contextInfo.focusedFiles?.length ?? 0})</span>
          </div>
          <div className="pl-5 space-y-1 max-h-40 overflow-y-auto">
            {contextInfo.focusedFiles?.map((file, index) => (
              <div
                key={index}
                className="text-sm font-mono text-foreground hover:text-primary transition-colors cursor-default break-all"
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近访问的文件 */}
      {(contextInfo?.recentFiles?.length ?? 0) > 0 && (
        <div className="p-3 bg-background rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-primary flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{getDesktopLabel('context.recent_files', language)}</span>
            <span className="text-xs text-muted-foreground/70">({contextInfo.recentFiles?.length ?? 0})</span>
          </div>
          <div className="pl-5 space-y-1 max-h-40 overflow-y-auto">
            {contextInfo.recentFiles?.map((file, index) => (
              <div
                key={index}
                className="text-sm font-mono text-muted-foreground hover:text-foreground transition-colors cursor-default break-all"
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
