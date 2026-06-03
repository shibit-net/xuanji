import { memo } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/core/i18n';
import type { LayerType, CreateForm } from './types';

interface CreateComponentDialogProps {
  selectedLayer: LayerType;
  createForm: CreateForm;
  creating: boolean;
  onFormChange: (form: CreateForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function CreateComponentDialog({
  selectedLayer,
  createForm,
  creating,
  onFormChange,
  onSubmit,
  onClose,
}: CreateComponentDialogProps) {
  const estimatedTokens = Math.max(50, Math.round(createForm.content.length * 0.4));

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl border border-border w-[680px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-medium">{selectedLayer === 'L1' ? t('sysprompt.create_dialog_title') : t('sysprompt.create_l2')}</h3>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7">
            <X size={20} />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('sysprompt.create_field_id')}</label>
              <input type="text" value={createForm.id}
                onChange={(e) => onFormChange({ ...createForm, id: e.target.value })}
                placeholder={t('sysprompt.create_placeholder_id')}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('sysprompt.create_field_name')}</label>
              <input type="text" value={createForm.name}
                onChange={(e) => onFormChange({ ...createForm, name: e.target.value })}
                placeholder={t('sysprompt.create_placeholder_name')}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('sysprompt.create_field_priority')}</label>
              <input type="number" value={createForm.priority}
                onChange={(e) => onFormChange({ ...createForm, priority: parseInt(e.target.value) || 75 })}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('sysprompt.create_field_tokens')}</label>
              <div className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-muted-foreground">
                {estimatedTokens}
              </div>
              <p className="text-xs text-muted-foreground/60 mt-1">{t('sysprompt.create_token_hint', { tokens: String(estimatedTokens) })}</p>
            </div>
          </div>

          {selectedLayer === 'L1' && (
          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-medium mb-3 text-primary">{t('sysprompt.create_scene_config')}</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t('sysprompt.create_field_keywords')}</label>
                <input type="text" value={createForm.keywords}
                  onChange={(e) => onFormChange({ ...createForm, keywords: e.target.value })}
                  placeholder={t('sysprompt.create_placeholder_keywords')}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('sysprompt.create_field_desc')}</label>
                <input type="text" value={createForm.description}
                  onChange={(e) => onFormChange({ ...createForm, description: e.target.value })}
                  placeholder={t('sysprompt.create_placeholder_match_desc')}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
              </div>
            </div>
          </div>
          )}

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-medium mb-3 text-primary">{t('sysprompt.create_field_prompt_content')}</h4>
            <textarea value={createForm.content}
              onChange={(e) => onFormChange({ ...createForm, content: e.target.value })}
              placeholder={t('sysprompt.create_placeholder_content')}
              rows={12}
              className="w-full bg-background border border-border rounded p-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary resize-y min-h-[200px]" />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-border">
          <Button onClick={onClose} variant="ghost" className="px-4 py-2">{t('sysprompt.create_cancel')}</Button>
          <Button onClick={onSubmit} disabled={creating}
            variant="ghost"
            className="bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 px-4 py-2 flex items-center gap-2">
            <Plus size={16} />
            {creating ? t('sysprompt.creating') : t('sysprompt.create_btn')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default memo(CreateComponentDialog);
