// ============================================================
// AgentMcpConfig - Agent MCP 配置（待实现）
// ============================================================

import { memo } from 'react';
import ConfigSection from './shared/ConfigSection';
import { Database } from 'lucide-react';
import { t } from '@/core/i18n';

interface AgentMcpConfigProps {
  isExpanded: boolean;
  onToggle: (section: string) => void;
}

function AgentMcpConfig({ isExpanded, onToggle }: AgentMcpConfigProps) {
  return (
    <ConfigSection
      id="mcp"
      title={t('agent.editor.mcp_section')}
      icon={<Database size={18} className="text-teal-400" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('agent.editor.section_coming_soon')}
      </p>
    </ConfigSection>
  );
}

export default memo(AgentMcpConfig);
