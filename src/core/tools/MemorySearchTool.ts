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
  readonly description = '搜索持久化记忆库。可以查找实体（人/项目/工具）、事实、事件和叙事记忆。当你需要回忆用户的偏好、过去的决策或项目历史时使用此工具。';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词。支持中文和英文。',
      },
      type: {
        type: 'string',
        enum: ['entity', 'fact', 'event', 'episode', 'all'],
        description: '搜索类型。entity=实体, fact=事实, event=事件, episode=叙事, all=全部。默认 all。',
        default: 'all',
      },
      scene_tag: {
        type: 'string',
        description: '按场景过滤，如 "开发"、"工作"、"生活"。不传则搜索所有场景。',
      },
      limit: {
        type: 'number',
        description: '返回结果数量，默认 10，最大 50。',
        default: 10,
      },
      min_importance: {
        type: 'number',
        description: '最低重要性过滤 (1-5)。默认不限制。',
      },
      scope: {
        type: 'string',
        enum: ['keyword', 'active_context'],
        description: '搜索范围。keyword=按关键词搜索（默认），active_context=搜索用户的最近计划/目标/约束/偏好（不依赖关键词）',
        default: 'keyword',
      },
      include_neighbors: {
        type: 'boolean',
        description: '是否同时返回实体的邻居关系（默认 false，设为 true 可实现双向查询，如搜"车"同时看到每辆车的拥有者）',
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
