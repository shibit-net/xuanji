// ============================================================
// AgentSystemPrompt - Agent 系统提示词配置区块
// ============================================================

import { memo } from 'react';
import { t } from '@/i18n';

interface AgentSystemPromptProps {
  config: any;
  setConfig: (config: any) => void;
  canEdit: (field: string) => boolean;
}

function AgentSystemPrompt({ config, setConfig, canEdit }: AgentSystemPromptProps) {
  return (
    <>
      <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-xs text-blue-400 mb-2">
          {t('agent.editor.system_prompt_hint_title')}
        </p>
        <ul className="text-xs text-muted-foreground space-y-1 ml-4">
          <li>{t('agent.editor.system_prompt_hint_item1')}</li>
          <li>{t('agent.editor.system_prompt_hint_item2')}</li>
          <li>{t('agent.editor.system_prompt_hint_item3')}</li>
          <li>{t('agent.editor.system_prompt_hint_item4')}</li>
        </ul>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t('agent.editor.field.system_prompt')}</label>
        <textarea
          value={config.systemPrompt || ''}
          onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
          disabled={!canEdit('systemPrompt')}
          placeholder={t('agent.editor.system_prompt_edit_placeholder')}
          rows={15}
          className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t('agent.editor.system_prompt_footer')}
        </p>
      </div>
    </>
  );
}

export default memo(AgentSystemPrompt);
