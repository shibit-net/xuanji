// ============================================================
// AgentSubAgentList - Agent 子 Agent 列表配置（待实现）
// ============================================================

import ConfigSection from './shared/ConfigSection';
import { Bot } from 'lucide-react';
import { t } from '@/core/i18n';

interface AgentSubAgentListProps {
  isExpanded: boolean;
  onToggle: (section: string) => void;
}

export default function AgentSubAgentList({ isExpanded, onToggle }: AgentSubAgentListProps) {
  return (
    <ConfigSection
      id="subAgents"
      title={t('agent.editor.sub_agents_section')}
      icon={<Bot size={18} className="text-indigo-400" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('agent.editor.section_coming_soon')}
      </p>
    </ConfigSection>
  );
}
