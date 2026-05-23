/**
 * MemorySearchTool — 记忆搜索工具
 *
 * Agent 调用此工具搜索持久化记忆（实体、事实、事件、叙事）
 * 设计文档：docs/memory-system-part-3-integration.md §4.2
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/core/memory/globals';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

export class MemorySearchTool extends BaseTool {
  readonly name = 'memory_search';
  readonly description = 'Search the persistent memory database. Can look up entities (people/projects/tools), facts, events, and episodic memories. Use this tool when you need to recall user preferences, past decisions, or project history.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keyword. Supports Chinese and English.',
      },
      type: {
        type: 'string',
        enum: ['entity', 'fact', 'event', 'episode', 'all'],
        description: 'Search type. entity=entity, fact=fact, event=event, episode=episode, all=all. Default all.',
        default: 'all',
      },
      scene_tag: {
        type: 'string',
        description: 'Filter by scene tag, e.g. "development", "work", "life". Leave empty to search all scenes.',
      },
      limit: {
        type: 'number',
        description: 'Number of results to return, default 10, max 50.',
        default: 10,
      },
      min_importance: {
        type: 'number',
        description: 'Minimum importance filter (1-5). No limit by default.',
      },
      scope: {
        type: 'string',
        enum: ['keyword', 'active_context'],
        description: 'Search scope. keyword=search by keyword (default), active_context=search user recent plans/goals/constraints/preferences (no keyword needed)',
        default: 'keyword',
      },
      include_neighbors: {
        type: 'boolean',
        description: 'Whether to also return entity neighbor relationships (default false, set to true for bidirectional queries, e.g. search "car" and see each car\'s owner at the same time)',
        default: false,
      },
    },
    required: ['query'],
  };

  override readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const type = (input.type as string) ?? 'all';
    const sceneTag = input.scene_tag as string | undefined;
    const limit = Math.min((input.limit as number) ?? 10, 50);
    const minImportance = input.min_importance as number | undefined;

    // 将用户可见的类型名映射到 FTS5 source_table 实际表名
    const tableMap: Record<string, string> = {
      entity: 'entities',
      fact: 'facts',
      event: 'events',
      episode: 'episodes',
    };
    const sourceTable = tableMap[type] ?? type;

    const manager = getMemoryManager();
    if (!manager) {
      return this.error('记忆系统未初始化，请稍后再试。');
    }

    const includeNeighbors = input.include_neighbors === true;
    const scope = (input.scope as string) ?? 'keyword';

    try {
      // 活跃上下文模式：不依赖关键词，直接查用户的最近计划/目标/约束
      if (scope === 'active_context') {
        const results = await manager.search({
          query: '',
          source: 'all',
          scope: 'active_context',
          scene_tag: sceneTag,
          limit,
          minImportance,
        });

        if (results.length === 0) {
          eventBus.emitSync(XuanjiEvent.MEMORY_SEARCHED, { query: 'active_context', type, resultCount: 0 });
          return this.success('未找到活跃上下文。');
        }

        const sourceLabels: Record<string, string> = {
          entities: '实体', facts: '事实', events: '事件', episodes: '叙事'
        };
        const lines = results.map((r: any) => {
          const sourceLabel = sourceLabels[r.source_table] || r.source_table;
          let line = `[${sourceLabel}] **${r.title}**: ${r.content}`;
          if (r.scene_tag) line += ` (场景: ${r.scene_tag})`;
          return line;
        });

        eventBus.emitSync(XuanjiEvent.MEMORY_SEARCHED, { query: 'active_context', type, resultCount: results.length });
        return this.success(lines.join('\n\n'), { count: results.length, scope: 'active_context' });
      }

      // 图感知搜索：附带邻居关系上下文
      if (includeNeighbors && (type === 'entity' || type === 'all')) {
        const enriched = await manager.searchEntitiesWithGraph(query, {
          limit,
          scene_tag: sceneTag,
          minImportance,
        });

        if (enriched.length === 0) {
          eventBus.emitSync(XuanjiEvent.MEMORY_SEARCHED, { query, type, resultCount: 0 });
          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query, results: [] });
          return this.success('未找到相关记忆。');
        }

        const lines = enriched.map((r: any) => {
          let line = `[实体] **${r.title}**: ${r.content}`;
          if (r.scene_tag) line += ` (场景: ${r.scene_tag})`;
          if (r.category) line += ` [分类: ${r.category}]`;
          if (r.parsedMetadata && Object.keys(r.parsedMetadata).length > 0) {
            line += ` | 属性: ${JSON.stringify(r.parsedMetadata)}`;
          }
          if (r.neighbors && r.neighbors.length > 0) {
            const neighborStr = r.neighbors.map((n: any) =>
              n.direction === 'outgoing'
                ? `→${n.relation}→${n.entity.name}`
                : `←${n.relation}←${n.entity.name}`
            ).join(', ');
            line += `\n  关联: ${neighborStr}`;
          }
          return line;
        });

        eventBus.emitSync(XuanjiEvent.MEMORY_SEARCHED, { query, type, resultCount: enriched.length });
        return this.success(lines.join('\n\n'), {
          count: enriched.length,
          query,
          type,
          include_neighbors: true,
        });
      }

      // 标准搜索（无图上下文）
      const results = await manager.search({
        query,
        source: sourceTable as any,
        scene_tag: sceneTag,
        limit,
        minImportance,
      });

      if (results.length === 0) {
        eventBus.emitSync(XuanjiEvent.MEMORY_SEARCHED, { query, type, resultCount: 0 });
        eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query, results: [] });
        return this.success('未找到相关记忆。');
      }

      const sourceLabels: Record<string, string> = {
        entities: '实体', facts: '事实', events: '事件', episodes: '叙事'
      };
      const lines = results.map((r: any) => {
        const sourceLabel = sourceLabels[r.source_table] || r.source_table;
        return `[${sourceLabel}] **${r.title}**: ${r.content}${r.scene_tag ? ` (场景: ${r.scene_tag})` : ''}`;
      });

      eventBus.emitSync(XuanjiEvent.MEMORY_SEARCHED, { query, type, resultCount: results.length });
      eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_READ, { query, results: results.map((r: any) => ({ source_table: r.source_table, title: r.title, content: r.content })) });

      return this.success(lines.join('\n\n'), {
        count: results.length,
        query,
        type,
      });
    } catch (err) {
      return this.error(`记忆搜索失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
