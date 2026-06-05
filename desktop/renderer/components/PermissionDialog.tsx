// ============================================================
// PermissionDialog - 权限确认对话框（shadcn Dialog）
// ============================================================

import { useState, memo } from 'react';
import FadeContent from '@/components/FadeContent';
import { AlertTriangle, Shield } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { PermissionRequestData } from '../global';
import { getDesktopLabel } from '../i18n';
import { useConfigStore } from '../stores/configStore';

interface PermissionDialogProps {
  request: PermissionRequestData;
  onClose: () => void;
}

// 运行时类型（IPC 发送的数据可能包含类型定义之外的额外字段）
type RichRequest = PermissionRequestData & {
  riskLevel?: 'safe' | 'warn' | 'danger';
  toolName?: string;
  description?: string;
  suggestion?: string;
  input?: Record<string, unknown>;
};

function PermissionDialog({ request, onClose }: PermissionDialogProps) {
  const [loading, setLoading] = useState(false);
  // 兼容运行时可能有更多字段
  const r = request as unknown as RichRequest;

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

  const riskLevel = r.riskLevel || 'warn';

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

  const lang = useConfigStore((s) => s.settings.language) as 'zh' | 'en';

  const riskLabels = {
    safe: getDesktopLabel('permdialog.risk_safe', lang),
    warn: getDesktopLabel('permdialog.risk_warn', lang),
    danger: getDesktopLabel('permdialog.risk_danger', lang),
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <FadeContent blur duration={400}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Shield size={24} className={riskColors[riskLevel]} />
            <span>{getDesktopLabel('permdialog.title', lang)}</span>
            <span className={`text-sm ${riskColors[riskLevel]}`}>
              {riskLabels[riskLevel]}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* 工具信息 */}
          <div className={`p-4 rounded-lg border ${riskBgColors[riskLevel]}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className={riskColors[riskLevel]} />
              <div className="flex-1">
                <div className="font-semibold mb-1">{getDesktopLabel('permdialog.tool_call', lang)}</div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-mono">{r.toolName || r.tool}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 风险描述 */}
          {r.description && (
            <div>
              <div className="text-sm font-semibold mb-2">{getDesktopLabel('permdialog.risk_desc', lang)}</div>
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded border border-border">
                {r.description}
              </div>
            </div>
          )}

          {/* 建议 */}
          {r.suggestion && (
            <div>
              <div className="text-sm font-semibold mb-2">{getDesktopLabel('permdialog.suggestion', lang)}</div>
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded border border-border">
                {r.suggestion}
              </div>
            </div>
          )}

          {/* 输入参数 */}
          {r.input && Object.keys(r.input).length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2">{getDesktopLabel('permdialog.input_params', lang)}</div>
              <div className="text-xs font-mono bg-muted p-3 rounded border border-border overflow-x-auto">
                <pre>{JSON.stringify(r.input, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button variant="outline" onClick={() => handleRespond('never')} disabled={loading}>
            {getDesktopLabel('permdialog.btn_never', lang)}
          </Button>
          <Button variant="outline" onClick={() => handleRespond('deny')} disabled={loading}>
            {getDesktopLabel('permdialog.btn_deny', lang)}
          </Button>
          <Button onClick={() => handleRespond('allow')} disabled={loading}>
            {getDesktopLabel('permdialog.btn_allow', lang)}
          </Button>
          <Button
            className="bg-green-600 text-white hover:bg-green-700"
            onClick={() => handleRespond('always')}
            disabled={loading}
          >
            {getDesktopLabel('permdialog.btn_always', lang)}
          </Button>
        </DialogFooter>
        </FadeContent>
      </DialogContent>
    </Dialog>
  );
}

export default memo(PermissionDialog);
