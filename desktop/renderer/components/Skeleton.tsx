// ============================================================
// Skeleton — 骨架屏加载态组件
// ============================================================

interface SkeletonLineProps {
  className?: string;
}

export function SkeletonLine({ className }: SkeletonLineProps) {
  return (
    <div
      className={className || 'h-4 w-full'}
      style={{
        background: 'linear-gradient(90deg, hsl(var(--secondary)) 25%, hsl(var(--secondary)/0.5) 50%, hsl(var(--secondary)) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
        borderRadius: 'calc(var(--radius) - 2px)',
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="space-y-3 p-4 border border-border rounded-xl">
      <SkeletonLine className="h-5 w-1/3" />
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-2/3" />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
