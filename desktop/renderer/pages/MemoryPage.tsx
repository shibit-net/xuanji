// ============================================================
// MemoryPage - 记忆管理页面
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Brain, X, Search, Trash2, Database, GitGraph,
  BarChart3, Clock, User, FileText, Star,
  Calendar, Tag, RefreshCw, AlertCircle,
  ZoomIn, ZoomOut, Maximize2,
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-3 mx-4 mt-3 rounded border bg-red-500/10 text-red-400 border-red-500/20 flex items-center gap-2 text-sm">
      <AlertCircle size={16} />
      {message}
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

function BrowseTab() {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<any>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eRes, fRes, evRes, epRes] = await Promise.all([
        window.electron.memoryEntities({ limit: 200 }),
        window.electron.memoryFacts({ limit: 200 }),
        window.electron.memoryTimeline({ limit: 200 }),
        window.electron.memoryEpisodes({ limit: 50 }),
      ]);
      const safeArray = (v: any) => Array.isArray(v) ? v : [];
      const errors: string[] = [];
      if (eRes.success) setEntities(safeArray(eRes.entities)); else if (eRes.error) errors.push(eRes.error);
      if (fRes.success) setFacts(safeArray(fRes.facts)); else if (fRes.error) errors.push(fRes.error);
      if (evRes.success) setEvents(safeArray(evRes.events)); else if (evRes.error) errors.push(evRes.error);
      if (epRes.success) setEpisodes(safeArray(epRes.episodes)); else if (epRes.error) errors.push(epRes.error);
      if (errors.length > 0) setError(errors[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await window.electron.memorySearch({ query: searchQuery, limit: 50 });
      if (res.success) setResults(res.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    { id: 'all', label: '全部', count: entities.length + facts.length + events.length + episodes.length },
    { id: 'entity', label: '实体', count: entities.length },
    { id: 'fact', label: '事实', count: facts.length },
    { id: 'event', label: '事件', count: events.length },
    { id: 'episode', label: '叙事', count: episodes.length },
  ];

  const renderStar = (val: number) => <ImportanceStars value={val} />;

  if (loading) return <LoadingSpinner />;

  return (
    <div className="flex h-full">
      {/* 左侧分类 */}
      <aside className="w-40 border-r border-border bg-card p-3 space-y-1 shrink-0">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCategory(cat.id); setDetailItem(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors ${
              activeCategory === cat.id
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <span>{cat.label}</span>
            <span className="text-xs opacity-60">{cat.count}</span>
          </button>
        ))}
      </aside>

      {/* 右侧内容 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && <ErrorBanner message={error} />}
        {/* 搜索栏 */}
        <div className="p-3 border-b border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索记忆..."
              className="flex-1 px-3 py-1.5 bg-muted border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary"
            />
            <Button onClick={handleSearch} variant="default" size="sm" className="gap-1">
              <Search size={14} /> 搜索
            </Button>
            <Button onClick={loadData} variant="ghost" size="sm">
              <RefreshCw size={14} />
            </Button>
          </div>
        </div>

        {/* 搜索结果显示 */}
        {searchQuery && results.length > 0 && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {results.map((r) => (
              <div
                key={`${r.source_table}-${r.source_id}`}
                onClick={() => setDetailItem(r)}
                className="p-3 rounded border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(r.source_table)}`}>
                    {r.source_table}
                  </span>
                  <span className="text-sm font-medium text-foreground">{r.title}</span>
                  {r.score !== undefined && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{r.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* 分类列表 */}
        {(!searchQuery || results.length === 0) && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {(activeCategory === 'all' || activeCategory === 'entity') && entities.map(e => (
              <div key={e.id} onClick={() => setDetailItem({ ...e, _type: 'entity' })}
                className="p-3 rounded border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(e.type)}`}>{e.type}</span>
                  <span className="text-sm font-medium text-foreground">{e.name}</span>
                  <span className="ml-auto">{renderStar(e.importance)}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{e.summary}</p>
                <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground/70">
                  <span className="flex items-center gap-1"><Clock size={10} />{formatTime(e.updated_at)}</span>
                  <span className="flex items-center gap-1"><Tag size={10} />{e.scene_tag || '—'}</span>
                </div>
              </div>
            ))}

            {(activeCategory === 'all' || activeCategory === 'fact') && facts.map(f => (
              <div key={f.id} onClick={() => setDetailItem({ ...f, _type: 'fact' })}
                className="p-3 rounded border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded border bg-yellow-500/15 text-yellow-400 border-yellow-500/25">fact</span>
                  <span className="text-sm font-medium text-foreground">{f.title}</span>
                  <span className="text-xs text-muted-foreground">v{f.version}</span>
                  <span className="text-xs px-1 py-0 rounded bg-muted text-muted-foreground ml-auto">{f.source}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{f.content}</p>
              </div>
            ))}

            {(activeCategory === 'all' || activeCategory === 'event') && events.map(ev => (
              <div key={ev.id} onClick={() => setDetailItem({ ...ev, _type: 'event' })}
                className="p-3 rounded border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/25">event</span>
                  <span className="text-sm text-foreground line-clamp-1">{ev.content}</span>
                  <span className="ml-auto">{renderStar(ev.importance)}</span>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground/70">
                  <span className="flex items-center gap-1"><Calendar size={10} />{formatTime(ev.time)}</span>
                  {ev.operator && <span className="flex items-center gap-1"><User size={10} />{ev.operator}</span>}
                </div>
              </div>
            ))}

            {(activeCategory === 'all' || activeCategory === 'episode') && episodes.map(ep => (
              <div key={ep.id} onClick={() => setDetailItem({ ...ep, _type: 'episode' })}
                className="p-3 rounded border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded border bg-indigo-500/15 text-indigo-400 border-indigo-500/25">episode</span>
                  <span className="text-sm font-medium text-foreground">{ep.title}</span>
                  <span className="ml-auto">{renderStar(ep.importance)}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{ep.narrative}</p>
                <div className="text-xs text-muted-foreground/70 mt-1">
                  <Clock size={10} className="inline mr-1" />{formatTime(ep.timestamp)}
                </div>
              </div>
            ))}

            {entities.length === 0 && facts.length === 0 && events.length === 0 && episodes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Database size={40} className="mb-3 opacity-30" />
                <p className="text-sm">暂无记忆数据</p>
                <p className="text-xs mt-1 opacity-60">记忆将在对话过程中自动提取</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 详情面板 */}
      {detailItem && (
        <DetailPanel item={detailItem} onClose={() => setDetailItem(null)} />
      )}
    </div>
  );
}

// ─── 详情面板 ──────────────────────────────────────────────

function DetailPanel({ item, onClose }: { item: any; onClose: () => void }) {
  const itype = item._type || item.source_table || 'entity';
  return (
    <aside className="w-80 border-l border-border bg-card p-4 shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">详情</h3>
        <Button onClick={onClose} variant="ghost" size="icon" className="h-6 w-6"><X size={14} /></Button>
      </div>

      <div className="space-y-3 text-sm">
        {itype === 'entity' && (
          <>
            <Field label="名称" value={item.name} />
            <Field label="类型">
              <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(item.type)}`}>{item.type}</span>
            </Field>
            <Field label="摘要" value={item.summary} />
            {item.belief && <Field label="信念" value={item.belief} />}
            <Field label="场景标签" value={item.scene_tag || '—'} />
            <Field label="重要性"><ImportanceStars value={item.importance} /></Field>
            <Field label="引用次数" value={String(item.ref_count)} />
            <Field label="创建时间" value={formatTime(item.created_at)} />
            <Field label="更新时间" value={formatTime(item.updated_at)} />
          </>
        )}

        {itype === 'fact' && (
          <>
            <Field label="标题" value={item.title} />
            <Field label="内容" value={item.content} />
            <Field label="来源" value={item.source} />
            <Field label="版本" value={`v${item.version}`} />
            <Field label="场景标签" value={item.scene_tag || '—'} />
            <Field label="创建时间" value={formatTime(item.created_at)} />
          </>
        )}

        {itype === 'event' && (
          <>
            <Field label="内容" value={item.content} />
            {item.result && <Field label="结果" value={item.result} />}
            <Field label="时间" value={formatTime(item.time)} />
            <Field label="重要性"><ImportanceStars value={item.importance} /></Field>
            {item.operator && <Field label="操作者" value={item.operator} />}
            <Field label="场景标签" value={item.scene_tag || '—'} />
          </>
        )}

        {itype === 'episode' && (
          <>
            <Field label="标题" value={item.title} />
            <Field label="叙事" value={item.narrative} />
            <Field label="时间" value={formatTime(item.timestamp)} />
            <Field label="重要性"><ImportanceStars value={item.importance} /></Field>
            <Field label="场景标签" value={item.scene_tag || '—'} />
          </>
        )}

        {(itype === 'all' || itype === 'entity') && item.source_table && (
          <>
            <Field label="来源表" value={item.source_table} />
            <Field label="标题" value={item.title} />
            <Field label="内容" value={item.content} />
            <Field label="相关度" value={item.score ? `${(item.score * 100).toFixed(0)}%` : '—'} />
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
      {children || <span className="text-sm text-foreground break-words">{value || '—'}</span>}
    </div>
  );
}

// ─── Tab: 知识图谱 ─────────────────────────────────────────

function GraphTab() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await window.electron.memoryGraphData({});
        if (res.success) {
          setNodes(res.nodes || []);
          setEdges(res.edges || []);
        } else {
          setError(res.error || '加载失败');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} />;

  // 活跃边
  const activeEdges = edges.filter(e => e.is_active);

  // 转换为 Cytoscape 格式
  const elements = [
    ...nodes.map(n => ({
      data: {
        id: n.id,
        label: n.name.length > 12 ? n.name.slice(0, 12) + '...' : n.name,
        fullName: n.name,
        type: n.type,
        summary: n.summary || '',
        importance: n.importance || 1,
        color: getNodeColor(n.type),
      },
    })),
    ...activeEdges.map(e => ({
      data: {
        id: e.id,
        source: e.subject_id,
        target: e.object_id,
        label: e.relation,
        strength: e.strength || 0.5,
      },
    })),
  ];

  // Cytoscape 样式表
  const stylesheet: cytoscape.StylesheetCSS[] = [
    {
      selector: 'node',
      css: {
        'background-color': 'data(color)',
        'label': 'data(label)',
        'font-size': '9px',
        'color': '#e2e8f0',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 4,
        'width': 'mapData(importance, 1, 5, 16, 36)',
        'height': 'mapData(importance, 1, 5, 16, 36)',
        'border-width': 2,
        'border-color': '#1e293b',
        'opacity': 0.9,
        'text-outline-width': 1,
        'text-outline-color': '#0f172a',
        'transition-property': 'width,height,border-color,opacity',
        'transition-duration': 200,
      },
    },
    {
      selector: 'node:selected',
      css: {
        'border-color': '#fbbf24',
        'border-width': 3,
        'opacity': 1,
      },
    },
    {
      selector: 'edge',
      css: {
        'width': 'mapData(strength, 0, 1, 0.5, 3)',
        'line-color': 'rgba(100,116,139,0.35)',
        'target-arrow-color': 'rgba(100,116,139,0.5)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '7px',
        'color': '#94a3b8',
        'text-outline-width': 1,
        'text-outline-color': '#0f172a',
        'text-rotation': 'autorotate',
        'opacity': 0.7,
      },
    },
    {
      selector: 'edge:selected',
      css: {
        'line-color': '#fbbf24',
        'target-arrow-color': '#fbbf24',
        'opacity': 1,
      },
    },
    // 各类型节点高亮色
    ...Object.entries(TYPE_HEX_COLORS).map(([type, color]) => ({
      selector: `node[type="${type}"]`,
      css: { 'background-color': color },
    })),
  ];

  const layout = {
    name: 'cose-bilkent',
    animate: 'end' as const,
    animationEasing: 'ease-out' as const,
    animationDuration: 800,
    randomize: true,
    idealEdgeLength: 100,
    nodeRepulsion: 6000,
    gravity: 0.3,
    numIter: 2000,
    tile: true,
    fit: true,
    padding: 40,
  };

  // 按类型统计节点数
  const typeCounts: Record<string, number> = {};
  nodes.forEach(n => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });

  // 控制按钮
  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.2);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() / 1.2);
  const handleFit = () => cyRef.current?.fit(undefined, 40);

  return (
    <div className="flex h-full">
      <div className="flex-1 relative bg-background/50 overflow-hidden">
        {/* 工具栏 */}
        <div className="absolute top-2 left-2 z-10 flex gap-1">
          <button onClick={handleZoomIn}
            className="p-1.5 rounded bg-card border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition"
            title="放大"
          ><ZoomIn size={14} /></button>
          <button onClick={handleZoomOut}
            className="p-1.5 rounded bg-card border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition"
            title="缩小"
          ><ZoomOut size={14} /></button>
          <button onClick={handleFit}
            className="p-1.5 rounded bg-card border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition"
            title="适应屏幕"
          ><Maximize2 size={14} /></button>
        </div>

        <CytoscapeComponent
          elements={elements}
          stylesheet={stylesheet}
          layout={layout}
          style={{ width: '100%', height: '100%' }}
          wheelSensitivity={0.3}
          minZoom={0.15}
          maxZoom={3}
          cy={(cy: cytoscape.Core) => {
            cyRef.current = cy;

            // 点击节点显示详情
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

            // 点击背景取消选中
            cy.on('tap', (evt: cytoscape.EventObject) => {
              if (evt.target === cy) {
                setSelectedNode(null);
              }
            });

            // Hover 高亮邻接节点
            cy.on('mouseover', 'node', (evt: cytoscape.EventObject) => {
              const node = evt.target;
              const neighborhood = node.closedNeighborhood();
              cy.elements().not(neighborhood).style({ opacity: 0.25 });
              neighborhood.style({ opacity: 1 });
            });
            cy.on('mouseout', 'node', () => {
              cy.elements().style({ opacity: undefined });
            });
          }}
        />

        {/* 选中节点详情面板 */}
        {selectedNode && (
          <div className="absolute bottom-3 left-3 right-3 p-3 rounded border border-border bg-card/95 backdrop-blur shadow-lg text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: getNodeColor(selectedNode.type) }} />
              <span className="font-medium text-foreground">{selectedNode.name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(selectedNode.type)}`}>
                {selectedNode.type}
              </span>
              <ImportanceStars value={selectedNode.importance} />
              <button onClick={() => setSelectedNode(null)}
                className="ml-auto text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{selectedNode.summary}</p>
            {/* 关联边 */}
            {(() => {
              const relatedEdges = activeEdges.filter(
                e => e.subject_id === selectedNode.id || e.object_id === selectedNode.id
              );
              if (relatedEdges.length === 0) return null;
              return (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <p className="text-xs font-medium text-foreground mb-1">关联关系</p>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {relatedEdges.map(e => {
                      const isOut = e.subject_id === selectedNode.id;
                      const otherId = isOut ? e.object_id : e.subject_id;
                      const otherNode = nodes.find(n => n.id === otherId);
                      const arrow = isOut ? '→' : '←';
                      return (
                        <div key={e.id} className="text-xs text-muted-foreground flex items-center gap-1">
                          <span className="text-cyan-400">{arrow}</span>
                          <span className="text-yellow-400/80">{e.relation}</span>
                          <span className="text-cyan-400">{arrow}</span>
                          <span style={{ color: otherNode ? getNodeColor(otherNode.type) : undefined }}>
                            {otherNode?.name || otherId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* 右侧图例 */}
      <aside className="w-44 border-l border-border bg-card p-3 shrink-0 overflow-y-auto">
        <h4 className="text-xs font-semibold text-foreground mb-2">节点类型</h4>
        <div className="space-y-1.5">
          {Object.entries(typeCounts).map(([type, count]) => (
            <div key={type} className="flex items-center gap-2 text-xs">
              <span className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: getNodeColor(type) }} />
              <span className="text-foreground">{type}</span>
              <span className="text-muted-foreground ml-auto">{count}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            <p>节点: {nodes.length}</p>
            <p>关系: {activeEdges.length}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Tab: 统计仪表盘 ───────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState<any>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [sRes, eRes] = await Promise.all([
          window.electron.memoryStats(),
          window.electron.memoryEntities({ limit: 500 }),
        ]);
        if (sRes.success) setStats(sRes.stats);
        else setError(sRes.error || '加载统计失败');
        if (eRes.success) setEntities(eRes.entities || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
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

  // 按重要性分布
  const importanceDist: Record<number, number> = {};
  entities.forEach(e => { importanceDist[e.importance] = (importanceDist[e.importance] || 0) + 1; });

  const statCards = stats ? [
    { label: '实体', value: stats.entityCount, icon: <User size={16} />, color: 'text-blue-400' },
    { label: '事实', value: stats.factCount, icon: <FileText size={16} />, color: 'text-yellow-400' },
    { label: '事件', value: stats.eventCount, icon: <Calendar size={16} />, color: 'text-green-400' },
    { label: '关系', value: stats.relationCount, icon: <GitGraph size={16} />, color: 'text-purple-400' },
    { label: '叙事', value: stats.episodeCount, icon: <Brain size={16} />, color: 'text-indigo-400' },
    { label: '数据库', value: formatBytes(stats.dbSizeBytes), icon: <Database size={16} />, color: 'text-orange-400' },
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
          <h4 className="text-sm font-semibold text-foreground mb-3">实体类型分布</h4>
          {totalEntities === 0 ? (
            <p className="text-xs text-muted-foreground">暂无数据</p>
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
          <h4 className="text-sm font-semibold text-foreground mb-3">重要性分布</h4>
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
                      style={{ width: totalEntities > 0 ? `${(count / totalEntities) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
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
        else setError(res.error || '加载失败');
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
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
          <p className="text-sm">暂无操作日志</p>
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
                    {ev.importance >= 4 ? '重要' : '常规'}
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
                  {ev.scene_tag && <span>场景: {ev.scene_tag}</span>}
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

  useEffect(() => {
    (async () => {
      try {
        const res = await window.electron.memoryStatus();
        if (res.success) {
          setMemStatus({ initialized: res.initialized, error: res.error });
        } else {
          setMemStatus({ initialized: false, error: res.error || '状态查询失败' });
        }
      } catch (err) {
        setMemStatus({ initialized: false, error: err instanceof Error ? err.message : '查询异常' });
      }
    })();
  }, []);

  const handleClearAll = async () => {
    if (!confirm('确定要清空所有记忆数据吗？此操作不可恢复。')) return;
    setClearing(true);
    try {
      const res = await window.electron.memoryClearAll();
      if (res.success) {
        alert('记忆数据已清空');
        window.location.reload();
      } else {
        alert(`清空失败: ${res.error}`);
      }
    } catch (err) {
      alert(`清空失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClearing(false);
    }
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'browse', label: '记忆浏览', icon: <Brain size={16} /> },
    { id: 'graph', label: '知识图谱', icon: <GitGraph size={16} /> },
    { id: 'stats', label: '统计仪表盘', icon: <BarChart3 size={16} /> },
    { id: 'log', label: '操作日志', icon: <Clock size={16} /> },
  ];

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* 顶部栏 */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={18} />
          <h1 className="text-base font-semibold">记忆管理</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleClearAll}
            disabled={clearing}
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300 gap-1"
          >
            <Trash2 size={14} />
            {clearing ? '清空中...' : '清空记忆库'}
          </Button>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7" title="关闭">
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* 状态横幅 */}
      {memStatus && !memStatus.initialized && (
        <div className="mx-4 mt-3 p-3 rounded border bg-red-500/10 text-red-400 border-red-500/20 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">记忆系统未初始化</p>
            <p className="text-xs mt-0.5 text-red-400/70">{memStatus.error || '未知原因'}</p>
            <p className="text-xs mt-1 text-red-400/50">
              请查看终端/控制台日志中的 "Failed to initialize MemoryManager" 以获取详细错误信息
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
          {activeTab === 'browse' && <BrowseTab />}
          {activeTab === 'graph' && <GraphTab />}
          {activeTab === 'stats' && <StatsTab />}
          {activeTab === 'log' && <LogTab />}
        </div>
      </div>
    </div>
  );
}
