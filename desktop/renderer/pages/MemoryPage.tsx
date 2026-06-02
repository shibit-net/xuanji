// ============================================================
// MemoryPage - 记忆管理页面
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { t } from '@/core/i18n';
import { Button } from '@/components/ui/button';
import {
  Brain, X, Search, Trash2, Database, GitGraph,
  BarChart3, Clock, User, FileText, Star,
  Calendar, Tag, RefreshCw, AlertCircle,
  ZoomIn, ZoomOut, Maximize2, Sparkles,
} from 'lucide-react';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';

cytoscape.use(coseBilkent);

interface MemoryPageProps {
  onClose: () => void;
}

type TabType = 'browse' | 'graph' | 'stats' | 'log';

// ─── 通用组件 ──────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
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

// ─── 类型标签颜色映射 ─────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  user: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  feedback: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  project: 'bg-green-500/15 text-green-400 border-green-500/25',
  reference: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  tool: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  concept: 'bg-pink-500/15 text-pink-400 border-pink-500/25',
  preference: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  person: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
};

// Cytoscape.js 节点颜色映射
const TYPE_HEX_COLORS: Record<string, string> = {
  user: '#3b82f6',
  feedback: '#a855f7',
  project: '#22c55e',
  reference: '#f97316',
  tool: '#06b6d4',
  concept: '#ec4899',
  preference: '#eab308',
  person: '#6366f1',
};
function getNodeColor(type: string): string {
  return TYPE_HEX_COLORS[type] || '#6b7280';
}

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || 'bg-gray-500/15 text-gray-400 border-gray-500/25';
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImportanceStars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={10} className={i <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'} />
      ))}
    </span>
  );
}

// ─── Tab: 记忆浏览 ─────────────────────────────────────────

type MemoryKind = 'entity' | 'fact' | 'event' | 'episode' | 'search';
type ObjectFilter = 'all' | 'entity' | 'fact' | 'event' | 'episode';
type ImportanceFilter = 'all' | '4' | '3';

interface NormalizedMemoryItem {
  kind: MemoryKind;
  id: string;
  title: string;
  content: string;
  typeLabel: string;
  sceneTag?: string;
  importance?: number;
  time?: number;
  source?: string;
  raw: any;
}

const ENTITY_TYPE_LABEL_KEYS: Record<string, string> = {
  user: 'memory.entity_type.user',
  person: 'memory.entity_type.person',
  preference: 'memory.entity_type.preference',
  feedback: 'memory.entity_type.feedback',
  project: 'memory.entity_type.project',
  tool: 'memory.entity_type.tool',
  concept: 'memory.entity_type.concept',
  reference: 'memory.entity_type.reference',
};

function latestTime(items: NormalizedMemoryItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.time || 0), 0);
}

function normalizeEntity(e: any): NormalizedMemoryItem {
  return {
    kind: 'entity',
    id: e.id,
    title: e.name || '—',
    content: e.summary || e.belief || '',
    typeLabel: e.type || 'entity',
    sceneTag: e.scene_tag,
    importance: e.importance,
    time: e.updated_at || e.created_at,
    raw: { ...e, _type: 'entity' },
  };
}

function normalizeFact(f: any): NormalizedMemoryItem {
  return {
    kind: 'fact',
    id: f.id,
    title: f.title || 'Fact',
    content: f.content || '',
    typeLabel: 'fact',
    sceneTag: f.scene_tag,
    time: f.created_at,
    source: f.source,
    raw: { ...f, _type: 'fact' },
  };
}

function normalizeEvent(ev: any): NormalizedMemoryItem {
  return {
    kind: 'event',
    id: ev.id,
    title: ev.content || 'Event',
    content: ev.result || '',
    typeLabel: 'event',
    sceneTag: ev.scene_tag,
    importance: ev.importance,
    time: ev.time || ev.created_at,
    source: ev.operator,
    raw: { ...ev, _type: 'event' },
  };
}

function normalizeEpisode(ep: any): NormalizedMemoryItem {
  return {
    kind: 'episode',
    id: ep.id,
    title: ep.title || 'Episode',
    content: ep.narrative || '',
    typeLabel: 'episode',
    sceneTag: ep.scene_tag,
    importance: ep.importance,
    time: ep.timestamp,
    raw: { ...ep, _type: 'episode' },
  };
}

function normalizeSearchResult(r: any): NormalizedMemoryItem {
  return {
    kind: 'search',
    id: `${r.source_table}-${r.source_id}`,
    title: r.title || r.source_id || 'Result',
    content: r.content || '',
    typeLabel: r.source_table || 'search',
    sceneTag: r.scene_tag,
    source: r.score !== undefined ? `${(r.score * 100).toFixed(0)}%` : undefined,
    raw: { ...r, _type: 'search' },
  };
}

