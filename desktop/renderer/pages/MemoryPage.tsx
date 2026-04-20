// ============================================================
// MemoryPage - Memory 管理页面
// ============================================================

import MemoryManager from '../components/MemoryManager';

interface MemoryPageProps {
  onClose: () => void;
}

export default function MemoryPage({ onClose }: MemoryPageProps) {
  return <MemoryManager onClose={onClose} />;
}
