// ============================================================
// IntentDialog - 意图选择对话框（shadcn Dialog）
// ============================================================

import { UserIntent, IntentAnalysis } from '../services/messageIntentAnalyzer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface IntentDialogProps {
  pendingMessage: string;
  analysisResult: IntentAnalysis | null;
  onSelect: (intent: UserIntent) => void;
  onCancel: () => void;
}

export default function IntentDialog({
  analysisResult,
  onSelect,
  onCancel,
}: IntentDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>你想做什么？</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {analysisResult && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
              <div className="font-semibold">AI 推测</div>
              <div className="mt-1">{analysisResult.suggestedAction}</div>
              <div className="text-xs opacity-70 mt-1">
                理由：{analysisResult.reasoning}
                ({analysisResult.method === 'llm' ? 'AI 分析' : '关键词匹配'}，
                {Math.round(analysisResult.confidence * 100)}% 置信度)
              </div>
            </div>
          )}

          <button
            onClick={() => onSelect('interrupt_replace')}
            className={`w-full p-3 rounded-lg text-left transition-all border ${
              analysisResult?.type === 'interrupt_replace'
                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                : 'bg-muted text-foreground border-border hover:bg-accent'
            }`}
          >
            <div className="font-semibold">⏹️ 中断当前任务，重新开始</div>
            <div className="text-xs opacity-70 mt-0.5">意图：修正或替换当前指令</div>
          </button>

          <button
            onClick={() => onSelect('supplement')}
            className={`w-full p-3 rounded-lg text-left transition-all border ${
              analysisResult?.type === 'supplement'
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                : 'bg-muted text-foreground border-border hover:bg-accent'
            }`}
          >
            <div className="font-semibold">💬 作为补充输入</div>
            <div className="text-xs opacity-70 mt-0.5">意图：补充说明当前任务</div>
          </button>

          <button
            onClick={() => onSelect('new_task')}
            className={`w-full p-3 rounded-lg text-left transition-all border ${
              analysisResult?.type === 'new_task'
                ? 'bg-green-500/10 text-green-400 border-green-500/30'
                : 'bg-muted text-foreground border-border hover:bg-accent'
            }`}
          >
            <div className="font-semibold">📋 加入队列等待</div>
            <div className="text-xs opacity-70 mt-0.5">意图：新任务，等当前完成</div>
          </button>
        </div>

        <button
          onClick={onCancel}
          className="w-full mt-4 p-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          取消
        </button>
      </DialogContent>
    </Dialog>
  );
}
