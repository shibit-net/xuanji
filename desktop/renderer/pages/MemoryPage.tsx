// ============================================================
// MemoryPage - 记忆管理页面
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { t } from '@/core/i18n';
import { Button } from '@/components/ui/button';
import {
  Brain, X, Search, Trash2, Database, GitGraph,
  BarChart3, Clock, User, FileText,
  Calendar, RefreshCw, AlertCircle,
  Sparkles,
} from 'lucide-react';

import {
  LoadingSpinner, ErrorBanner, ImportanceStars,
  MemoryCard, SummaryMetric, DetailPanel, Field,
} from './memory/components';
import {
  getTypeColor, formatTime, formatBytes,
  normalizeEntity, normalizeFact, normalizeEvent,
  normalizeEpisode, normalizeSearchResult, latestTime,
  ENTITY_TYPE_LABEL_KEYS,
} from './memory/shared';
import { GraphTab } from './memory/GraphTab';
import type { MemoryKind, ObjectFilter, ImportanceFilter, NormalizedMemoryItem } from './memory/shared';

interface MemoryPageProps {
  onClose: () => void;
}

type TabType = 'browse' | 'graph' | 'stats' | 'log';

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
        <aside className="w-40 border-r border-border p-3 space-y-1 shrink-0">
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
