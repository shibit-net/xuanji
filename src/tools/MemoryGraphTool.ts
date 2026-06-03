/**
 * MemoryGraphTool — 记忆图查询工具
 *
 * Agent 调用此工具查询记忆知识图谱：
 * - get_neighbors: 查询实体的直接邻居（含关系方向）
 * - find_paths: 查找两个实体之间的关联路径
 * - get_subgraph: 获取以某实体为中心的 K 跳子图
 * - search_nodes: 按名称模糊搜索图中的节点
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/memory/globals';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

export class MemoryGraphTool extends BaseTool {
  readonly name = 'memory_graph';
  readonly description = `Query entity relationships in the memory knowledge graph. Supports the following operations:

- **get_neighbors**: Retrieve all direct neighbors and relationships of an entity. For example, "what cars do my friends have" — first query the friend's neighbors, check their "owns" relationships.
- **find_paths**: Find how two entities are connected. For example, "what is the relationship between Wang Hanyang and Audi A8".
- **get_subgraph**: Get the relationship network centered around an entity. For example, "all related information about the e-commerce project".
- **search_nodes**: Search for entities in the graph by name. For example, "search all vehicle-related entities".

Difference from memory_search:
- memory_search: Full-text search of memory content (semantic+FTS5), suitable for "what do I remember"
- memory_graph: Graph structure query for relationships, suitable for "who is related to who", "what does this person have"`;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['get_neighbors', 'find_paths', 'get_subgraph', 'search_nodes'],
        description: 'Graph query operation type',
      },
      entity_name: {
        type: 'string',
        description: 'Entity name (used for get_neighbors / get_subgraph / search_nodes)',
      },
      from_name: {
        type: 'string',
        description: 'Starting entity name (used for find_paths)',
      },
      to_name: {
        type: 'string',
        description: 'Target entity name (used for find_paths)',
      },
      max_hops: {
        type: 'number',
        description: 'Max hops. Default 2 for get_subgraph, default 4 for find_paths.',
        default: 2,
      },
      relation_filter: {
        type: 'string',
        description: 'Optional: filter neighbors by relation type (e.g., only check "owns" relationships). Used for get_neighbors.',
      },
    },
    required: ['operation'],
  };

  override readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const manager = getMemoryManager();
    if (!manager) {
      return this.error('记忆系统未初始化，请稍后再试。');
    }

    const operation = input.operation as string;
    const maxHops = (input.max_hops as number) ?? (
      operation === 'find_paths' ? 4 : 2
    );

    try {
      switch (operation) {
        case 'get_neighbors': {
          const entityName = input.entity_name as string;
          if (!entityName) return this.error('get_neighbors 需要 entity_name 参数');

          const neighbors = await manager.getEntityNeighbors(entityName);
          if (neighbors.length === 0) {
            return this.success(`实体 "${entityName}" 暂无邻居关系。`);
          }

          const relationFilter = input.relation_filter as string | undefined;
          const filtered = relationFilter
            ? neighbors.filter(n => n.relation === relationFilter)
            : neighbors;

          const outgoing = filtered.filter(n => n.direction === 'outgoing');
          const incoming = filtered.filter(n => n.direction === 'incoming');

          const lines: string[] = [];
          if (outgoing.length > 0) {
            lines.push(`**${entityName}** 的传出关系：`);
            for (const n of outgoing) {
              const catStr = n.entity.category ? ` [分类: ${n.entity.category}]` : '';
              lines.push(`  → ${n.relation} → **${n.entity.name}** (${n.entity.type})${catStr} (强度: ${n.strength})`);
            }
          }
          if (incoming.length > 0) {
            if (outgoing.length > 0) lines.push('');
            lines.push(`**${entityName}** 的传入关系：`);
            for (const n of incoming) {
              const catStr = n.entity.category ? ` [分类: ${n.entity.category}]` : '';
              lines.push(`  ← ${n.relation} ← **${n.entity.name}** (${n.entity.type})${catStr} (强度: ${n.strength})`);
            }
          }

          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query: `graph:get_neighbors:${entityName}`, results: neighbors });
          return this.success(lines.join('\n'), {
            count: filtered.length,
            entity_name: entityName,
            relation_filter: relationFilter ?? null,
          });
        }

        case 'find_paths': {
          const fromName = input.from_name as string;
          const toName = input.to_name as string;
          if (!fromName || !toName) return this.error('find_paths 需要 from_name 和 to_name 参数');

          const paths = await manager.getEntityPaths(fromName, toName, maxHops);
          if (paths.length === 0) {
            return this.success(`未找到 "${fromName}" 到 "${toName}" 的路径 (max ${maxHops} hops)。`);
          }

          const lines = paths.slice(0, 5).map((p, i) => {
            const stepDescs = p.steps.map(s => {
              const arrow = s.direction === 'outgoing' ? '→' : '←';
              return `${arrow} ${s.relation} ${arrow} **${s.entity.name}**`;
            });
            return `路径 ${i + 1} (${p.hops} 跳, 总强度: ${p.totalStrength}):\n  ${stepDescs.join('\n  ')}`;
          });

          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query: `graph:find_paths:${fromName}-${toName}`, results: paths });
          return this.success(lines.join('\n\n'), {
            path_count: paths.length,
            from: fromName,
            to: toName,
            max_hops: maxHops,
          });
        }

        case 'get_subgraph': {
          const entityName = input.entity_name as string;
          if (!entityName) return this.error('get_subgraph 需要 entity_name 参数');

          const subgraph = manager.getEntitySubgraph(entityName, maxHops);
          if (subgraph.nodes.length === 0) {
            return this.success(`未找到实体 "${entityName}"。`);
          }

          const lines: string[] = [
            `**${entityName}** 的子图 (${maxHops} 跳内):`,
            `\n节点 (${subgraph.nodes.length} 个):`,
          ];
          for (const node of subgraph.nodes) {
            const entity = manager.getEntity(node.id);
            const catStr = entity?.category ? ` [分类: ${entity.category}]` : '';
            lines.push(`  - **${node.name}** (${node.type})${catStr}`);
          }

          lines.push(`\n边 (${subgraph.edges.length} 条):`);
          for (const edge of subgraph.edges) {
            const subj = manager.getEntity(edge.subjectId);
            const obj = manager.getEntity(edge.objectId);
            const subjName = subj?.name || edge.subjectId;
            const objName = obj?.name || edge.objectId;
            lines.push(`  - **${subjName}** → ${edge.relation} → **${objName}**`);
          }

          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query: `graph:get_subgraph:${entityName}`, results: subgraph });
          return this.success(lines.join('\n'), {
            node_count: subgraph.nodes.length,
            edge_count: subgraph.edges.length,
            center: entityName,
            max_hops: maxHops,
          });
        }

        case 'search_nodes': {
          const query = input.entity_name as string;
          if (!query) return this.error('search_nodes 需要 entity_name 参数');

          const nodes = manager.searchGraphNodes(query);
          if (nodes.length === 0) {
            return this.success(`未找到名称包含 "${query}" 的图节点。`);
          }

          const lines = nodes.slice(0, 20).map(n => {
            const entity = manager.getEntity(n.id);
            const catStr = entity?.category ? ` [分类: ${entity.category}]` : '';
            const metaStr = entity?.metadata ? ` | ${entity.metadata}` : '';
            return `  - **${n.name}** (${n.type})${catStr}${metaStr}`;
          });

          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query: `graph:search_nodes:${query}`, results: nodes });
          return this.success(`图节点搜索结果 (${nodes.length} 个):\n${lines.join('\n')}`, {
            count: nodes.length,
            query,
          });
        }

        default:
          return this.error(`不支持的操作: ${operation}。支持: get_neighbors, find_paths, get_subgraph, search_nodes`);
      }
    } catch (err) {
      return this.error(`图查询失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
