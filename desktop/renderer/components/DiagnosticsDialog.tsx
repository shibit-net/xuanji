// ============================================================
// DiagnosticsDialog - 系统诊断对话框（shadcn Dialog）
// ============================================================

import { useState, useEffect, memo } from 'react';
import { Loader2, RefreshCw, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/i18n';

interface DiagnosticsDialogProps {
  onClose: () => void;
}

function DiagnosticsDialog({ onClose }: DiagnosticsDialogProps) {
  const [report, setReport] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.getDiagnostics();
      if (result.success && result.report) {
        setReport(result.report);
      } else {
        setError(result.error || t('diagnostics.load_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('diagnostics.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>🩺</span>
            <span>{t('diagnostics.title')}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              onClick={handleCopy}
              disabled={!report}
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={t('diagnostics.copy_report')}
            >
              {copied ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} className="text-muted-foreground" />
              )}
            </Button>
            <Button
              onClick={loadDiagnostics}
              disabled={loading}
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={t('diagnostics.refresh')}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              ) : (
                <RefreshCw size={16} className="text-muted-foreground" />
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-destructive text-sm p-4 bg-destructive/10 rounded-lg border border-destructive/30">
              {error}
            </div>
          ) : (
            <pre className="text-sm font-mono text-foreground whitespace-pre-wrap leading-relaxed">
              {report}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default memo(DiagnosticsDialog);
