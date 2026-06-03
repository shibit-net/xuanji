// ============================================================
// GraphTab - 记忆图谱
// ============================================================
// 使用 Cytoscape.js 渲染实体-关系网络，visionOS 风格

import { useState, useCallback, useRef, useEffect } from 'react';
import { t } from '@/core/i18n';
import { Button } from '@/components/ui/button';
import {
  Search, X, RefreshCw, ZoomIn, ZoomOut,
  Maximize2, Sparkles, GitGraph,
} from 'lucide-react';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import { ErrorBanner, ImportanceStars } from './components';
import {
  graphNodeColor, graphNodeColorLight, typeSymbol, GRAPH_COLORS,
} from './shared';

export function GraphTab({ focusEntity }: { focusEntity?: { id: string; name: string } | null }) {
  const [graphNodes, setGraphNodes] = useState<Map<string, any>>(new Map());
  const [graphEdges, setGraphEdges] = useState<Map<string, any>>(new Map());
  const [centerId, setCenterId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maintaining, setMaintaining] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

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
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const timer = setTimeout(() => doSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery, doSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (focusEntity?.id) return;
    (async () => {
      try {
        setLoading(true);
        const statusRes = await window.electron.memoryStatus();
        const canonicalUserId = statusRes.success ? statusRes.userEntityId : null;

        if (canonicalUserId) {
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
  }, [focusEntity?.id, focusOnNode]);

  const selectSearchResult = useCallback(async (node: any) => {
    setShowDropdown(false);
    setSearchQuery(node.name);
    setGraphNodes(new Map());
    setGraphEdges(new Map());
    setCenterId(null);
    setSelectedNode(null);
    await focusOnNode(node.id, 2);
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

  const stylesheet: cytoscape.StylesheetCSS[] = [
    {
      selector: 'node',
      css: {
        'background-color': 'data(color)',
        'background-opacity': 0.15,
        'background-blacken': 0,
        'shape': 'ellipse',
        'width': 'mapData(importance, 1, 5, 28, 56)',
        'height': 'mapData(importance, 1, 5, 28, 56)',
        'border-width': 2,
        'border-color': 'data(color)',
        'border-opacity': 0.5,
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
        'transition-property': 'width,height,border-color,border-opacity,opacity',
        'transition-duration': 250,
        'transition-timing-function': 'ease-out',
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
    {
      selector: 'node[importance>=4]',
      css: { 'border-width': 2.5, 'border-opacity': 0.7 },
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
        'label': 'data(label)',
        'font-size': 8,
        'color': '#94a3b8',
        'font-family': 'SF Pro Text, system-ui, sans-serif',
        'text-outline-width': 2,
        'text-outline-color': 'rgba(13,13,18,0.85)',
        'text-rotation': 'autorotate',
        'edge-text-rotation': 'autorotate',
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
    idealEdgeLength: 650,
    nodeRepulsion: 200000,
    gravity: 0.012,
    numIter: 6000,
    tile: true,
    fit: true,
    padding: 120,
  };

  const typeCounts: Record<string, number> = {};
  graphNodes.forEach(n => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

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
      <div ref={graphContainerRef}
        className="flex-1 relative overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at center, rgba(56,189,248,0.04) 0%, rgba(13,13,18,0) 60%)' }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const isUIElement = target.closest('[data-graph-ui]');
          if (!isUIElement && cyRef.current) {
            cyRef.current.elements().removeStyle('opacity');
          }
        }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="16" cy="16" r="0.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#graph-grid)" />
        </svg>

        <div ref={searchRef} data-graph-ui className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[380px] max-w-[90%]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card/85 backdrop-blur-xl border border-border/25 shadow-glass-sm">
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

          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-card/95 backdrop-blur-xl border border-border/25 shadow-glass-lg overflow-hidden animate-zoom-in max-h-[300px] overflow-y-auto">
              {searchResults.map(n => (
                <button
                  key={n.id}
                  onClick={() => selectSearchResult(n)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                >
                  <span className="text-base">{typeSymbol(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground">{n.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full border border-border/20">{n.type}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div data-graph-ui className="absolute top-3 left-3 z-10 flex gap-1.5">
          <div className="flex gap-1 p-1 rounded-xl bg-card/80 backdrop-blur-md border border-border/25 shadow-glass-sm">
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

        <div data-graph-ui className="absolute top-3 right-3 z-10 flex gap-1.5">
          <div className="flex gap-1 p-1 rounded-xl bg-card/80 backdrop-blur-md border border-border/25 shadow-glass-sm">
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

        {graphNodes.size > 0 && (
          <div data-graph-ui className="absolute top-12 right-3 z-10 px-2.5 py-1 rounded-lg bg-card/70 backdrop-blur-md border border-border/20 text-xs text-muted-foreground">
            {t('memory.graph.node_count', { count: graphNodes.size, edges: activeEdgeCount })}
          </div>
        )}

        <CytoscapeComponent
          elements={elements}
          stylesheet={stylesheet}
          layout={layout}
          className="w-full h-full"
          wheelSensitivity={0.25}
          minZoom={0.12}
          maxZoom={3.5}
          cy={(cy: cytoscape.Core) => {
            cyRef.current = cy;
            let layoutTimer: ReturnType<typeof setTimeout> | null = null;
            cy.on('add', 'node', () => {
              if (cy.nodes().length <= (centerId ? 1 : 0)) return;
              if (layoutTimer) clearTimeout(layoutTimer);
              layoutTimer = setTimeout(() => {
                const l = cy.layout({ name: 'cose-bilkent', animate: true, animationDuration: 800, idealEdgeLength: 650, nodeRepulsion: 200000, gravity: 0.012, numIter: 6000, tile: true, fit: true, padding: 120 });
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
              const target = evt.target;
              if (!target.isNode || (!target.isNode() && !target.isEdge?.())) {
                setSelectedNode(null);
                cy.elements().removeStyle('opacity');
              }
            });
            cy.on('dblclick', 'node', (evt: cytoscape.EventObject) => {
              const n = evt.target;
              focusOnNode(n.data('id'), 2);
            });
            cy.on('mouseover', 'node', (evt: cytoscape.EventObject) => {
              const node = evt.target;
              const neighbors = node.neighborhood();
              const highlight = node.union(neighbors);
              cy.elements().difference(highlight).style({ opacity: 0.50 });
              highlight.style({ opacity: 1 });
            });
            cy.on('mouseout', 'node', () => {
              cy.elements().removeStyle('opacity');
            });
          }}
        />

        {selectedNode && (
          <div data-graph-ui className="absolute bottom-4 left-4 right-4 p-4 rounded-2xl border border-border/25 bg-card/90 backdrop-blur-xl shadow-glass-lg animate-zoom-in">
            <div className="flex items-start gap-3">
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
                {(() => {
                  const related = Array.from(graphEdges.values())
                    .filter((e: any) => (e.subjectId === selectedNode.id || e.objectId === selectedNode.id) && e.isActive !== 0);
                  if (related.length === 0) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-border/20 flex flex-wrap gap-1.5">
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

        {graphNodes.size === 0 && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <GitGraph size={48} className="text-muted-foreground/15 mb-4" />
            <p className="text-sm text-muted-foreground/50">{t('memory.graph.empty_title')}</p>
            <p className="text-xs text-muted-foreground/30 mt-1">{t('memory.graph.empty_hint')}</p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div data-graph-ui className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card/80 backdrop-blur-md border border-border/25 shadow-glass-sm">
              <RefreshCw size={14} className="animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">{t('memory.graph.loading')}</span>
            </div>
          </div>
        )}
      </div>

      <aside className="w-48 border-l border-border/25 bg-card/50 backdrop-blur-sm p-4 shrink-0 overflow-y-auto space-y-5">
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

        <div className="pt-4 border-t border-border/20">
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

        <div className="pt-4 border-t border-border/20">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-background/60 border border-border/15">
              <p className="text-[10px] text-muted-foreground">{t('memory.graph.stat_nodes')}</p>
              <p className="text-lg font-semibold text-foreground/80 tabular-nums">{graphNodes.size}</p>
            </div>
            <div className="p-2 rounded-lg bg-background/60 border border-border/15">
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
