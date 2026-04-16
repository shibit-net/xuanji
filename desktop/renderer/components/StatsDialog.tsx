// ============================================================
// StatsDialog - 使用统计对话框
// ============================================================

import { useState, useEffect } from 'react';
import { X, Loader2, RefreshCw } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

interface StatsDialogProps {
  onClose: () => void;
}

export default function StatsDialog({ onClose }: StatsDialogProps) {
  const stats = useChatStore((state) => state.stats);
  const messages = useChatStore((state) => state.messages);
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

  // 从消息中统计工具调用
  const toolCallCount = messages.reduce((count, msg) => {
    return count + (msg.toolCalls?.length || 0);
  }, 0);

  const errorCount = messages.reduce((count, msg) => {
    return count + (msg.toolCalls?.filter(tc => tc.status === 'error').length || 0);
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-[480px] bg-bg-secondary rounded-xl shadow-2xl border border-bg-tertiary">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-bg-tertiary">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <span className="font-semibold">使用统计</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadStats}
              disabled={loading}
              className="p-1 hover:bg-bg-tertiary rounded transition-colors"
              title="刷新"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-text-secondary" />
              ) : (
                <RefreshCw size={16} className="text-text-secondary" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-bg-tertiary rounded transition-colors"
            >
              <X size={16} className="text-text-secondary" />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-4">
          {/* 模型信息 */}
          <div>
            <div className="text-xs text-text-secondary mb-2 font-semibold uppercase">模型</div>
            <div className="p-3 bg-bg-primary rounded-lg text-sm">
              {stats.model}
            </div>
          </div>

          {/* Token 使用量 */}
          <div>
            <div className="text-xs text-text-secondary mb-2 font-semibold uppercase">Token 使用量</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-bg-primary rounded-lg">
                <div className="text-xs text-text-secondary">输入</div>
                <div className="text-xl font-bold text-primary">
                  {stats.tokenUsage.input.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-bg-primary rounded-lg">
                <div className="text-xs text-text-secondary">输出</div>
                <div className="text-xl font-bold text-primary">
                  {stats.tokenUsage.output.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* 费用 */}
          <div>
            <div className="text-xs text-text-secondary mb-2 font-semibold uppercase">费用</div>
            <div className="p-3 bg-bg-primary rounded-lg">
              <div className="text-2xl font-bold text-primary">
                ${stats.cost.toFixed(4)}
              </div>
            </div>
          </div>

          {/* 会话统计 */}
          <div>
            <div className="text-xs text-text-secondary mb-2 font-semibold uppercase">会话统计</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-bg-primary rounded-lg">
                <div className="text-xs text-text-secondary">消息数</div>
                <div className="text-lg font-semibold">{messages.length}</div>
              </div>
              <div className="p-3 bg-bg-primary rounded-lg">
                <div className="text-xs text-text-secondary">工具调用</div>
                <div className="text-lg font-semibold">{toolCallCount}</div>
              </div>
              <div className="p-3 bg-bg-primary rounded-lg">
                <div className="text-xs text-text-secondary">错误</div>
                <div className={`text-lg font-semibold ${errorCount > 0 ? 'text-red-500' : ''}`}>
                  {errorCount}
                </div>
              </div>
            </div>
          </div>

          {/* 后端状态 */}
          {backendStats && (
            <div>
              <div className="text-xs text-text-secondary mb-2 font-semibold uppercase">后端状态</div>
              <div className="p-3 bg-bg-primary rounded-lg text-sm">
                <div className="flex justify-between">
                  <span className="text-text-secondary">状态</span>
                  <span>{backendStats.status}</span>
                </div>
                {backendStats.currentIteration && (
                  <div className="flex justify-between mt-1">
                    <span className="text-text-secondary">迭代次数</span>
                    <span>{backendStats.currentIteration}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
