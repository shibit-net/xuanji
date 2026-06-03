// ============================================================
// AgentScheduleConfig - Agent 执行/调度配置
// ============================================================

import { memo } from 'react';
import { Settings } from 'lucide-react';
import ConfigSection from './shared/ConfigSection';
import { t } from '@/core/i18n';

interface AgentScheduleConfigProps {
  config: any;
  setConfig: (config: any) => void;
  canEdit: (field: string) => boolean;
  isExpanded: boolean;
  onToggle: (section: string) => void;
}

function AgentScheduleConfig({
  config,
  setConfig,
  canEdit,
  isExpanded,
  onToggle,
}: AgentScheduleConfigProps) {
  return (
    <ConfigSection
      id="execution"
      title={t('agent.editor.advanced_settings')}
      icon={<Settings size={18} className="text-purple-400" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="grid grid-cols-2 gap-4">
        {/* 执行模式 */}
        <div>
          <label className="block text-sm font-medium mb-1">{t('agent.editor.field.exec_mode')}</label>
          <select
            value={config.execution?.mode || 'react'}
            onChange={(e) => setConfig({
              ...config,
              execution: { ...config.execution, mode: e.target.value },
            })}
            disabled={!canEdit('execution.mode')}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="react">{t('agent.editor.execution_mode_react')}</option>
            <option value="plan">{t('agent.editor.execution_mode_plan')}</option>
            <option value="chain">{t('agent.editor.execution_mode_chain')}</option>
          </select>
        </div>

        {/* 最大迭代次数 */}
        <div>
          <label className="block text-sm font-medium mb-1">{t('agent.editor.field.max_iterations_full')}</label>
          <input
            type="number"
            value={Number.isFinite(config.execution?.maxIterations) ? config.execution.maxIterations : ''}
            placeholder="∞ 无限"
            onChange={(e) => { const v = e.target.value; setConfig({ ...config, execution: { ...config.execution, maxIterations: v === '' ? Infinity : parseInt(v) } }); }}
            disabled={!canEdit('execution.maxIterations')}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* 超时时间 */}
        <div>
          <label className="block text-sm font-medium mb-1">{t('agent.editor.field.timeout')}</label>
          <input
            type="number"
            value={config.execution?.timeout || 300000}
            onChange={(e) => setConfig({
              ...config,
              execution: { ...config.execution, timeout: parseInt(e.target.value) },
            })}
            disabled={!canEdit('execution.timeout')}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* 执行选项 */}
      <div className="space-y-2 mt-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.execution?.streaming !== false}
            onChange={(e) => setConfig({
              ...config,
              execution: { ...config.execution, streaming: e.target.checked },
            })}
            disabled={!canEdit('execution.streaming')}
            className="rounded disabled:opacity-50"
          />
          <span className="text-sm">{t('agent.editor.field.streaming')}</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.execution?.parallelTools !== false}
            onChange={(e) => setConfig({
              ...config,
              execution: { ...config.execution, parallelTools: e.target.checked },
            })}
            disabled={!canEdit('execution.parallelTools')}
            className="rounded disabled:opacity-50"
          />
          <span className="text-sm">{t('agent.editor.field.parallel_tools')}</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.execution?.retryOnError === true}
            onChange={(e) => setConfig({
              ...config,
              execution: { ...config.execution, retryOnError: e.target.checked },
            })}
            disabled={!canEdit('execution.retryOnError')}
            className="rounded disabled:opacity-50"
          />
          <span className="text-sm">{t('agent.editor.field.retry_on_error')}</span>
        </label>
      </div>
    </ConfigSection>
  );
}

export default memo(AgentScheduleConfig);
