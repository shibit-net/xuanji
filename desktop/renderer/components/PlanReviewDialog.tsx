// ============================================================
// PlanReviewDialog - 计划审查对话框
// ============================================================

import { useState } from 'react';
import { FileText, X, Check, XCircle, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { PlanReviewRequestData } from '../global';

interface PlanReviewDialogProps {
  request: PlanReviewRequestData;
  onClose: () => void;
}

export default function PlanReviewDialog({ request, onClose }: PlanReviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [supplement, setSupplement] = useState('');
  const [showSupplementInput, setShowSupplementInput] = useState(false);

  const handleRespond = async (action: 'approve' | 'reject' | 'supplement', supplementText?: string) => {
    setLoading(true);
    try {
      await window.electron.planReviewRespond({
        id: request.id,
        result: {
          action,
          supplement: supplementText || undefined,
        },
      });
      onClose();
    } catch (err) {
      console.error('Plan review respond error:', err);
      setLoading(false);
    }
  };

  const handleSupplement = () => {
    if (!supplement.trim()) return;
    handleRespond('supplement', supplement);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
          <div className="flex items-center gap-3">
            <FileText size={24} className="text-primary" />
            <div>
              <h2 className="text-lg font-semibold">{request.title || '执行计划审查'}</h2>
              <span className="text-sm text-text-secondary">请审查以下执行计划</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-tertiary rounded transition-colors"
            disabled={loading}
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="prose prose-invert max-w-none">
            <div className="bg-bg-primary p-4 rounded-lg border border-bg-tertiary">
              <ReactMarkdown>{request.content}</ReactMarkdown>
            </div>
          </div>

          {/* 补充说明输入框 */}
          {showSupplementInput && (
            <div className="mt-4">
              <label className="block text-sm font-semibold mb-2">补充说明</label>
              <textarea
                value={supplement}
                onChange={(e) => setSupplement(e.target.value)}
                placeholder="输入补充说明或修改建议..."
                className="w-full bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary"
                rows={4}
                disabled={loading}
              />
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-bg-tertiary">
          <button
            onClick={() => setShowSupplementInput(!showSupplementInput)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-bg-tertiary hover:bg-bg-primary rounded transition-colors disabled:opacity-50"
          >
            <MessageSquare size={16} />
            <span>{showSupplementInput ? '取消补充' : '补充说明'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRespond('reject')}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 rounded transition-colors disabled:opacity-50"
            >
              <XCircle size={16} />
              <span>拒绝</span>
            </button>

            {showSupplementInput ? (
              <button
                onClick={handleSupplement}
                disabled={loading || !supplement.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-600 text-white hover:bg-yellow-700 rounded transition-colors disabled:opacity-50"
              >
                <MessageSquare size={16} />
                <span>提交补充</span>
              </button>
            ) : (
              <button
                onClick={() => handleRespond('approve')}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-700 rounded transition-colors disabled:opacity-50"
              >
                <Check size={16} />
                <span>批准执行</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
