/**
 * ============================================================
 * MemoryGraph — 记忆拓扑图（内存中的有向图）
 * ============================================================
 *
 * 以 SQLite 的 entities + relations 表为基础，
 * 在启动时/变更后构建内存图结构，提供图查询接口。
 *
 * 适应场景：
 * - 路径发现（"张三 → 项目A"的完整路径）
 * - 多跳关联（"跟张三技术栈相同的人"）
 * - 子图提取（"张三相关的所有节点"）
 * - 拓扑推理（"哪些工具被多个项目使用"）
 *
 * 数据来源：
 * - entities 表 → 节点
 * - relations 表 → 有向边
 *
 * 同步策略：
 * - 启动时从 SQLite 全量加载
 * - MemoryManager 写入时增量同步（addNode / addEdge / removeNode / removeEdge）
 * - 不作为持久化存储，重启时从 SQLite 重建
 */

import type { Database } from 'better-sqlite3';

// ─── 类型定义 ─────────────────────────────────────────────

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  scene_tag: string;
  category?: string | null;
  metadata?: string | null;
}

export interface GraphEdge {
  subjectId: string;
  relation: string;
  objectId: string;
  strength: number;
}

export interface PathStep {
  node: GraphNode;
  edge: {
    relation: string;
    direction: 'outgoing' | 'incoming';
    strength: number;
  };
}

export interface PathResult {
  steps: PathStep[];
  hops: number;
  totalStrength: number;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SimilarNodeResult {
  node: GraphNode;
  sharedNeighbors: GraphNode[];
  score: number;
}

export interface AggregationResult {
  node: GraphNode;
  connectedCount: number;
  connectedNodes: GraphNode[];
}

// ─── MemoryGraph ──────────────────────────────────────────

export class MemoryGraph {
  private nodes = new Map<string, GraphNode>();
  /** subjectId → [{relation, objectId, strength}] */
  private outgoing = new Map<string, Array<Omit<GraphEdge, 'subjectId'>>>();
  /** objectId → [{relation, subjectId, strength}] 反向边，用于无向遍历 */
  private incoming = new Map<string, Array<{ relation: string; subjectId: string; strength: number }>>();
  /** type → Set<nodeId> 按类型索引 */
  private byType = new Map<string, Set<string>>();

  private initialized = false;

  /**
   * 从 SQLite 数据库加载全部图数据
   */
  loadFromDB(db: Database): void {
    this.clear();

    const entities = db.prepare('SELECT id, name, type, scene_tag, category, metadata FROM entities').all() as any[];
    for (const e of entities) {
      this.addNode({ id: e.id, name: e.name, type: e.type, scene_tag: e.scene_tag || '', category: e.category ?? null, metadata: e.metadata ?? null });
    }

    const relations = db.prepare(
      'SELECT subject_id, relation, object_id, strength FROM relations WHERE is_active = 1'
    ).all() as any[];
    for (const r of relations) {
      this.addEdge({
        subjectId: r.subject_id,
        relation: r.relation,
        objectId: r.object_id,
        strength: r.strength ?? 3,
      });
    }

    this.initialized = true;
  }

  /**
   * 增量添加节点（当 MemoryManager.storeEntity 时同步调用）
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);

    if (!this.byType.has(node.type)) {
      this.byType.set(node.type, new Set());
    }
    this.byType.get(node.type)!.add(node.id);
  }

  /**
   * 更新节点（替换已有的同名 id 的节点信息）
   */
  updateNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  /**
   * 增量添加边（当 MemoryManager.relate 时同步调用）
   */
  addEdge(edge: GraphEdge): void {
    // 正向
    if (!this.outgoing.has(edge.subjectId)) {
      this.outgoing.set(edge.subjectId, []);
    }
    // 去重：相同的 subject + relation + object 不重复添加
    const existing = this.outgoing.get(edge.subjectId)!;
    const dup = existing.find(e => e.objectId === edge.objectId && e.relation === edge.relation);
    if (dup) {
      dup.strength = edge.strength;
    } else {
      existing.push({
        relation: edge.relation,
        objectId: edge.objectId,
        strength: edge.strength,
      });
    }

    // 反向
    if (!this.incoming.has(edge.objectId)) {
      this.incoming.set(edge.objectId, []);
    }
    const invExisting = this.incoming.get(edge.objectId)!;
    const invDup = invExisting.find(e => e.subjectId === edge.subjectId && e.relation === edge.relation);
    if (invDup) {
      invDup.strength = edge.strength;
    } else {
      invExisting.push({
        relation: edge.relation,
        subjectId: edge.subjectId,
        strength: edge.strength,
      });
    }
  }

  /**
   * 删除节点及所有关联边
   */
  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    this.nodes.delete(nodeId);
    this.byType.get(node.type)?.delete(nodeId);

    this.outgoing.delete(nodeId);
    this.incoming.delete(nodeId);

