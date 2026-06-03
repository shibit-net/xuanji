import { memo } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/core/i18n';

interface PreviewDialogProps {
  previewPrompt: string;
  l1Scenes: string[];
  previewScene: string;
  previewComplexity: 'simple' | 'standard' | 'complex';
  onSceneChange: (scene: string) => void;
  onComplexityChange: (c: 'simple' | 'standard' | 'complex') => void;
  onRegenerate: () => void;
  onClose: () => void;
}

function PreviewDialog({
  previewPrompt,
  l1Scenes,
  previewScene,
  previewComplexity,
  onSceneChange,
  onComplexityChange,
  onRegenerate,
  onClose,
}: PreviewDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-[90%] h-[90%] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border gap-4">
          <h3 className="font-medium flex-shrink-0">{t('sysprompt.preview_title')}</h3>
          <div className="flex items-center gap-3">
            <select value={previewScene}
              onChange={(e) => onSceneChange(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
              {l1Scenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={previewComplexity}
              onChange={(e) => onComplexityChange(e.target.value as any)}
              className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary">
              <option value="simple">{t('sysprompt.complexity_simple')}</option>
              <option value="standard">{t('sysprompt.complexity_standard')}</option>
              <option value="complex">{t('sysprompt.complexity_complex')}</option>
            </select>
            <Button onClick={onRegenerate} variant="ghost" size="sm" className="flex items-center gap-1 px-3 py-1.5">
              <RefreshCw size={14} />
              {t('sysprompt.regenerate_btn')}
            </Button>
            <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7">
              <X size={20} />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {previewPrompt ? (
            <pre className="text-xs font-mono whitespace-pre-wrap bg-black/20 p-4 rounded h-full overflow-auto">
              {previewPrompt}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full">
              <RefreshCw size={24} className="animate-spin text-primary" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(PreviewDialog);
