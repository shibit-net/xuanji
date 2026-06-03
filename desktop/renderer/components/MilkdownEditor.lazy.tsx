import { lazy, Suspense } from 'react';

const MilkdownEditorInner = lazy(() => import('./MilkdownEditor'));

function MilkdownFallback() {
  return <div className="animate-pulse bg-secondary rounded-lg h-40" />;
}

export default function MilkdownEditor(props: Record<string, unknown>) {
  return (
    <Suspense fallback={<MilkdownFallback />}>
      <MilkdownEditorInner {...props} />
    </Suspense>
  );
}
