// ============================================================
// ConfigSection - 可折叠配置区块
// ============================================================

import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ConfigSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: (section: string) => void;
  children: React.ReactNode;
}

function ConfigSection({ id, title, icon, isExpanded, onToggle, children }: ConfigSectionProps) {
  return (
    <div className="bg-card rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 p-4 hover:bg-primary/5 transition-colors"
      >
        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        {icon}
        <span className="font-medium flex-1 text-left">{title}</span>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

export default memo(ConfigSection);