    // 从其他节点的边中移除
    for (const [, edges] of this.outgoing) {
      const idx = edges.findIndex(e => e.objectId === nodeId);
      if (idx >= 0) edges.splice(idx, 1);
    }
    for (const [, edges] of this.incoming) {
      const idx = edges.findIndex(e => e.subjectId === nodeId);
      if (idx >= 0) edges.splice(idx, 1);
    }
  }

  /**
   * 删除边
   */
  removeEdge(subjectId: string, objectId: string, relation?: string): void {
    const filter = (e: { relation: string; objectId: string }) =>
      e.objectId === objectId && (relation ? e.relation === relation : true);

    const outEdges = this.outgoing.get(subjectId);
    if (outEdges) {
      const idx = outEdges.findIndex(filter);
      if (idx >= 0) outEdges.splice(idx, 1);
    }

    const inEdges = this.incoming.get(objectId);
    if (inEdges) {
      const idx = inEdges.findIndex(e => e.subjectId === subjectId && (relation ? e.relation === relation : true));
      if (idx >= 0) inEdges.splice(idx, 1);
    }
  }

  // ─── 查询接口 ──────────────────────────────────────────

  /**
   * 获取一个节点的所有直接邻居（无向）
   */
  getNeighbors(nodeId: string): Array<{ node: GraphNode; edge: { relation: string; direction: 'outgoing' | 'incoming'; strength: number } }> {
    const result: Array<{ node: GraphNode; edge: { relation: string; direction: 'outgoing' | 'incoming'; strength: number } }> = [];

    const outEdges = this.outgoing.get(nodeId) || [];
    for (const edge of outEdges) {
      const node = this.nodes.get(edge.objectId);
      if (node) {
        result.push({ node, edge: { relation: edge.relation, direction: 'outgoing', strength: edge.strength } });
      }
    }

    const inEdges = this.incoming.get(nodeId) || [];
    for (const edge of inEdges) {
      const node = this.nodes.get(edge.subjectId);
      if (node) {
        result.push({ node, edge: { relation: edge.relation, direction: 'incoming', strength: edge.strength } });
      }
    }

    return result;
  }

  /**
   * BFS 查找两点之间的所有路径（限制最大跳数）
   *
   * 用于回答："张三 和 Docker 是怎么关联起来的？"
   */
  findPaths(fromId: string, toId: string, maxHops: number = 4): PathResult[] {
    if (fromId === toId) return [];

    const results: PathResult[] = [];

    interface BfsStep {
      nodeId: string;
      nodeName: string;
      path: PathStep[];
    }

    const queue: BfsStep[] = [{ nodeId: fromId, nodeName: this.nodes.get(fromId)?.name || '', path: [] }];
    const queuedIds = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.path.length >= maxHops) continue;

