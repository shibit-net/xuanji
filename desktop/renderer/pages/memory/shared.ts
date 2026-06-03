import { t } from '@/core/i18n';

// ─── Types ────────────────────────────────────────────────

export type MemoryKind = 'entity' | 'fact' | 'event' | 'episode' | 'search';
export type ObjectFilter = 'all' | 'entity' | 'fact' | 'event' | 'episode';
export type ImportanceFilter = 'all' | '4' | '3';

export interface NormalizedMemoryItem {
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

// ─── Color maps ──────────────────────────────────────────

export const TYPE_COLORS: Record<string, string> = {
  user: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  feedback: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  project: 'bg-green-500/15 text-green-400 border-green-500/25',
  reference: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  tool: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  concept: 'bg-pink-500/15 text-pink-400 border-pink-500/25',
  preference: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  person: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
};

export const TYPE_HEX_COLORS: Record<string, string> = {
  user: '#3b82f6',
  feedback: '#a855f7',
  project: '#22c55e',
  reference: '#f97316',
  tool: '#06b6d4',
  concept: '#ec4899',
  preference: '#eab308',
  person: '#6366f1',
};

export const TYPE_BORDER_COLORS: Record<string, string> = {
  user: 'border-l-blue-500/60',
  feedback: 'border-l-purple-500/60',
  project: 'border-l-green-500/60',
  reference: 'border-l-orange-500/60',
  tool: 'border-l-cyan-500/60',
  concept: 'border-l-pink-500/60',
  preference: 'border-l-yellow-500/60',
  person: 'border-l-indigo-500/60',
};

export const ENTITY_TYPE_LABEL_KEYS: Record<string, string> = {
  user: 'memory.entity_type.user',
  person: 'memory.entity_type.person',
  preference: 'memory.entity_type.preference',
  feedback: 'memory.entity_type.feedback',
  project: 'memory.entity_type.project',
  tool: 'memory.entity_type.tool',
  concept: 'memory.entity_type.concept',
  reference: 'memory.entity_type.reference',
};

// Cytoscape graph colors
export const GRAPH_COLORS: Record<string, string> = {
  user: '#3b82f6',
  feedback: '#a855f7',
  project: '#22c55e',
  reference: '#f97316',
  tool: '#06b6d4',
  concept: '#ec4899',
  preference: '#eab308',
  person: '#6366f1',
  fact: '#9ca3af',
  event: '#f59e0b',
  episode: '#10b981',
};

export const GRAPH_COLORS_LIGHT: Record<string, string> = {
  user: '#93c5fd',
  feedback: '#d8b4fe',
  project: '#86efac',
  reference: '#fdba74',
  tool: '#67e8f9',
  concept: '#f9a8d4',
  preference: '#fde047',
  person: '#a5b4fc',
  fact: '#d1d5db',
  event: '#fcd34d',
  episode: '#6ee7b7',
};

export const TYPE_SYMBOLS: Record<string, string> = {
  entity: '🟦', fact: '📌', event: '⚡', episode: '📖',
  user: '👤', person: '🧑', preference: '⭐', feedback: '💬',
  project: '📁', tool: '🔧', concept: '💡', reference: '🔗',
};

// ─── Utility functions ───────────────────────────────────

export function getNodeColor(type: string): string {
  return TYPE_HEX_COLORS[type] || '#6b7280';
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || 'bg-gray-500/15 text-gray-400 border-gray-500/25';
}

export function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function graphNodeColor(type: string): string {
  return GRAPH_COLORS[type] || '#6b7280';
}

export function graphNodeColorLight(type: string): string {
  return GRAPH_COLORS_LIGHT[type] || '#9ca3af';
}

export function typeSymbol(type: string): string {
  return TYPE_SYMBOLS[type] || '📄';
}

export function latestTime(items: NormalizedMemoryItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.time || 0), 0);
}

// ─── Normalizers ─────────────────────────────────────────

export function normalizeEntity(e: any): NormalizedMemoryItem {
  return {
    kind: 'entity', id: e.id, title: e.name || '—',
    content: e.summary || e.belief || '', typeLabel: e.type || 'entity',
    sceneTag: e.scene_tag, importance: e.importance,
    time: e.updated_at || e.created_at, raw: { ...e, _type: 'entity' },
  };
}

export function normalizeFact(f: any): NormalizedMemoryItem {
  return {
    kind: 'fact', id: f.id, title: f.title || 'Fact',
    content: f.content || '', typeLabel: 'fact',
    sceneTag: f.scene_tag, time: f.created_at, source: f.source,
    raw: { ...f, _type: 'fact' },
  };
}

export function normalizeEvent(ev: any): NormalizedMemoryItem {
  return {
    kind: 'event', id: ev.id, title: ev.content || 'Event',
    content: ev.result || '', typeLabel: 'event',
    sceneTag: ev.scene_tag, importance: ev.importance,
    time: ev.time || ev.created_at, source: ev.operator,
    raw: { ...ev, _type: 'event' },
  };
}

export function normalizeEpisode(ep: any): NormalizedMemoryItem {
  return {
    kind: 'episode', id: ep.id, title: ep.title || 'Episode',
    content: ep.narrative || '', typeLabel: 'episode',
    sceneTag: ep.scene_tag, importance: ep.importance,
    time: ep.timestamp, raw: { ...ep, _type: 'episode' },
  };
}

export function normalizeSearchResult(r: any): NormalizedMemoryItem {
  return {
    kind: 'search', id: `${r.source_table}-${r.source_id}`,
    title: r.title || r.source_id || 'Result',
    content: r.content || '', typeLabel: r.source_table || 'search',
    sceneTag: r.scene_tag,
    source: r.score !== undefined ? `${(r.score * 100).toFixed(0)}%` : undefined,
    raw: { ...r, _type: 'search' },
  };
}