function MemoryCard({ item, onClick }: { item: NormalizedMemoryItem; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="p-3 rounded border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
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

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-background/60 border border-border/60">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function BrowseTab({
  onOpenGraph,
  onClearAll,
  clearBusy,
  reloadToken,
}: {
  onOpenGraph: (entity: { id: string; name: string }) => void;
  onClearAll: () => void;
  clearBusy: boolean;
  reloadToken: number;
}) {
  const [objectFilter, setObjectFilter] = useState<ObjectFilter>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all');
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>('all');
  const [sceneFilter, setSceneFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [flushing, setFlushing] = useState(false);
  const [maintaining, setMaintaining] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, statsRes, eRes, fRes, evRes, epRes] = await Promise.all([
        window.electron.memoryStatus(),
        window.electron.memoryStats(),
        window.electron.memoryEntities({ limit: 300 }),
        window.electron.memoryFacts({ limit: 300 }),
        window.electron.memoryTimeline({ limit: 300 }),
        window.electron.memoryEpisodes({ limit: 100 }),
      ]);
      const safeArray = (v: any) => Array.isArray(v) ? v : [];
      const errors: string[] = [];
      if (statusRes.success) setStatus(statusRes); else if (statusRes.error) errors.push(statusRes.error);
      if (statsRes.success) setStats(statsRes.stats); else if (statsRes.error) errors.push(statsRes.error);
      if (eRes.success) setEntities(safeArray(eRes.entities)); else if (eRes.error) errors.push(eRes.error);
      if (fRes.success) setFacts(safeArray(fRes.facts)); else if (fRes.error) errors.push(fRes.error);
      if (evRes.success) setEvents(safeArray(evRes.events)); else if (evRes.error) errors.push(evRes.error);
      if (epRes.success) setEpisodes(safeArray(epRes.episodes)); else if (epRes.error) errors.push(epRes.error);
      if (errors.length > 0) setError(errors[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, reloadToken]);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setError(t('memory.status_query_error'));
    }, 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  const normalizedItems = [
    ...entities.map(normalizeEntity),
    ...facts.map(normalizeFact),
    ...events.map(normalizeEvent),
    ...episodes.map(normalizeEpisode),
  ];

  const entityTypeCounts = entities.reduce<Record<string, number>>((acc, entity) => {
    const type = entity.type || 'other';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const sceneOptions = Array.from(new Set(normalizedItems.map(item => item.sceneTag).filter(Boolean) as string[])).sort();

  const filteredItems = normalizedItems.filter(item => {
    if (objectFilter !== 'all' && item.kind !== objectFilter) return false;
    if (entityTypeFilter !== 'all' && (item.kind !== 'entity' || item.typeLabel !== entityTypeFilter)) return false;
    if (importanceFilter !== 'all' && (item.importance || 0) < Number(importanceFilter)) return false;
    if (sceneFilter !== 'all' && item.sceneTag !== sceneFilter) return false;
    return true;
  }).sort((a, b) => (b.time || 0) - (a.time || 0));

  const searchItems = results.map(normalizeSearchResult);
  const displayItems = searchActive ? searchItems : filteredItems;

  const objectCategories = [
    { id: 'all' as ObjectFilter, label: t('memory.browse.category_all'), count: normalizedItems.length },
    { id: 'entity' as ObjectFilter, label: t('memory.browse.category_entity'), count: entities.length },
    { id: 'fact' as ObjectFilter, label: t('memory.browse.category_fact'), count: facts.length },
    { id: 'event' as ObjectFilter, label: t('memory.browse.category_event'), count: events.length },
    { id: 'episode' as ObjectFilter, label: t('memory.browse.category_episode'), count: episodes.length },
  ];

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchActive(false);
      setResults([]);
      return;
    }
    setLoading(true);
    setSearchActive(true);
    try {
      const res = await window.electron.memorySearch({ query: searchQuery, limit: 80 });
      if (res.success) setResults(res.results || []);
      else setError(res.error || t('memory.search_failed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.search_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleFlush = async () => {
    setFlushing(true);
    try {
      const res = await window.electron.manualMemoryFlush();
      if (!res.success) setError(res.error || t('memory.browse.flush_failed'));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.browse.flush_failed'));
    } finally {
      setFlushing(false);
    }
  };

  const handleMaintenance = async () => {
    setMaintaining(true);
    try {
      const res = await window.electron.memoryMaintenanceTrigger();
      if (!res.success) setError(res.error || t('memory.browse.maintenance_failed'));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.browse.maintenance_failed'));
    } finally {
      setMaintaining(false);
    }
  };

  const resetSearch = () => {
    setSearchActive(false);
    setSearchQuery('');
    setResults([]);
  };

  if (loading && normalizedItems.length === 0) return <LoadingSpinner />;

  return (
    <div className="flex h-full">
      <aside className="w-52 border-r border-border bg-card p-3 space-y-4 shrink-0 overflow-y-auto">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('memory.browse.section_objects')}</p>
          <div className="space-y-1">
            {objectCategories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setObjectFilter(cat.id); setDetailItem(null); resetSearch(); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors ${
                  objectFilter === cat.id
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <span>{cat.label}</span>
                <span className="text-xs opacity-60">{cat.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('memory.browse.section_entity_types')}</p>
          <div className="space-y-1">
            <button
              onClick={() => { setEntityTypeFilter('all'); setObjectFilter('all'); resetSearch(); }}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors ${
                entityTypeFilter === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <span>{t('memory.browse.all_entity_types')}</span>
              <span>{entities.length}</span>
            </button>
            {Object.entries(entityTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <button
                key={type}
                onClick={() => { setObjectFilter('entity'); setEntityTypeFilter(type); resetSearch(); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors ${
                  entityTypeFilter === type ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <span>{ENTITY_TYPE_LABEL_KEYS[type] ? t(ENTITY_TYPE_LABEL_KEYS[type]) : type}</span>
                <span>{count}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {error && <ErrorBanner message={error} onRetry={() => { setError(null); loadData(); }} />}

        <div className="p-3 border-b border-border space-y-3">
          <div className="grid grid-cols-6 gap-2">
            <SummaryMetric label={t('memory.browse.metric_status')} value={status?.initialized ? t('memory.browse.status_ready') : t('memory.browse.status_unavailable')} />
            <SummaryMetric label={t('memory.stats.card_entity')} value={stats?.entityCount ?? entities.length} />
            <SummaryMetric label={t('memory.stats.card_fact')} value={stats?.factCount ?? facts.length} />
            <SummaryMetric label={t('memory.stats.card_event')} value={stats?.eventCount ?? events.length} />
            <SummaryMetric label={t('memory.stats.card_relation')} value={stats?.relationCount ?? '—'} />
            <SummaryMetric label={t('memory.browse.metric_latest_update')} value={latestTime(normalizedItems) ? formatTime(latestTime(normalizedItems)) : '—'} />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('memory.browse.search_placeholder')}
              className="flex-1 px-3 py-1.5 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
            />
            <Button onClick={handleSearch} variant="default" size="sm" className="gap-1">
              <Search size={14} /> {t('memory.browse.btn_search')}
            </Button>
            {searchActive && <Button onClick={resetSearch} variant="ghost" size="sm"><X size={14} /></Button>}
            <Button onClick={loadData} variant="ghost" size="sm" title={t('memory.browse.btn_refresh')}><RefreshCw size={14} /></Button>
            <Button onClick={handleFlush} disabled={flushing} variant="ghost" size="sm" className="gap-1">
              <Database size={14} /> {flushing ? t('memory.browse.flushing') : t('memory.browse.flush')}
            </Button>
            <Button onClick={handleMaintenance} disabled={maintaining} variant="ghost" size="sm" className="gap-1">
              <Sparkles size={14} className={maintaining ? 'animate-spin' : ''} /> {maintaining ? t('memory.graph.triggering_maintenance') : t('memory.graph.trigger_maintenance')}
            </Button>
            <Button onClick={onClearAll} disabled={clearBusy} variant="ghost" size="sm" className="gap-1 text-red-400 hover:text-red-300">
              <Trash2 size={14} /> {clearBusy ? t('memory.btn_clearing') : t('memory.btn_clear_all')}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {(['all', '4', '3'] as ImportanceFilter[]).map(v => (
              <button
                key={v}
                onClick={() => setImportanceFilter(v)}
                className={`px-2 py-1 rounded border ${importanceFilter === v ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {v === 'all' ? t('memory.browse.all_importance') : t('memory.browse.min_stars', { count: v })}
              </button>
            ))}
            <select
              value={sceneFilter}
              onChange={e => setSceneFilter(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background text-muted-foreground focus:outline-none focus:border-primary"
            >
              <option value="all">{t('memory.browse.all_scenes')}</option>
              {sceneOptions.map(scene => <option key={scene} value={scene}>{scene}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {displayItems.map(item => (
            <MemoryCard key={`${item.kind}-${item.id}`} item={item} onClick={() => setDetailItem(item.raw)} />
          ))}

          {displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Database size={40} className="mb-3 opacity-30" />
              <p className="text-sm">{searchActive ? t('memory.browse.no_search_results') : t('memory.browse.empty_title')}</p>
              <p className="text-xs mt-1 opacity-60">{searchActive ? t('memory.browse.no_search_results_hint') : t('memory.browse.empty_hint')}</p>
            </div>
          )}
        </div>
      </div>

      {detailItem && (
        <DetailPanel
          item={detailItem}
          entities={entities}
          onClose={() => setDetailItem(null)}
          onOpenGraph={(name) => onOpenGraph(name)}
          onDeleted={async () => {
            setDetailItem(null);
            await loadData();
          }}
        />
      )}
    </div>
  );
}

// ─── 详情面板 ──────────────────────────────────────────────

function DetailPanel({
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
    <aside className="w-96 border-l border-border bg-card p-4 shrink-0 overflow-y-auto">
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
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground block mb-0.5">{label}</span>
      {children || <span className="text-sm text-foreground break-words whitespace-pre-wrap">{value || '—'}</span>}
    </div>
  );
}

// ─── Tab: 记忆图谱 ─────────────────────────────────────────
//
// 使用 Cytoscape.js 渲染实体-关系网络，采用 visionOS 风格：
// 玻璃材质节点、微妙发光、毛玻璃面板、蓝紫渐变色彩

// visionOS 风格节点色盘 — 柔和、低饱和度、玻璃感
const GRAPH_COLORS: Record<string, string> = {
  user: '#60a5fa',
  feedback: '#a78bfa',
  project: '#4ade80',
  reference: '#fb923c',
  tool: '#22d3ee',
  concept: '#f472b6',
  preference: '#fbbf24',
  person: '#818cf8',
};
// 各类型浅色版本（高亮/环）
const GRAPH_COLORS_LIGHT: Record<string, string> = {
  user: '#93bbfd',
  feedback: '#c4b5fd',
  project: '#86efac',
  reference: '#fca5a5',
  tool: '#67e8f9',
  concept: '#f9a8d4',
  preference: '#fde68a',
  person: '#a5b4fc',
};

function graphNodeColor(type: string): string {
  return GRAPH_COLORS[type] || '#94a3b8';
}
function graphNodeColorLight(type: string): string {
  return GRAPH_COLORS_LIGHT[type] || '#cbd5e1';
}

// ─── 图标：每个类型配一个小符号 ──────────────────────────────

const TYPE_SYMBOLS: Record<string, string> = {
  user: '👤',
  feedback: '💬',
  project: '📁',
  reference: '🔗',
  tool: '🔧',
  concept: '💡',
  preference: '⭐',
  person: '🙂',
};
function typeSymbol(t: string): string {
  return TYPE_SYMBOLS[t] || '●';
}

function GraphTab({ focusEntity }: { focusEntity?: { id: string; name: string } | null }) {
  // 图数据状态
  const [graphNodes, setGraphNodes] = useState<Map<string, any>>(new Map());
  const [graphEdges, setGraphEdges] = useState<Map<string, any>>(new Map());
  const [centerId, setCenterId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  // 搜索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maintaining, setMaintaining] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const cyRef = useRef<cytoscape.Core | null>(null);

  // 关系颜色映射
  const relationColors: Record<string, string> = {
    depends_on: '#f97316',
    part_of: '#a78bfa',
    uses: '#22d3ee',
    creates: '#4ade80',
    knows: '#fbbf24',
    influences: '#f472b6',
    references: '#60a5fa',
  };
  function relColor(rel: string, strength: number): string {
    const base = relationColors[rel] || '#94a3b8';
    return `${base}${Math.round(strength * 255).toString(16).padStart(2, '0')}`;
  }

  // ── 搜索 ──────────────────────────────────────────────
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); setShowDropdown(false); return; }
    setSearching(true);
    try {
      const res = await window.electron.memoryGraphSearch({ query: query.trim(), limit: 20 });
      if (res.success && res.nodes) {
        setSearchResults(res.nodes);
        setShowDropdown(res.nodes.length > 0);
      }
    } catch { /* ignore */ }
    setSearching(false);
  }, []);

  // ── 以某节点为中心加载子图 ────────────────────────────
  const focusOnNode = useCallback(async (entityId: string, maxHops: number = 2) => {
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      setLoading(false);
      setError(t('memory.status_query_error'));
    }, 15000);
    try {
      const res = await window.electron.memoryGraphNeighborhood({ entityId, maxHops });
      clearTimeout(timer);
      if (res.success && res.nodes && res.edges) {
        setCenterId(entityId);
        setGraphNodes(prev => {
          const next = new Map(prev);
          for (const n of res.nodes!) next.set(n.id, n);
          return next;
        });
        setGraphEdges(prev => {
          const next = new Map(prev);
          const edgeKey = (e: any) => `${e.subjectId}→${e.relation}→${e.objectId}`;
          for (const e of res.edges!) {
            const key = edgeKey(e);
            if (!next.has(key)) {
              next.set(key, { ...e, id: key, isActive: 1 });
            }
          }
          return next;
        });
        return res;
      } else {
        setError(res.error || t('memory.graph.load_failed'));
        return null;
      }
    } catch (err) {
      clearTimeout(timer);
      setError(err instanceof Error ? err.message : t('memory.graph.load_failed'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 防抖搜索
  useEffect(() => {
    if (!searchQuery.trim()) return;
    const timer = setTimeout(() => doSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery, doSearch]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 初始加载：优先通过 userEntityId 精确定位当前用户根节点
  useEffect(() => {
    if (focusEntity?.id) return;
    (async () => {
      try {
        setLoading(true);
        // 1. 先尝试获取规范的用户实体 ID
        const statusRes = await window.electron.memoryStatus();
        const canonicalUserId = statusRes.success ? statusRes.userEntityId : null;

        if (canonicalUserId) {
          // 精确加载用户根节点的 2 跳子图，从返回的子图中提取中心节点
          const subgraph = await focusOnNode(canonicalUserId, 2);
          const centerNode = subgraph?.nodes?.find((n: any) => n.id === canonicalUserId);
          if (centerNode) {
            setSelectedNode({
              id: centerNode.id,
              name: centerNode.name,
              type: centerNode.type,
              summary: centerNode.summary || '',
              importance: centerNode.importance || 1,
            });
          }
        } else {
          // 2. 降级：按 type='user' 搜索
          const res = await window.electron.memoryEntities({ type: 'user', limit: 1 });
          if (res.success && res.entities && res.entities.length > 0) {
            const userEntity = res.entities[0];
            await focusOnNode(userEntity.id, 2);
            setSelectedNode({
              id: userEntity.id,
              name: userEntity.name,
              type: userEntity.type,
              summary: userEntity.summary || '',
              importance: userEntity.importance || 1,
            });
          } else if (res.error) {
            setError(res.error);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('memory.graph.load_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [focusEntity?.id, focusOnNode, t]);

  // ── 选择搜索结果（清空并聚焦到该节点） ─────────────────
  const selectSearchResult = useCallback(async (node: any) => {
    setShowDropdown(false);
    setSearchQuery(node.name);

    // 清空并加载 2 跳子图
    setGraphNodes(new Map());
    setGraphEdges(new Map());
    setCenterId(null);
    setSelectedNode(null);

    await focusOnNode(node.id, 2);

    // 自动选中
    setSelectedNode({ id: node.id, name: node.name, type: node.type, summary: (node as any).summary || '', importance: (node as any).importance || 1 });
  }, [focusOnNode]);

  useEffect(() => {
    if (!focusEntity?.id) return;
    setSearchQuery(focusEntity.name);
    setShowDropdown(false);
    setGraphNodes(new Map());
    setGraphEdges(new Map());
    setCenterId(null);
    setSelectedNode(null);
    focusOnNode(focusEntity.id, 2).then((subgraph) => {
      const centerNode = subgraph?.nodes?.find((n: any) => n.id === focusEntity.id);
      setSelectedNode({
        id: focusEntity.id,
        name: centerNode?.name || focusEntity.name,
        type: centerNode?.type || 'entity',
        summary: centerNode?.summary || '',
        importance: centerNode?.importance || 1,
      });
    });
  }, [focusEntity?.id, focusEntity?.name, focusOnNode]);

  // ── 动态生成 cytoscape elements ──────────────────────
  const elements = (() => {
    const nodeArray = Array.from(graphNodes.values());
    const edgeArray = Array.from(graphEdges.values());
    const cyNodes = nodeArray.map(n => ({
      data: {
        id: n.id,
        label: (n.name?.length ?? 0) > 18 ? n.name!.slice(0, 17) + '…' : n.name,
        fullName: n.name,
        type: n.type,
        summary: n.summary || '',
        importance: n.importance || 1,
        color: graphNodeColor(n.type),
        colorLight: graphNodeColorLight(n.type),
        symbol: typeSymbol(n.type),
        // 标记是否还能继续展开（有隐藏邻居）
        expandable: true,
      },
    }));
    const cyEdges = edgeArray.filter(e => e.isActive !== 0).map(e => ({
      data: {
        id: e.id,
        source: e.subjectId,
        target: e.objectId,
        label: e.relation?.replace(/_/g, ' ') || '',
        relation: e.relation,
        strength: e.strength || 0.5,
        relColor: relColor(e.relation, e.strength || 0.5),
      },
    }));
    return [...cyNodes, ...cyEdges];
  })();

  // ── Cytoscape 样式表 (visionOS 风格) ─────────────────────

  const stylesheet: cytoscape.StylesheetCSS[] = [
    {
      selector: 'node',
      css: {
        'background-color': 'data(color)',
        'background-opacity': 0.15,
        'background-blacken': 0,
        // 节点 — 玻璃圆形
        'shape': 'ellipse',
        'width': 'mapData(importance, 1, 5, 28, 56)',
        'height': 'mapData(importance, 1, 5, 28, 56)',
        'border-width': 2,
        'border-color': 'data(color)',
        'border-opacity': 0.5,
        // 标签
        'label': 'data(label)',
        'font-size': 10,
        'color': '#e2e8f0',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'font-family': 'SF Pro Text, system-ui, sans-serif',
        'font-weight': '500',
        'text-outline-width': 3,
        'text-outline-color': 'rgba(13,13,18,0.85)',
        'text-wrap': 'wrap',
        'text-max-width': 80,
        // 过渡
        'transition-property': 'width,height,border-color,border-opacity,opacity',
        'transition-duration': 250,
        'transition-timing-function': 'ease-out',
        // 微光晕
        'ghost': 'yes',
        'ghost-offset-x': 0,
        'ghost-offset-y': 0,
        'ghost-opacity': 0.08,
      },
    },
    {
      selector: 'node:selected',
      css: {
        'border-color': 'data(colorLight)',
        'border-width': 3,
        'border-opacity': 0.9,
        'ghost': 'yes',
        'ghost-offset-x': 0,
        'ghost-offset-y': 0,
        'ghost-opacity': 0.2,
      },
    },
    // 高重要性节点 — 发光脉冲
    {
      selector: 'node[importance>=4]',
      css: {
        'border-width': 2.5,
        'border-opacity': 0.7,
      },
    },
    {
      selector: 'edge',
      css: {
        'width': 'mapData(strength, 0, 1, 0.6, 2.5)',
        'line-color': 'data(relColor)',
        'line-opacity': 0.35,
        'target-arrow-color': 'data(relColor)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.6,
        'curve-style': 'bezier',
        // 边标签
        'label': 'data(label)',
        'font-size': 8,
        'color': '#94a3b8',
        'font-family': 'SF Pro Text, system-ui, sans-serif',
        'text-outline-width': 2,
        'text-outline-color': 'rgba(13,13,18,0.85)',
        'text-rotation': 'autorotate',
        'edge-text-rotation': 'autorotate',
        // 过渡
        'transition-property': 'line-color,line-opacity,width,opacity',
        'transition-duration': 200,
      },
    },
    {
      selector: 'edge:selected',
      css: {
        'line-color': '#fbbf24',
        'target-arrow-color': '#fbbf24',
        'line-opacity': 0.9,
        'width': 3,
      },
    },
    // 类型特定的节点颜色覆盖（背景透明度保持玻璃感）
    ...Object.entries(GRAPH_COLORS).map(([type, color]) => ({
      selector: `node[type="${type}"]`,
      css: { 'background-color': color },
    })),
  ];

  const layout: cytoscape.LayoutOptions = {
    name: 'cose-bilkent',
    animate: 'end' as const,
    animationEasing: 'ease-out' as const,
    animationDuration: 1000,
    randomize: true,
    idealEdgeLength: 350,
    nodeRepulsion: 50000,
    gravity: 0.04,
    numIter: 4000,
    tile: true,
    fit: true,
    padding: 80,
  };

  // 类型统计（从当前 visible 节点算）
  const typeCounts: Record<string, number> = {};
  graphNodes.forEach(n => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  // ── 工具栏操作 ────────────────────────────────────────────
  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.animate({ zoom: Math.min(cy.zoom() * 1.3, 3), easing: 'ease-out', duration: 200 });
  };
  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.animate({ zoom: Math.max(cy.zoom() / 1.3, 0.15), easing: 'ease-out', duration: 200 });
  };
  const handleFit = () => {
    const cy = cyRef.current;
    if (cy) cy.animate({ fit: { padding: 50 }, easing: 'ease-in-out-cubic', duration: 400 });
  };
  const handleReset = () => {
    const cy = cyRef.current;
    if (cy) {
      cy.fit(undefined, 50);
      setSelectedNode(null);
    }
  };
  const handleTriggerMaintenance = async () => {
    setMaintaining(true);
    try {
      const res = await window.electron.memoryMaintenanceTrigger();
      if (!res.success) {
        setError(res.error || t('memory.browse.maintenance_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.browse.maintenance_failed'));
    }
    setMaintaining(false);
  };

  if (error) return <ErrorBanner message={error} onRetry={() => setError(null)} />;

  const activeEdgeCount = Array.from(graphEdges.values()).filter(e => e.isActive !== 0).length;

  return (
    <div className="flex h-full">
      {/* ── 主画布区 ─────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at center, rgba(56,189,248,0.04) 0%, rgba(13,13,18,0) 60%)' }}
      >
        {/* 背景网格 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="16" cy="16" r="0.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#graph-grid)" />
        </svg>

        {/* ── 顶部搜索栏 (玻璃) ──────────────────────────── */}
        <div ref={searchRef} className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[380px] max-w-[90%]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card/85 backdrop-blur-xl border border-border/60 shadow-glass-sm">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              placeholder={t('memory.graph.search_placeholder')}
              className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50"
            />
            {searching && <RefreshCw size={12} className="animate-spin text-muted-foreground" />}
            {searchQuery && !searching && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false); }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground">
                <X size={12} />
              </button>
            )}
          </div>

          {/* 搜索下拉 */}
          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-card/95 backdrop-blur-xl border border-border/60 shadow-glass-lg overflow-hidden animate-zoom-in max-h-[300px] overflow-y-auto">
              {searchResults.map(n => (
                <button
                  key={n.id}
                  onClick={() => selectSearchResult(n)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                >
                  <span className="text-base">{typeSymbol(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground">{n.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full border border-border/40">{n.type}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 工具栏 — 玻璃悬浮 */}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          <div className="flex gap-1 p-1 rounded-xl bg-card/80 backdrop-blur-md border border-border/60 shadow-glass-sm">
            <button onClick={handleZoomIn}
              className="p-2 rounded-lg hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
              title={t('memory.graph.tooltip_zoom_in')}
            ><ZoomIn size={15} /></button>
            <button onClick={handleZoomOut}
              className="p-2 rounded-lg hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
              title={t('memory.graph.tooltip_zoom_out')}
            ><ZoomOut size={15} /></button>
            <span className="w-px bg-border/50 my-1" />
            <button onClick={handleFit}
              className="p-2 rounded-lg hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
              title={t('memory.graph.tooltip_fit')}
            ><Maximize2 size={15} /></button>
            <button onClick={handleReset}
              className="p-2 rounded-lg hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
              title={t('memory.graph.tooltip_reset')}
            ><RefreshCw size={15} /></button>
          </div>
        </div>

        {/* 手动触发记忆整理 */}
        <div className="absolute top-3 right-3 z-10 flex gap-1.5">
          <div className="flex gap-1 p-1 rounded-xl bg-card/80 backdrop-blur-md border border-border/60 shadow-glass-sm">
            <button onClick={handleTriggerMaintenance}
              disabled={maintaining}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title={t('memory.graph.tooltip_trigger_maintenance')}
            >
              <Sparkles size={14} className={maintaining ? 'animate-spin' : ''} />
              <span className="text-xs font-medium">
                {maintaining ? t('memory.graph.triggering_maintenance') : t('memory.graph.trigger_maintenance')}
              </span>
            </button>
          </div>
        </div>

        {/* 节点数徽标 */}
        {graphNodes.size > 0 && (
          <div className="absolute top-12 right-3 z-10 px-2.5 py-1 rounded-lg bg-card/70 backdrop-blur-md border border-border/40 text-xs text-muted-foreground">
            {t('memory.graph.node_count', { count: graphNodes.size, edges: activeEdgeCount })}
          </div>
        )}

        <CytoscapeComponent
          elements={elements}
          stylesheet={stylesheet}
          layout={layout}
          style={{ width: '100%', height: '100%' }}
          wheelSensitivity={0.25}
          minZoom={0.12}
          maxZoom={3.5}
          cy={(cy: cytoscape.Core) => {
            cyRef.current = cy;

            // 元素批量变化时防抖布局（避免每个节点 add 都触发完整布局计算）
            let layoutTimer: ReturnType<typeof setTimeout> | null = null;
            cy.on('add', 'node', () => {
              if (cy.nodes().length <= (centerId ? 1 : 0)) return;
              if (layoutTimer) clearTimeout(layoutTimer);
              layoutTimer = setTimeout(() => {
                const l = cy.layout({ name: 'cose-bilkent', animate: true, animationDuration: 800, idealEdgeLength: 350, nodeRepulsion: 50000, gravity: 0.04, numIter: 4000, tile: true, fit: true, padding: 80 });
                l.run();
              }, 150);
            });

            cy.on('tap', 'node', (evt: cytoscape.EventObject) => {
              const node = evt.target;
              setSelectedNode({
                id: node.data('id'),
                name: node.data('fullName'),
                type: node.data('type'),
                summary: node.data('summary'),
                importance: node.data('importance'),
              });
            });

            cy.on('tap', (evt: cytoscape.EventObject) => {
              if (evt.target === cy) {
                setSelectedNode(null);
              }
            });

            // 双击 — 以该节点为中心重新加载 2 跳子图
            cy.on('dblclick', 'node', (evt: cytoscape.EventObject) => {
              const n = evt.target;
              focusOnNode(n.data('id'), 2);
            });

            // Hover 交互 — 邻域高亮
            cy.on('mouseover', 'node', (evt: cytoscape.EventObject) => {
              const neighborhood = evt.target.closedNeighborhood();
              cy.elements().difference(neighborhood).style({ opacity: 0.12 });
              neighborhood.style({ opacity: 1 });
            });
            cy.on('mouseout', 'node', () => {
              cy.elements().style({ opacity: undefined });
            });
          }}
        />

        {/* ── 底部节点详情面板 (玻璃) ───────────────────── */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 right-4 p-4 rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl shadow-glass-lg animate-zoom-in">
            <div className="flex items-start gap-3">
              {/* 节点图标 */}
              <div
                className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg shadow-glass-sm"
                style={{
                  background: `linear-gradient(135deg, ${graphNodeColor(selectedNode.type)}33, ${graphNodeColor(selectedNode.type)}11)`,
                  border: `1px solid ${graphNodeColor(selectedNode.type)}44`,
                  color: graphNodeColor(selectedNode.type),
                }}
              >
                {typeSymbol(selectedNode.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground">{selectedNode.name}</span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full border"
                    style={{
                      backgroundColor: `${graphNodeColor(selectedNode.type)}18`,
                      color: graphNodeColor(selectedNode.type),
                      borderColor: `${graphNodeColor(selectedNode.type)}33`,
                    }}
                  >
                    {selectedNode.type}
                  </span>
                  <ImportanceStars value={selectedNode.importance} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {selectedNode.summary || t('memory.detail.no_summary')}
                </p>

                {/* 关联关系 + 展开按钮 */}
                {(() => {
                  const related = Array.from(graphEdges.values())
                    .filter((e: any) => (e.subjectId === selectedNode.id || e.objectId === selectedNode.id) && e.isActive !== 0);
                  if (related.length === 0 && centerId === selectedNode.id) {
                    // 中心节点无关联（不应该发生，但兜底）
                    return null;
                  }
                  if (related.length === 0) {
                    return null;
                  }
                  return (
                    <div className="mt-3 pt-3 border-t border-border/40 flex flex-wrap gap-1.5">
                      {related.slice(0, 8).map((e: any) => {
                        const isOut = e.subjectId === selectedNode.id;
                        const otherId = isOut ? e.objectId : e.subjectId;
                        const otherNode = graphNodes.get(otherId);
                        const clr = relationColors[e.relation] || '#94a3b8';
                        return (
                          <span
                            key={e.id}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border cursor-pointer hover:opacity-80 transition-opacity"
                            style={{
                              backgroundColor: `${clr}10`,
                              borderColor: `${clr}25`,
                              color: clr,
                            }}
                            onClick={() => {
                              const target = cyRef.current?.getElementById(otherId);
                              if (target && target.length > 0) {
                                cyRef.current?.animate({
                                  center: { eles: target },
                                  zoom: 1.2,
                                  easing: 'ease-in-out-cubic',
                                  duration: 500,
                                });
                                target.emit('tap');
                              }
                            }}
                          >
                            {isOut ? '→' : '←'} {e.relation?.replace(/_/g, ' ')}
                            {' · '}
                            {otherNode?.name || otherId?.slice(0, 8)}
                          </span>
                        );
                      })}
                      {related.length > 8 && (
                        <span className="text-[10px] text-muted-foreground self-center">
                          {t('memory.graph.more', { count: related.length - 8 })}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              <button
                onClick={() => setSelectedNode(null)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {/* 空状态 — 引导搜索 */}
        {graphNodes.size === 0 && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <GitGraph size={48} className="text-muted-foreground/15 mb-4" />
            <p className="text-sm text-muted-foreground/50">{t('memory.graph.empty_title')}</p>
            <p className="text-xs text-muted-foreground/30 mt-1">{t('memory.graph.empty_hint')}</p>
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card/80 backdrop-blur-md border border-border/60 shadow-glass-sm">
              <RefreshCw size={14} className="animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">{t('memory.graph.loading')}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 右侧图例 (玻璃面板) ──────────────────────────── */}
      <aside className="w-48 border-l border-border/60 bg-card/50 backdrop-blur-sm p-4 shrink-0 overflow-y-auto space-y-5">
        {/* 图例标题 */}
        <div>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {t('memory.graph.legend_nodes')}
          </h4>
          <div className="space-y-2">
            {sortedTypes.map(([type, count]) => (
              <div key={type} className="flex items-center gap-2.5 text-xs group cursor-default">
                <span
                  className="w-3 h-3 rounded-full shrink-0 shadow-sm transition-transform group-hover:scale-125"
                  style={{ backgroundColor: graphNodeColor(type) }}
                />
                <span className="text-foreground/80 flex items-center gap-1.5">
                  <span className="text-[12px]">{typeSymbol(type)}</span>
                  {type}
                </span>
                <span className="text-muted-foreground/60 ml-auto tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 关系图例 */}
        <div className="pt-4 border-t border-border/40">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {t('memory.graph.legend_edges')}
          </h4>
          <div className="space-y-1.5">
            {Object.entries({
              depends_on: t('memory.graph.legend_relation_depends'),
              part_of: t('memory.graph.legend_relation_part_of'),
              uses: t('memory.graph.legend_relation_uses'),
              creates: t('memory.graph.relation_creates'),
              knows: t('memory.graph.relation_knows'),
              references: t('memory.graph.relation_references'),
            }).map(([key, label]) => (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                <span className="w-6 h-0.5 rounded-full shrink-0" style={{ backgroundColor: relationColors[key] || '#94a3b8' }} />
                <span className="text-foreground/70">{label}</span>
                <span className="text-muted-foreground/50 ml-auto">{key}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 统计摘要 */}
        <div className="pt-4 border-t border-border/40">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-background/60 border border-border/30">
              <p className="text-[10px] text-muted-foreground">{t('memory.graph.stat_nodes')}</p>
              <p className="text-lg font-semibold text-foreground/80 tabular-nums">{graphNodes.size}</p>
            </div>
            <div className="p-2 rounded-lg bg-background/60 border border-border/30">
              <p className="text-[10px] text-muted-foreground">{t('memory.graph.stat_edges')}</p>
              <p className="text-lg font-semibold text-foreground/80 tabular-nums">{activeEdgeCount}</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
            {t('memory.graph.hint')}
          </p>
        </div>
      </aside>
    </div>
  );
}

// ─── Tab: 统计仪表盘 ───────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState<any>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [sRes, eRes, fRes, evRes, epRes] = await Promise.all([
          window.electron.memoryStats(),
          window.electron.memoryEntities({ limit: 500 }),
          window.electron.memoryFacts({ limit: 500 }),
          window.electron.memoryTimeline({ limit: 500 }),
          window.electron.memoryEpisodes({ limit: 200 }),
        ]);
        if (sRes.success) setStats(sRes.stats);
        else setError(sRes.error || t('memory.load_stats_failed'));
        if (eRes.success) setEntities(eRes.entities || []);
        if (fRes.success) setFacts(fRes.facts || []);
        if (evRes.success) setEvents(evRes.events || []);
        if (epRes.success) setEpisodes(epRes.episodes || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('memory.load_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} />;

  // 按类型统计
  const typeDist: Record<string, number> = {};
  entities.forEach(e => { typeDist[e.type] = (typeDist[e.type] || 0) + 1; });
  const sortedTypes = Object.entries(typeDist).sort((a, b) => b[1] - a[1]);
  const totalEntities = entities.length;
  const maxTypeCount = sortedTypes[0]?.[1] || 1;

  const allMemoryItems = [
    ...entities.map(normalizeEntity),
    ...facts.map(normalizeFact),
    ...events.map(normalizeEvent),
    ...episodes.map(normalizeEpisode),
  ];

  // 按重要性分布
  const importanceDist: Record<number, number> = {};
  allMemoryItems.forEach(item => {
    if (item.importance) importanceDist[item.importance] = (importanceDist[item.importance] || 0) + 1;
  });
  const totalImportantItems = allMemoryItems.filter(item => item.importance).length;

  const sceneDist: Record<string, number> = {};
  allMemoryItems.forEach(item => {
    const scene = item.sceneTag || t('memory.stats.unlabeled_scene');
    sceneDist[scene] = (sceneDist[scene] || 0) + 1;
  });
  const sortedScenes = Object.entries(sceneDist).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topEntities = [...entities]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0) || (b.ref_count || 0) - (a.ref_count || 0))
    .slice(0, 8);

  const statCards = stats ? [
    { label: t('memory.stats.card_entity'), value: stats.entityCount, icon: <User size={16} />, color: 'text-blue-400' },
    { label: t('memory.stats.card_fact'), value: stats.factCount, icon: <FileText size={16} />, color: 'text-yellow-400' },
    { label: t('memory.stats.card_event'), value: stats.eventCount, icon: <Calendar size={16} />, color: 'text-green-400' },
    { label: t('memory.stats.card_relation'), value: stats.relationCount, icon: <GitGraph size={16} />, color: 'text-purple-400' },
    { label: t('memory.stats.card_episode'), value: stats.episodeCount, icon: <Brain size={16} />, color: 'text-indigo-400' },
    { label: t('memory.stats.card_database'), value: formatBytes(stats.dbSizeBytes), icon: <Database size={16} />, color: 'text-orange-400' },
  ] : [];

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-2">
              <span className={card.color}>{card.icon}</span>
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{card.value}</p>
          </div>
        ))}
      </div>

      {/* 类型分布 + 重要性分布 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 类型分布横向条形图 */}
        <div className="p-4 rounded-lg border border-border bg-card">
          <h4 className="text-sm font-semibold text-foreground mb-3">{t('memory.stats.title_type_dist')}</h4>
          {totalEntities === 0 ? (
            <p className="text-xs text-muted-foreground">{t('memory.stats.empty')}</p>
          ) : (
            <div className="space-y-2">
              {sortedTypes.map(([type, count]) => (
                <div key={type} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded border ${getTypeColor(type)}`}>{type}</span>
                    <span className="text-muted-foreground ml-auto">{count} ({(count / totalEntities * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${getTypeColor(type).split(' ')[0]}`}
                      style={{ width: `${(count / maxTypeCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 重要性分布 */}
        <div className="p-4 rounded-lg border border-border bg-card">
          <h4 className="text-sm font-semibold text-foreground mb-3">{t('memory.stats.title_importance_dist')}</h4>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map(imp => {
              const count = importanceDist[imp] || 0;
              return (
                <div key={imp} className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1 w-12">
                    <ImportanceStars value={imp} />
                  </span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-500/60 rounded-full"
                      style={{ width: totalImportantItems > 0 ? `${(count / totalImportantItems) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border border-border bg-card">
          <h4 className="text-sm font-semibold text-foreground mb-3">{t('memory.stats.title_scene_dist')}</h4>
          {sortedScenes.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('memory.stats.empty')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sortedScenes.map(([scene, count]) => (
                <span key={scene} className="text-xs px-2 py-1 rounded border border-border bg-background text-muted-foreground">
                  {scene} · {count}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-lg border border-border bg-card">
          <h4 className="text-sm font-semibold text-foreground mb-3">{t('memory.stats.title_top_entities')}</h4>
          {topEntities.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('memory.stats.empty')}</p>
          ) : (
            <div className="space-y-2">
              {topEntities.map(entity => (
                <div key={entity.id} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded border ${getTypeColor(entity.type)}`}>{entity.type}</span>
                  <span className="text-foreground line-clamp-1">{entity.name}</span>
                  <span className="ml-auto"><ImportanceStars value={entity.importance || 1} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: 操作日志 ─────────────────────────────────────────

function LogTab() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await window.electron.memoryTimeline({ limit: 100 });
        if (res.success) setEvents(res.events || []);
        else setError(res.error || t('memory.load_log_failed'));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('memory.load_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="p-4 overflow-y-auto h-full">
      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Clock size={40} className="mb-3 opacity-30" />
          <p className="text-sm">{t('memory.log.empty')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {events.map((ev, i) => (
            <div key={ev.id} className="flex gap-3 py-2">
              {/* 时间线 */}
              <div className="flex flex-col items-center shrink-0 w-16">
                <span className="text-xs text-muted-foreground">{formatTime(ev.time)}</span>
                <div className={`w-2 h-2 rounded-full mt-1 ${
                  ev.importance >= 4 ? 'bg-yellow-400' :
                  ev.importance >= 3 ? 'bg-blue-400' :
                  'bg-gray-500'
                }`} />
                {i < events.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
              </div>
              {/* 内容 */}
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${
                    ev.importance >= 4 ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' :
                    'bg-blue-500/15 text-blue-400 border-blue-500/25'
                  }`}>
                    {ev.importance >= 4 ? t('memory.log.badge_important') : t('memory.log.badge_normal')}
                  </span>
                  {ev.operator && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <User size={10} /> {ev.operator}
                    </span>
                  )}
                  <ImportanceStars value={ev.importance} />
                </div>
                <p className="text-sm text-foreground">{ev.content}</p>
                {ev.result && (
                  <p className="text-xs text-muted-foreground mt-0.5">{ev.result}</p>
                )}
                <div className="flex gap-2 mt-1 text-xs text-muted-foreground/60">
                  {ev.scene_tag && <span>{t('memory.log.scene_label', { tag: ev.scene_tag })}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 主页面 ────────────────────────────────────────────────

export default function MemoryPage({ onClose }: MemoryPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [clearing, setClearing] = useState(false);
  const [memStatus, setMemStatus] = useState<{ initialized?: boolean; error?: string | null } | null>(null);
  const [browseReloadToken, setBrowseReloadToken] = useState(0);
  const [graphFocusEntity, setGraphFocusEntity] = useState<{ id: string; name: string } | null>(null);
  const sessionStatus = useSessionInitStore((s) => s.status);

  const checkMemoryStatus = useCallback(async () => {
    try {
      const res = await window.electron.memoryStatus();
      if (res.success) {
        setMemStatus({ initialized: res.initialized, error: res.error });
      } else {
        setMemStatus({ initialized: false, error: res.error || t('memory.status_query_failed') });
      }
    } catch (err) {
      setMemStatus({ initialized: false, error: err instanceof Error ? err.message : t('memory.status_query_error') });
    }
  }, []);

  // 每当 session 状态变化时重新查询（初始加载 + ready/failed 时重试）
  useEffect(() => {
    checkMemoryStatus();
  }, [sessionStatus, checkMemoryStatus]);

  const handleClearAll = async () => {
    if (!confirm(t('memory.confirm_clear_all'))) return;
    setClearing(true);
    try {
      const res = await window.electron.memoryClearAll();
      if (res.success) {
        alert(t('memory.alert_clear_success'));
        setBrowseReloadToken(v => v + 1);
        checkMemoryStatus();
      } else {
        alert(t('memory.alert_clear_failed', { error: res.error }));
      }
    } catch (err) {
      alert(t('memory.alert_clear_failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setClearing(false);
    }
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'browse', label: t('memory.tab.browse'), icon: <Brain size={16} /> },
    { id: 'graph', label: t('memory.tab.graph'), icon: <GitGraph size={16} /> },
    { id: 'stats', label: t('memory.tab.stats'), icon: <BarChart3 size={16} /> },
    { id: 'log', label: t('memory.tab.log'), icon: <Clock size={16} /> },
  ];

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* 顶部栏 */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={18} />
          <h1 className="text-base font-semibold">{t('memory.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7" title={t('memory.btn_close')}>
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* 状态横幅 */}
      {memStatus && !memStatus.initialized && (
        <div className="mx-4 mt-3 p-3 rounded border bg-red-500/10 text-red-400 border-red-500/20 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{t('memory.status_not_initialized')}</p>
            <p className="text-xs mt-0.5 text-red-400/70">{memStatus.error || t('memory.status_unknown_error')}</p>
            <p className="text-xs mt-1 text-red-400/50">
              {t('memory.status_error_hint')}
            </p>
          </div>
        </div>
      )}
      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-40 border-r border-border bg-card p-3 space-y-1 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </aside>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'browse' && (
            <BrowseTab
              onOpenGraph={(entity) => {
                setGraphFocusEntity(entity);
                setActiveTab('graph');
              }}
              onClearAll={handleClearAll}
              clearBusy={clearing}
              reloadToken={browseReloadToken}
            />
          )}
          {activeTab === 'graph' && <GraphTab focusEntity={graphFocusEntity} />}
          {activeTab === 'stats' && <StatsTab />}
          {activeTab === 'log' && <LogTab />}
        </div>
      </div>
    </div>
  );
}