      const neighbors = this.getNeighbors(current.nodeId);
      for (const neighbor of neighbors) {
        const step: PathStep = {
          node: neighbor.node,
          edge: neighbor.edge,
        };

        const newPath = [...current.path, step];

        if (neighbor.node.id === toId) {
          const totalStrength = newPath.reduce((sum, s) => sum + s.edge.strength, 0);
          results.push({
            steps: newPath,
            hops: newPath.length,
            totalStrength,
          });
          continue;
        }

        // 防止环路：检查当前路径中是否已访问过该邻居
        if (current.path.some(s => s.node.id === neighbor.node.id)) continue;
        // 防止重复入队（Set 替代 O(N) 线性扫描）
        if (queuedIds.has(neighbor.node.id)) continue;
        queuedIds.add(neighbor.node.id);

        queue.push({
          nodeId: neighbor.node.id,
          nodeName: neighbor.node.name,
          path: newPath,
        });
      }
    }

    results.sort((a, b) => b.totalStrength - a.totalStrength);
    return results;
  }

  /**
   * 子图提取：获取以某节点为中心，K 跳内的所有节点和边
   *
   * 用于："显示张三相关的一切"
   */
  extractSubgraph(centerId: string, maxHops: number = 2, maxNodes: number = 200): SubgraphResult {
    const nodeSet = new Set<string>([centerId]);
    const edgeSet = new Map<string, GraphEdge>();

    interface QueueItem { nodeId: string; depth: number }
    const queue: QueueItem[] = [{ nodeId: centerId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxHops) continue;

      const neighbors = this.getNeighbors(current.nodeId);
      for (const neighbor of neighbors) {
        const edgeKey = neighbor.edge.direction === 'outgoing'
          ? `${current.nodeId}->${neighbor.node.id}`
          : `${neighbor.node.id}->${current.nodeId}`;

        if (!edgeSet.has(edgeKey)) {
          edgeSet.set(edgeKey, {
            subjectId: neighbor.edge.direction === 'outgoing' ? current.nodeId : neighbor.node.id,
            relation: neighbor.edge.relation,
            objectId: neighbor.edge.direction === 'outgoing' ? neighbor.node.id : current.nodeId,
            strength: neighbor.edge.strength,
          });
        }

        if (!nodeSet.has(neighbor.node.id)) {
          nodeSet.add(neighbor.node.id);
          if (nodeSet.size >= maxNodes) break;
          queue.push({ nodeId: neighbor.node.id, depth: current.depth + 1 });
        }
      }
      if (nodeSet.size >= maxNodes) break;
    }

    return {
      nodes: Array.from(nodeSet).map(id => this.nodes.get(id)!).filter(Boolean),
      edges: Array.from(edgeSet.values()),
    };
  }

  /**
   * 基于拓扑的推理：找"同类型且共享相同邻居"的节点
   *
   * 用于："跟张三技术栈类似的人"
   * 逻辑：找 type='user' 的节点，如果有 >= threshold 个共享的 tool 类型邻居，则视为类似
   */
  findSimilarNodes(nodeId: string, options: {
    targetType?: string;
    sharedNeighborTypes?: string[];
    minShared?: number;
  } = {}): SimilarNodeResult[] {
    const targetNode = this.nodes.get(nodeId);
    if (!targetNode) return [];

    const {
      targetType,
      sharedNeighborTypes = ['tool', 'project', 'preference'],
      minShared = 1,
    } = options;

    // 获取目标节点的邻居
    const targetNeighborIds = new Set(
      this.getNeighbors(nodeId)
        .filter(n => sharedNeighborTypes.includes(n.node.type))
        .map(n => n.node.id)
    );

    if (targetNeighborIds.size === 0) return [];

    // 找同类型的其他节点
    const candidates = targetType
      ? Array.from(this.byType.get(targetType) || []).filter(id => id !== nodeId)
      : Array.from(this.nodes.keys()).filter(id => id !== nodeId);

    const results: SimilarNodeResult[] = [];

    for (const candidateId of candidates) {
      const candidateNeighborIds = new Set(
        this.getNeighbors(candidateId)
          .filter(n => sharedNeighborTypes.includes(n.node.type))
          .map(n => n.node.id)
      );

      const shared = Array.from(targetNeighborIds).filter(id => candidateNeighborIds.has(id));
      if (shared.length >= minShared) {
        results.push({
          node: this.nodes.get(candidateId)!,
          sharedNeighbors: shared.map(id => this.nodes.get(id)!).filter(Boolean),
          score: shared.length,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * 拓扑聚合：统计某种类型的节点的聚合关系
   *
   * 用于："哪些工具被最多项目使用？"
   */
  aggregateByRelation(options: {
    subjectType?: string;
    objectType: string;
    relation?: string;
    minCount?: number;
  }): AggregationResult[] {
    const { subjectType, objectType, relation, minCount = 1 } = options;

    const countMap = new Map<string, { node: GraphNode; connected: Set<string> }>();

    for (const [nodeId, node] of this.nodes) {
      if (node.type !== objectType) continue;

      const connected = new Set<string>();
      const outEdges = this.outgoing.get(nodeId) || [];
      for (const edge of outEdges) {
        if (relation && edge.relation !== relation) continue;
        const target = this.nodes.get(edge.objectId);
        if (target && (!subjectType || target.type === subjectType)) {
          connected.add(edge.objectId);
        }
      }
      const inEdges = this.incoming.get(nodeId) || [];
      for (const edge of inEdges) {
        if (relation && edge.relation !== relation) continue;
        const target = this.nodes.get(edge.subjectId);
        if (target && (!subjectType || target.type === subjectType)) {
          connected.add(edge.subjectId);
        }
      }

      if (connected.size >= minCount) {
        countMap.set(nodeId, { node, connected });
      }
    }

    return Array.from(countMap.values())
      .map(({ node, connected }) => ({
        node,
        connectedCount: connected.size,
        connectedNodes: Array.from(connected).map(id => this.nodes.get(id)!).filter(Boolean),
      }))
      .sort((a, b) => b.connectedCount - a.connectedCount);
  }

  /**
   * 按类型获取节点
   */
  getNodesByType(type: string): GraphNode[] {
    const ids = this.byType.get(type);
    if (!ids) return [];
    return Array.from(ids).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * 获取节点
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * 搜索节点（按名称模糊匹配）
   */
  searchNodes(query: string): GraphNode[] {
    const lower = query.toLowerCase();
    return Array.from(this.nodes.values()).filter(
      n => n.name.toLowerCase().includes(lower)
    );
  }

  /**
   * 获取统计信息
   */
  getStats(): { nodeCount: number; edgeCount: number; typeDistribution: Record<string, number> } {
    const typeDistribution: Record<string, number> = {};
    for (const [type, ids] of this.byType) {
      typeDistribution[type] = ids.size;
    }

    let edgeCount = 0;
    for (const edges of this.outgoing.values()) {
      edgeCount += edges.length;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount,
      typeDistribution,
    };
  }

  clear(): void {
    this.nodes.clear();
    this.outgoing.clear();
    this.incoming.clear();
    this.byType.clear();
    this.initialized = false;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}
