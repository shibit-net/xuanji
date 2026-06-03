import { clsx } from 'clsx';

export function SkeletonLine({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-secondary rounded', className || 'h-4 w-full')} />;
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
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
