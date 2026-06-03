// ============================================================
// AgentSkillList - Agent 技能列表配置（待实现）
// ============================================================

import ConfigSection from './shared/ConfigSection';
import { Zap } from 'lucide-react';
import { t } from '@/core/i18n';

interface AgentSkillListProps {
  isExpanded: boolean;
  onToggle: (section: string) => void;
}

export default function AgentSkillList({ isExpanded, onToggle }: AgentSkillListProps) {
  return (
    <ConfigSection
      id="skills"
      title={t('agent.editor.skills_section')}
      icon={<Zap size={18} className="text-purple-400" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('agent.editor.section_coming_soon')}
      </p>
    </ConfigSection>
  );
}
