// ============================================================
// BrowseTab - 记忆浏览
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { t } from '@/core/i18n';
import { Button } from '@/components/ui/button';
import { Search, X, RefreshCw, Database, Trash2, Sparkles } from 'lucide-react';
import { LoadingSpinner, ErrorBanner, SummaryMetric, MemoryCard, DetailPanel } from './components';
import {
  normalizeEntity, normalizeFact, normalizeEvent,
  normalizeEpisode, normalizeSearchResult, formatTime, latestTime,
  ENTITY_TYPE_LABEL_KEYS,
} from './shared';
import type { ObjectFilter, ImportanceFilter } from './shared';

interface BrowseTabProps {
  onOpenGraph: (entity: { id: string; name: string }) => void;
  onClearAll: () => void;
  clearBusy: boolean;
  reloadToken: number;
}

export default function BrowseTab({
  onOpenGraph,
  onClearAll,
  clearBusy,
  reloadToken,
}: BrowseTabProps) {
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
      <aside className="w-52 border-r border-border p-3 space-y-4 shrink-0 overflow-y-auto">
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
