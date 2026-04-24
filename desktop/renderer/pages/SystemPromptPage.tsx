// ============================================================
// SystemPromptPage - System Prompt 管理页面
// ============================================================

import SystemPromptManager from '../components/SystemPromptManager';

interface SystemPromptPageProps {
  onClose: () => void;
}

export default function SystemPromptPage({ onClose }: SystemPromptPageProps) {
  return <SystemPromptManager onClose={onClose} />;
}
