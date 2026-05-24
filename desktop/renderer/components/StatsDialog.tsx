// ============================================================
// StatsDialog - 使用统计对话框（shadcn Dialog）
// ============================================================

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessageStore } from '../stores/messageStore';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';

interface StatsDialogProps {
  onClose: () => void;
}

export default function StatsDialog({ onClose }: StatsDialogProps) {
  const stats = useMessageStore((state) => state.stats);
  const messages = useMessageStore((state) => state.messages);
  const showTokenUsage = useConfigStore((s) => s.settings.showTokenUsage);
  const showCost = useConfigStore((s) => s.settings.showCost);
  const [backendStats, setBackendStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    try {
      const result = await window.electron.usageStats();
      if (result.success && result.stats) {
        setBackendStats(result.stats);
      }
    } catch (err) {
      console.error('Load stats error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const toolCallCount = messages.reduce((count, msg) => {
    return count + (msg.toolCalls?.length || 0);
  }, 0);

  const errorCount = messages.reduce((count, msg) => {
    return count + (msg.toolCalls?.filter(tc => tc.status === 'error').length || 0);
  }, 0);

  const language = useConfigStore((s) => s.settings.language as 'zh' | 'en');

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>📊</span>
            <span>{getDesktopLabel('statsdialog.title', language)}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={loadStats}
              disabled={loading}
              className="p-1 hover:bg-muted rounded transition-colors"
              title={getDesktopLabel('statsdialog.refresh_title', language)}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              ) : (
                <RefreshCw size={16} className="text-muted-foreground" />
              )}
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* 模型信息 */}
          <div>
            <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase">{getDesktopLabel('statsdialog.model', language)}</div>
            <div className="p-3 bg-muted rounded-lg text-sm">
              {stats.model}
            </div>
          </div>

          {/* Token 使用量 */}
          {showTokenUsage && (
          <div>
            <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase">{getDesktopLabel('statsdialog.token_usage', language)}</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">{getDesktopLabel('statsdialog.input', language)}</div>
                <div className="text-xl font-bold text-foreground">
                  {stats.tokenUsage.input.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">{getDesktopLabel('statsdialog.output', language)}</div>
                <div className="text-xl font-bold text-foreground">
                  {stats.tokenUsage.output.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* 费用 */}
          {showCost && (
          <div>
            <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase">{getDesktopLabel('statsdialog.cost', language)}</div>
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold text-foreground">
                ${stats.cost.toFixed(4)}
              </div>
            </div>
          </div>
          )}

          {/* 会话统计 */}
          <div>
            <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase">{getDesktopLabel('statsdialog.session_stats', language)}</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">{getDesktopLabel('statsdialog.msg_count', language)}</div>
                <div className="text-lg font-semibold">{messages.length}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">{getDesktopLabel('statsdialog.tool_calls', language)}</div>
                <div className="text-lg font-semibold">{toolCallCount}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">{getDesktopLabel('statsdialog.errors', language)}</div>
                <div className={`text-lg font-semibold ${errorCount > 0 ? 'text-destructive' : ''}`}>
                  {errorCount}
                </div>
              </div>
            </div>
          </div>

          {/* 后端状态 */}
          {backendStats && (
            <div>
              <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase">{getDesktopLabel('statsdialog.backend_status', language)}</div>
              <div className="p-3 bg-muted rounded-lg text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{getDesktopLabel('statsdialog.status', language)}</span>
                  <span>{backendStats.status}</span>
                </div>
                {backendStats.currentIteration && (
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">{getDesktopLabel('statsdialog.iteration', language)}</span>
                    <span>{backendStats.currentIteration}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
