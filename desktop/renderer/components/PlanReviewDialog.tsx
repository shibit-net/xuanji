// ============================================================
// PlanReviewDialog - 计划审查对话框（shadcn Dialog）
// ============================================================

import { useState, memo } from 'react';
import FadeContent from '@/components/FadeContent';
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
import MilkdownEditor from './MilkdownEditor.lazy';
import type { PlanReviewRequestData } from '../global';
import { t } from '@/i18n';

interface PlanReviewDialogProps {
  request: PlanReviewRequestData;
  onClose: () => void;
}

function PlanReviewDialog({ request, onClose }: PlanReviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [supplement, setSupplement] = useState('');
  const [showSupplementInput, setShowSupplementInput] = useState(false);

  // 兼容运行时：类型定义是 plan/filePath，旧代码用 content/title
  const r = request as any;
  const planContent = r.content || r.plan || '';
  const planTitle = r.title || t('plan.default_title');

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
        <FadeContent blur duration={400}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <FileText size={24} className="text-foreground" />
            <div>
              <span>{planTitle}</span>
              <DialogDescription className="mt-0.5">{t('plan.review_desc')}</DialogDescription>
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
              <label className="block text-sm font-semibold mb-2">{t('plan.supplement_label')}</label>
              <Textarea
                value={supplement}
                onChange={(e) => setSupplement(e.target.value)}
                placeholder={t('plan.supplement_placeholder')}
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
            {showSupplementInput ? t('plan.btn_cancel_supplement') : t('plan.btn_supplement')}
          </Button>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="destructive"
              onClick={() => handleRespond('reject')}
              disabled={loading}
            >
              {t('plan.btn_reject')}
            </Button>

            {showSupplementInput ? (
              <Button
                className="bg-yellow-600 text-white hover:bg-yellow-700"
                onClick={handleSupplement}
                disabled={loading || !supplement.trim()}
              >
                {t('plan.btn_submit_supplement')}
              </Button>
            ) : (
              <Button
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={() => handleRespond('approve')}
                disabled={loading}
              >
                {t('plan.btn_approve')}
              </Button>
            )}
          </div>
        </DialogFooter>
        </FadeContent>
      </DialogContent>
    </Dialog>
  );
}

export default memo(PlanReviewDialog);
