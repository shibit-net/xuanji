// ============================================================
// IntentDialog - 意图选择对话框（shadcn Dialog）
// ============================================================

import { UserIntent, IntentAnalysis } from '../services/messageIntentAnalyzer';
import { OctagonX, MessageSquarePlus, ListPlus, Brain } from 'lucide-react';
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

interface IntentOption {
  intent: UserIntent;
  icon: React.ReactNode;
  title: string;
  desc: string;
  activeClass: string;
}

export default function IntentDialog({
  analysisResult,
  onSelect,
  onCancel,
}: IntentDialogProps) {
  const intents: IntentOption[] = [
    {
      intent: 'interrupt_replace',
      icon: <OctagonX size={18} />,
      title: '中断当前任务，重新开始',
      desc: '意图：修正或替换当前指令',
      activeClass: 'bg-destructive/15 text-destructive shadow-sm',
    },
    {
      intent: 'supplement',
      icon: <MessageSquarePlus size={18} />,
      title: '作为补充输入',
      desc: '意图：补充说明当前任务',
      activeClass: 'bg-primary/15 text-primary shadow-sm',
    },
    {
      intent: 'new_task',
      icon: <ListPlus size={18} />,
      title: '加入队列等待',
      desc: '意图：新任务，等当前完成',
      activeClass: 'bg-success/15 text-success shadow-sm',
    },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>你想做什么？</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {analysisResult && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-primary/15 shadow-glass-sm">
              <div className="flex items-center gap-1.5 font-semibold text-primary mb-1.5">
                <Brain size={14} />
                <span>AI 推测</span>
              </div>
              <div className="text-foreground/85">{analysisResult.suggestedAction}</div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                理由：{analysisResult.reasoning}
                <span className="mx-1">·</span>
                {analysisResult.method === 'llm' ? 'AI 分析' : '关键词匹配'}
                <span className="mx-1">·</span>
                {Math.round(analysisResult.confidence * 100)}% 置信度
              </div>
            </div>
          )}

          {intents.map((item) => (
            <button
              key={item.intent}
              onClick={() => onSelect(item.intent)}
              className={`w-full p-3 rounded-lg text-left transition-all flex items-start gap-3 ${
                analysisResult?.type === item.intent
                  ? item.activeClass
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              <span className="flex-shrink-0 mt-0.5 opacity-80">{item.icon}</span>
              <div>
                <div className="font-semibold text-sm">{item.title}</div>
                <div className="text-xs text-foreground/60 mt-0.5">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={onCancel}
          className="w-full mt-4 p-2 text-muted-foreground hover:text-foreground text-sm transition-colors rounded-lg hover:bg-muted/30"
        >
          取消
        </button>
      </DialogContent>
    </Dialog>
  );
}
