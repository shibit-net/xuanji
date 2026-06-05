// ============================================================
// EmptyState — 统一空状态展示组件
// ============================================================

import { Inbox, type LucideIcon } from 'lucide-react';
import { Button } from './ui/button';
import FadeContent from './FadeContent';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <FadeContent blur={true} duration={500}>
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Icon className="w-12 h-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground max-w-md">{description}</p>
        )}
        {action && (
          <Button onClick={action.onClick} className="mt-4" size="sm">
            {action.label}
          </Button>
        )}
      </div>
    </FadeContent>
  );
}
