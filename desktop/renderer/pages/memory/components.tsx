import { useState, useEffect, memo } from 'react';
import {
  X, Clock, Tag, Star, GitGraph, Trash2, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { getTypeColor, formatTime, TYPE_BORDER_COLORS } from './shared';

// ─── Loading / Error ─────────────────────────────────────

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-3 mx-4 mt-3 rounded border bg-red-500/10 text-red-400 border-red-500/20 flex items-center gap-2 text-sm">
      <AlertCircle size={16} />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 transition-colors">
          {t('memory.browse.btn_retry')}
        </button>
      )}
    </div>
  );
}

// ─── Importance Stars ────────────────────────────────────

export function ImportanceStars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={10} className={i <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'} />
      ))}
    </span>
  );
}

// ─── Memory Card ─────────────────────────────────────────

export function MemoryCard({ item, onClick }: { item: any; onClick: () => void }) {
  const borderColor = TYPE_BORDER_COLORS[item.typeLabel] || 'border-l-primary/60';
  return (
    <div
      onClick={onClick}
      className={`p-3 rounded border border-border border-l-2 ${borderColor} hover:border-primary/40 cursor-pointer transition-colors`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(item.typeLabel)}`}>
          {item.typeLabel}
        </span>
        <span className="text-sm font-medium text-foreground line-clamp-1">{item.title}</span>
        {item.source && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">{item.source}</span>}
        {!item.source && item.importance !== undefined && <span className="ml-auto"><ImportanceStars value={item.importance} /></span>}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{item.content || t('memory.detail.no_summary')}</p>
      <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground/70">
        {item.time && <span className="flex items-center gap-1"><Clock size={10} />{formatTime(item.time)}</span>}
        <span className="flex items-center gap-1"><Tag size={10} />{item.sceneTag || '—'}</span>
      </div>
    </div>
  );
}

// ─── Summary Metric ──────────────────────────────────────

export function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-muted/30">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

// ─── Field ───────────────────────────────────────────────

export function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground block mb-0.5">{label}</span>
      {children || <span className="text-sm text-foreground break-words whitespace-pre-wrap">{value || '—'}</span>}
    </div>
  );
}

// ─── Detail Panel ────────────────────────────────────────

export const DetailPanel = memo(function DetailPanel({
  item,
  entities,
  onClose,
  onOpenGraph,
  onDeleted,
}: {
  item: any;
  entities: any[];
  onClose: () => void;
  onOpenGraph: (entity: { id: string; name: string }) => void;
  onDeleted: () => void | Promise<void>;
}) {
  const itype = item._type || item.source_table || 'entity';
  const [relations, setRelations] = useState<any[]>([]);
  const [relationLoading, setRelationLoading] = useState(false);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (itype !== 'entity' || !item.id) return;
    let cancelled = false;
    (async () => {
      setRelationLoading(true);
      setRelationError(null);
      try {
        const res = await window.electron.memoryRelations({ entityId: item.id, activeOnly: true });
        if (cancelled) return;
        if (res.success) setRelations(res.relations || []);
        else setRelationError(res.error || t('memory.detail.relations_failed'));
      } catch (err) {
        if (!cancelled) setRelationError(err instanceof Error ? err.message : t('memory.detail.relations_failed'));
      } finally {
        if (!cancelled) setRelationLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [itype, item.id]);

  const relationName = (id: string) => entities.find(e => e.id === id)?.name || id.slice(0, 8);

  const handleDelete = async () => {
    if (!confirm(t('memory.detail.confirm_delete_entity'))) return;
    setDeleting(true);
    try {
      const res = await window.electron.memoryDeleteEntity({ id: item.id });
      if (res.success) await onDeleted();
      else alert(t('memory.detail.delete_failed', { error: res.error }));
    } catch (err) {
      alert(t('memory.detail.delete_failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeleting(false);
    }
  };

  const title = item.name || item.title || item.content || item.source_id || t('memory.detail.title');
  const scene = item.scene_tag || '—';
  const time = item.updated_at || item.created_at || item.time || item.timestamp;
  const importance = item.importance;

  return (
    <aside className="w-96 border-l border-border p-4 shrink-0 overflow-y-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(item.type || itype)}`}>{item.type || itype}</span>
            {importance !== undefined && <ImportanceStars value={importance} />}
          </div>
          <h3 className="text-sm font-semibold text-foreground break-words">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{formatTime(time)} · {scene}</p>
        </div>
        <Button onClick={onClose} variant="ghost" size="icon" className="h-6 w-6 shrink-0"><X size={14} /></Button>
      </div>

      <div className="space-y-3 text-sm">
        {itype === 'entity' && (
          <>
            <Field label={t('memory.detail.field_name')} value={item.name} />
            <Field label={t('memory.detail.field_type')}>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(item.type)}`}>{item.type}</span>
            </Field>
            <Field label={t('memory.detail.field_summary')} value={item.summary} />
            {item.belief && <Field label={t('memory.detail.field_belief')} value={item.belief} />}
            <Field label={t('memory.detail.field_scene_tag')} value={item.scene_tag || '—'} />
            <Field label={t('memory.detail.field_importance')}><ImportanceStars value={item.importance} /></Field>
            <Field label={t('memory.detail.field_ref_count')} value={String(item.ref_count ?? '—')} />
            <Field label={t('memory.detail.field_created_at')} value={formatTime(item.created_at)} />
            <Field label={t('memory.detail.field_updated_at')} value={formatTime(item.updated_at)} />

            <div className="pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground block mb-2">{t('memory.detail.relations')}</span>
              {relationLoading && <p className="text-xs text-muted-foreground">{t('memory.detail.loading_relations')}</p>}
              {relationError && <p className="text-xs text-red-400">{relationError}</p>}
              {!relationLoading && !relationError && relations.length === 0 && <p className="text-xs text-muted-foreground">{t('memory.detail.no_relations')}</p>}
              <div className="space-y-1.5">
                {relations.slice(0, 20).map(rel => {
                  const isOut = rel.subject_id === item.id;
                  const otherId = isOut ? rel.object_id : rel.subject_id;
                  return (
                    <div key={rel.id} className="text-xs rounded border border-border bg-background/60 px-2 py-1.5">
                      <span className="text-primary">{isOut ? '→' : '←'} {rel.relation}</span>
                      <span className="text-muted-foreground"> · {relationName(otherId)}</span>
                      {rel.desc && <p className="text-muted-foreground/70 mt-0.5">{rel.desc}</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-border flex gap-2">
              <Button onClick={() => onOpenGraph({ id: item.id, name: item.name })} variant="secondary" size="sm" className="gap-1">
                <GitGraph size={14} />{t('memory.detail.open_in_graph')}
              </Button>
              <Button onClick={handleDelete} disabled={deleting} variant="ghost" size="sm" className="gap-1 text-red-400 hover:text-red-300">
                <Trash2 size={14} />{deleting ? t('memory.detail.deleting') : t('memory.detail.delete_entity')}
              </Button>
            </div>
          </>
        )}

        {itype === 'fact' && (
          <>
            <Field label={t('memory.detail.field_title')} value={item.title} />
            <Field label={t('memory.detail.field_content')} value={item.content} />
            <Field label={t('memory.detail.field_source')} value={item.source} />
            <Field label={t('memory.detail.field_version')} value={`v${item.version}`} />
            <Field label={t('memory.detail.field_is_latest')} value={item.is_latest ? t('memory.common.yes') : t('memory.common.no')} />
            <Field label={t('memory.detail.field_scene_tag')} value={item.scene_tag || '—'} />
            <Field label={t('memory.detail.field_created_at')} value={formatTime(item.created_at)} />
          </>
        )}

        {itype === 'event' && (
          <>
            <Field label={t('memory.detail.field_content')} value={item.content} />
            {item.result && <Field label={t('memory.detail.field_result')} value={item.result} />}
            <Field label={t('memory.detail.field_time')} value={formatTime(item.time)} />
            <Field label={t('memory.detail.field_importance')}><ImportanceStars value={item.importance} /></Field>
            {item.operator && <Field label={t('memory.detail.field_operator')} value={item.operator} />}
            <Field label={t('memory.detail.field_scene_tag')} value={item.scene_tag || '—'} />
          </>
        )}

        {itype === 'episode' && (
          <>
            <Field label={t('memory.detail.field_title')} value={item.title} />
            <Field label={t('memory.detail.field_narrative')} value={item.narrative} />
            <Field label={t('memory.detail.field_time')} value={formatTime(item.timestamp)} />
            <Field label={t('memory.detail.field_importance')}><ImportanceStars value={item.importance} /></Field>
            <Field label={t('memory.detail.field_scene_tag')} value={item.scene_tag || '—'} />
          </>
        )}

        {itype === 'search' && (
          <>
            <Field label={t('memory.detail.field_source_table')} value={item.source_table} />
            <Field label={t('memory.detail.field_title')} value={item.title} />
            <Field label={t('memory.detail.field_content')} value={item.content} />
            <Field label={t('memory.detail.field_relevance')} value={item.score ? `${(item.score * 100).toFixed(0)}%` : '—'} />
            <Field label={t('memory.detail.field_source_id')} value={item.source_id} />
            <Field label={t('memory.detail.field_scene_tag')} value={item.scene_tag || '—'} />
          </>
        )}
      </div>
    </aside>
  );
});
