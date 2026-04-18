// ============================================================
// Xuanji GUI - 意图选择对话框
// ============================================================

import React from 'react';
import { UserIntent, IntentAnalysis } from '../services/messageIntentAnalyzer';

interface IntentDialogProps {
  pendingMessage: string;
  analysisResult: IntentAnalysis | null;
  onSelect: (intent: UserIntent) => void;
  onCancel: () => void;
}

export default function IntentDialog({
  pendingMessage,
  analysisResult,
  onSelect,
  onCancel
}: IntentDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-primary p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-2">你想做什么？</h3>
        
        {analysisResult && (
          <div className="mb-4 p-3 bg-yellow-50 text-yellow-800 rounded-lg text-sm">
            💡 AI 推测：{analysisResult.suggestedAction}
            <div className="text-xs opacity-70 mt-1">
              理由：{analysisResult.reasoning}
              ({analysisResult.method === 'llm' ? 'AI 分析' : '关键词匹配'}，
              {Math.round(analysisResult.confidence * 100)}% 置信度)
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => onSelect('interrupt_replace')}
            className={`w-full p-3 rounded-lg text-left transition-all
              ${analysisResult?.type === 'interrupt_replace'
                ? 'bg-red-100 text-red-700 border-2 border-red-300'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
          >
            ⏹️ 中断当前任务，重新开始
            <div className="text-xs opacity-70">意图：修正或替换当前指令</div>
          </button>

          <button
            onClick={() => onSelect('supplement')}
            className={`w-full p-3 rounded-lg text-left transition-all
              ${analysisResult?.type === 'supplement'
                ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
          >
            💬 作为补充输入
            <div className="text-xs opacity-70">意图：补充说明当前任务</div>
          </button>

          <button
            onClick={() => onSelect('new_task')}
            className={`w-full p-3 rounded-lg text-left transition-all
              ${analysisResult?.type === 'new_task'
                ? 'bg-green-100 text-green-700 border-2 border-green-300'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
          >
            📋 加入队列等待
            <div className="text-xs opacity-70">意图：新任务，等当前完成</div>
          </button>
        </div>

        <button
          onClick={onCancel}
          className="w-full mt-4 p-2 text-text-secondary hover:text-text-primary"
        >
          取消
        </button>
      </div>
    </div>
  );
}
