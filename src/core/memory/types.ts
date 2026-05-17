/**
 * 记忆系统类型定义
 *
 * 设计文档：docs/memory-system-part-1-storage.md §4（数据模型详解）
 */

// ─── 实体 (Entity) ──────────────────────────────────────────

export interface Entity {
  id: string;
  name: string;
  type: string;
  summary: string;
  belief: string | null;
  scene_tag: string;
  owner: string;
  importance: number;
  ref_count: number;
  created_at: number;
  updated_at: number;
  category: string | null;
  metadata: string | null;
}

export interface EntityInput {
  name: string;
  type: string;
  summary: string;
  belief?: string;
  scene_tag?: string;
  importance?: number;
  owner?: string;
  category?: string;
  metadata?: string | Record<string, unknown>;
}

export interface EntityFilter {
  type?: string | string[];
  scene?: string;
  keyword?: string;
  limit?: number;
}

// ─── 关系 (Relation) ───────────────────────────────────────

export interface Relation {
  id: string;
  subject_id: string;
  object_id: string;
  relation: string;
  desc: string | null;
  strength: number;
  is_active: number;
  scene_tag: string;
  created_at: number;
  updated_at: number;
}

export interface RelationInput {
  subject_name: string;
  object_name: string;
  relation: string;
  strength?: number;
  scene_tag?: string;
  desc?: string;
}

export interface RelationInputById extends RelationInput {
  subject_id?: string;
  object_id?: string;
}

export interface RelationQuery {
  direction?: 'outgoing' | 'incoming' | 'both';
  relation?: string;
  activeOnly?: boolean;
}

// ─── 关系变更 (RelationChange) ─────────────────────────────

export interface RelationChange {
  id: string;
  subject_id: string;
  relation: string;
  old_value: string | null;
  new_value: string;
  reason: string | null;
  scene_tag: string;
  changed_at: number;
  operator: string | null;
}

// ─── 事件 (Event) ──────────────────────────────────────────

export interface Event {
  id: string;
  time: number;
  entity_ids: string;
  content: string;
  result: string | null;
  importance: number;
  scene_tag: string;
  operator: string | null;
  created_at: number;
  reminded_at: number | null;
  version: number;
  is_latest: number;
  previous_id: string | null;
}

export interface EventInput {
  entityNames: string[];
  content: string;
  result?: string;
  importance?: number;
  scene_tag?: string;
  operator?: string;
  time?: number;
}

export interface TimelineFilter {
  entityNames?: string[];
  scene?: string;
  from?: number;
  to?: number;
  limit?: number;
}

// ─── 事实 (Fact) ───────────────────────────────────────────

export type FactSource =
  | 'user_said'
  | 'agent_discovered'
  | 'rag_import'
  | 'sub_agent'
  | 'agent_team'
  | 'manual'
  | 'user_correction';

export interface Fact {
  id: string;
  title: string;
  content: string;
  source: FactSource;
  source_detail: string | null;
  conflict_tag: number;
  version: number;
  is_latest: number;
  scene_tag: string;
  related_entity_ids: string | null;
  creator: string | null;
  importance: number;
  access_count: number;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface FactInput {
  title: string;
  content: string;
  source?: FactSource;
  scene_tag?: string;
  relatedEntityNames?: string[];
  source_detail?: string;
  creator?: string;
}

export interface FactFilter {
  keyword?: string;
  scene?: string;
  isLatest?: boolean;
  limit?: number;
  name?: string;
  type?: string;
  tags?: string[];
}

// ─── 项目快照 (ProjectSnapshot) ────────────────────────────

export interface ProjectSnapshot {
  id: string;
  project_id: string;
  phase: string;
  status: string;
  progress_pct: number;
  current_focus: string | null;
  blockers: string | null;
  next_milestone: string | null;
  tech_stack: string | null;
  snapshot_at: number;
}

// ─── 叙事记忆 (Episode) ────────────────────────────────────

export interface Episode {
  id: string;
  timestamp: number;
  title: string;
  narrative: string;
  scene_tag: string;
  importance: number;
  created_at: number;
  updated_at: number;
}

export interface EpisodeEntity {
  episode_id: string;
  entity_id: string;
}

// ─── 搜索 ──────────────────────────────────────────────────

export interface MemorySearchOptions {
  query: string;
  source?: 'entity' | 'fact' | 'event' | 'episode' | 'all';
  scope?: 'keyword' | 'active_context';
  scene_tag?: string;
  limit?: number;
  minImportance?: number;
}

export interface MemorySearchResult {
  source_table: string;
  source_id: string;
  title: string;
  content: string;
  scene_tag: string;
  score?: number;
}

// ─── 图查询结果 ────────────────────────────────────────────

export interface GraphNeighbor {
  entity: Entity;
  relation: string;
  direction: 'outgoing' | 'incoming';
  strength: number;
}

export interface GraphPath {
  steps: Array<{
    entity: Entity;
    relation: string;
    direction: 'outgoing' | 'incoming';
    strength: number;
  }>;
  hops: number;
  totalStrength: number;
}

/** 带图上下文的搜索结果 — 双向查询时使用 */
export interface MemorySearchResultWithGraph extends MemorySearchResult {
  neighbors?: GraphNeighbor[];
  parsedMetadata?: Record<string, unknown> | null;
  category?: string | null;
}

// ─── 统计 ──────────────────────────────────────────────────

export interface MemoryStats {
  entityCount: number;
  factCount: number;
  eventCount: number;
  relationCount: number;
  episodeCount: number;
  ftsEntryCount: number;
  dbSizeBytes: number;
}

export interface MemorySnapshot {
  stats: MemoryStats;

  /** 最近创建的实体样本 */
  recentEntities: Array<{ id: string; name: string; type: string; category?: string; summary: string; importance: number; updatedAt: number }>;

  /** 最近的事实样本 */
  recentFacts: Array<{ id: string; title: string; content: string; source: string; importance: number; updatedAt: number }>;

  /** 活跃关系样本 */
  activeRelations: Array<{ subjectName: string; relation: string; objectName: string; strength: number }>;

  /** 最近事件样本 */
  recentEvents: Array<{ id: string; content: string; time: number; entityIds: string }>;

  /** 孤立实体（无关系、无事件引用） */
  orphanEntities: Array<{ id: string; name: string; type: string; summary: string }>;

  /** 高频共现实体对（同一事件中出现 2 次以上的组合） */
  cooccurrencePairs: Array<{ entityA: string; entityB: string; count: number }>;
}

// ─── Prompt 上下文构建 ──────────────────────────────────────

export interface BuildContextOptions {
  scene?: string;
  maxTokens?: number;
  recentHours?: number;
}

// ─── 子 Agent 结果 ─────────────────────────────────────────

export interface SubAgentResult {
  sessionId: string;
  agentId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  duration: number;
  timestamp: number;
  error?: string;
  scene?: string;
  summary?: string;
  full_output?: string;
  key_entities?: string[];
  token_count?: { input: number; output: number };
  expires_at?: number;
}

// ─── 记忆事件 Payload ──────────────────────────────────────

export interface MemoryStoredPayload {
  type: 'entity' | 'fact' | 'event' | 'relation';
  id: string;
  scene_tag: string;
}

export interface MemoryExtractedPayload {
  sessionId: string;
  entityCount: number;
  factCount: number;
  eventCount: number;
}
