// ============================================================
// PlanReviewDialog - 计划审查对话框（shadcn Dialog）
// ============================================================

import { useState } from 'react';
import { FileText, MessageSquare } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import MilkdownEditor from './MilkdownEditor';
import type { PlanReviewRequestData } from '../global';

interface PlanReviewDialogProps {
  request: PlanReviewRequestData;
  onClose: () => void;
}

export default function PlanReviewDialog({ request, onClose }: PlanReviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [supplement, setSupplement] = useState('');
  const [showSupplementInput, setShowSupplementInput] = useState(false);

  // 兼容运行时：类型定义是 plan/filePath，旧代码用 content/title
  const r = request as any;
  const planContent = r.content || r.plan || '';
  const planTitle = r.title || '执行计划审查';

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <FileText size={24} className="text-foreground" />
            <div>
              <span>{planTitle}</span>
              <DialogDescription className="mt-0.5">请审查以下执行计划</DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="bg-muted p-4 rounded-lg border border-border min-h-[200px]">
            <MilkdownEditor value={planContent} mode="preview" />
          </div>

          {/* 补充说明输入框 */}
          {showSupplementInput && (
            <div className="mt-4">
              <label className="block text-sm font-semibold mb-2">补充说明</label>
              <Textarea
                value={supplement}
                onChange={(e) => setSupplement(e.target.value)}
                placeholder="输入补充说明或修改建议..."
                rows={4}
                disabled={loading}
              />
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => setShowSupplementInput(!showSupplementInput)}
            disabled={loading}
          >
            <MessageSquare size={16} className="mr-2" />
            {showSupplementInput ? '取消补充' : '补充说明'}
          </Button>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="destructive"
              onClick={() => handleRespond('reject')}
              disabled={loading}
            >
              <MessageSquare size={16} className="mr-2" />
              拒绝
            </Button>

            {showSupplementInput ? (
              <Button
                className="bg-yellow-600 text-white hover:bg-yellow-700"
                onClick={handleSupplement}
                disabled={loading || !supplement.trim()}
              >
                <MessageSquare size={16} className="mr-2" />
                提交补充
              </Button>
            ) : (
              <Button
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={() => handleRespond('approve')}
                disabled={loading}
              >
                <MessageSquare size={16} className="mr-2" />
                批准执行
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
