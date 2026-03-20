// ============================================================
// PermissionDialog - 权限确认对话框
// ============================================================

import React, { useState } from 'react';
import { AlertTriangle, Shield, X } from 'lucide-react';
import type { PermissionRequestData } from '../global';

interface PermissionDialogProps {
  request: PermissionRequestData;
  onClose: () => void;
}

export default function PermissionDialog({ request, onClose }: PermissionDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleRespond = async (action: 'allow' | 'deny' | 'always' | 'never') => {
    setLoading(true);
    try {
      await window.electron.permissionRespond({
        id: request.id,
        result: { action },
      });
      onClose();
    } catch (err) {
      console.error('Permission respond error:', err);
      setLoading(false);
    }
  };

  const riskColors = {
    safe: 'text-green-500',
    warn: 'text-yellow-500',
    danger: 'text-red-500',
  };

  const riskBgColors = {
    safe: 'bg-green-500/10 border-green-500/30',
    warn: 'bg-yellow-500/10 border-yellow-500/30',
    danger: 'bg-red-500/10 border-red-500/30',
  };

  const riskLabels = {
    safe: '安全',
    warn: '警告',
    danger: '危险',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
          <div className="flex items-center gap-3">
            <Shield size={24} className={riskColors[request.riskLevel]} />
            <div>
              <h2 className="text-lg font-semibold">权限确认</h2>
              <span className={`text-sm ${riskColors[request.riskLevel]}`}>
                {riskLabels[request.riskLevel]}
              </span>
            </div>
          </div>
          <button
            onClick={() => handleRespond('deny')}
            className="p-1 hover:bg-bg-tertiary rounded transition-colors"
            disabled={loading}
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 工具信息 */}
          <div className={`p-4 rounded-lg border ${riskBgColors[request.riskLevel]}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className={riskColors[request.riskLevel]} />
              <div className="flex-1">
                <div className="font-semibold mb-1">工具调用</div>
                <div className="text-sm text-text-secondary">
                  <span className="font-mono">{request.toolName}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 风险描述 */}
          {request.description && (
            <div>
              <div className="text-sm font-semibold mb-2">风险描述</div>
              <div className="text-sm text-text-secondary bg-bg-primary p-3 rounded border border-bg-tertiary">
                {request.description}
              </div>
            </div>
          )}

          {/* 建议 */}
          {request.suggestion && (
            <div>
              <div className="text-sm font-semibold mb-2">建议</div>
              <div className="text-sm text-text-secondary bg-bg-primary p-3 rounded border border-bg-tertiary">
                {request.suggestion}
              </div>
            </div>
          )}

          {/* 输入参数 */}
          <div>
            <div className="text-sm font-semibold mb-2">输入参数</div>
            <div className="text-xs font-mono bg-bg-primary p-3 rounded border border-bg-tertiary overflow-x-auto">
              <pre>{JSON.stringify(request.input, null, 2)}</pre>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-bg-tertiary">
          <button
            onClick={() => handleRespond('never')}
            disabled={loading}
            className="px-4 py-2 text-sm bg-bg-tertiary hover:bg-bg-primary rounded transition-colors disabled:opacity-50"
          >
            永不允许
          </button>
          <button
            onClick={() => handleRespond('deny')}
            disabled={loading}
            className="px-4 py-2 text-sm bg-bg-tertiary hover:bg-bg-primary rounded transition-colors disabled:opacity-50"
          >
            拒绝
          </button>
          <button
            onClick={() => handleRespond('allow')}
            disabled={loading}
            className="px-4 py-2 text-sm bg-primary text-white hover:bg-primary/90 rounded transition-colors disabled:opacity-50"
          >
            允许
          </button>
          <button
            onClick={() => handleRespond('always')}
            disabled={loading}
            className="px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-700 rounded transition-colors disabled:opacity-50"
          >
            始终允许
          </button>
        </div>
      </div>
    </div>
  );
}
