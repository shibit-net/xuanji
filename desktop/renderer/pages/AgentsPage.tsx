// ============================================================
// AgentsPage - Agent 管理页面
// ============================================================

import AgentManager from '../components/AgentManager';

interface AgentsPageProps {
  onClose: () => void;
}

export default function AgentsPage({ onClose }: AgentsPageProps) {
  return <AgentManager onClose={onClose} />;
}
