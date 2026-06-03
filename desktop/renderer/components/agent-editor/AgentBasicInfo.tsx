// ============================================================
// AgentBasicInfo - Agent 基础信息配置区块
// ============================================================

import { memo } from 'react';
import ConfigToggle from './shared/ConfigToggle';
import { t } from '@/core/i18n';
import { useToast } from '../Toast';
import { canEnableAgent } from './shared/constants';

interface AgentBasicInfoProps {
  config: any;
  setConfig: (config: any) => void;
  errors: Record<string, string>;
  canEdit: (field: string) => boolean;
  renderFormField: (label: string, field: string, type?: 'text' | 'textarea' | 'number' | 'select', options?: string[], disabled?: boolean, placeholder?: string) => React.ReactNode;
}

function AgentBasicInfo({ config, setConfig, errors, canEdit, renderFormField }: AgentBasicInfoProps) {
  const toast = useToast();

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {renderFormField(t('agent.editor.field.id'), 'id')}
        {renderFormField(t('agent.editor.field.name'), 'name')}
      </div>
      {/* 启用/禁用开关 */}
      <ConfigToggle
        enabled={config.enabled !== false}
        onChange={() => {
          const isEnabling = config.enabled === false;
          if (isEnabling && !canEnableAgent(config)) {
            toast.error(t('agent.editor.error.api_key_required'));
            return;
          }
          setConfig({ ...config, enabled: !config.enabled });
        }}
        disabled={!canEdit('enabled')}
        label={t('agent.editor.field.enabled')}
      />
      {renderFormField(t('agent.editor.field.description'), 'description', 'textarea')}

      {/* Capabilities */}
      <div>
        <label className="block text-sm font-medium mb-1">{t('agent.editor.field.capabilities')}</label>
        <textarea
          value={config.capabilities?.join('\n') || ''}
          onChange={(e) => setConfig({
            ...config,
            capabilities: e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean)
          })}
          placeholder={t('agent.editor.capabilities_placeholder')}
          rows={5}
          disabled={!canEdit('capabilities')}
          className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t('agent.editor.field.capabilities_hint')}
        </p>
      </div>
    </>
  );
}

export default memo(AgentBasicInfo);
