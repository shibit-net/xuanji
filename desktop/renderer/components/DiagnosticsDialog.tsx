// ============================================================
// DiagnosticsDialog - 系统诊断对话框
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, Loader2, RefreshCw, Copy, Check } from 'lucide-react';

interface DiagnosticsDialogProps {
  onClose: () => void;
}

export default function DiagnosticsDialog({ onClose }: DiagnosticsDialogProps) {
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
        setError(result.error || '获取诊断信息失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取诊断信息失败');
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-[600px] max-h-[80vh] bg-bg-secondary rounded-xl shadow-2xl border border-bg-tertiary flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-bg-tertiary shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🩺</span>
            <span className="font-semibold">系统诊断</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!report}
              className="p-1 hover:bg-bg-tertiary rounded transition-colors"
              title="复制报告"
            >
              {copied ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} className="text-text-secondary" />
              )}
            </button>
            <button
              onClick={loadDiagnostics}
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
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={24} className="animate-spin text-text-secondary" />
            </div>
          ) : error ? (
            <div className="text-red-500 text-sm p-4 bg-red-500/10 rounded-lg border border-red-500/30">
              {error}
            </div>
          ) : (
            <pre className="text-sm font-mono text-text-primary whitespace-pre-wrap leading-relaxed">
              {report}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
