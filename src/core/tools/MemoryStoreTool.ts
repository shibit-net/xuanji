/**
 * MemoryStoreTool — 记忆存储工具
 *
 * Agent 调用此工具存储持久化记忆（实体、事实、事件、关系）
 * 设计文档：docs/memory-system-part-3-integration.md §4.1, §5.3
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/core/memory/globals';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

export class MemoryStoreTool extends BaseTool {
  readonly name = 'memory_store';
  readonly description = '存储记忆到持久化记忆库。当你确认用户的偏好、完成重要任务、发现用户习惯模式时调用此工具。支持存储实体（人/项目/工具）、事实、事件和关系。';

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['entity', 'fact', 'event', 'relation'],
        description: '记忆类型。entity=实体(人/项目/工具), fact=事实, event=事件, relation=关系',
      },
      data: {
        type: 'object',
        description: '记忆数据，根据 type 不同字段不同：\n'
          + '- entity: { name: "名称", entity_type: "person|vehicle|activity|project|tool|preference|concept", summary: "描述", category?: "分类标签", metadata?: {k:v} }\n'
          + '- fact: { title: "标题", content: "内容" }\n'
          + '- event: { content: "事件描述", entities: ["关联实体名"] }\n'
          + '- relation: { subject_name: "主体", object_name: "客体", relation: "关系类型" }',
        properties: {
          name: { type: 'string', description: '实体名称 (type=entity 时)' },
          entity_type: { type: 'string', description: '实体类型: person|vehicle|activity|project|tool|preference|concept|user (type=entity 时)' },
          summary: { type: 'string', description: '实体描述 (type=entity 时)' },
          category: { type: 'string', description: '层级分类标签，如 "车"、"投资"、"技术" (type=entity 时可选)' },
          metadata: {
            type: 'object',
            description: '结构化属性 (JSON)，如 {"品牌":"奥迪","型号":"A8"} (type=entity 时可选)',
          },
          title: { type: 'string', description: '事实标题 (type=fact 时)' },
          content: { type: 'string', description: '事实/事件内容' },
          entities: {
            type: 'array',
            items: { type: 'string' },
            description: '关联实体名称列表 (type=event 时)',
          },
          subject_name: { type: 'string', description: '主体名称 (type=relation 时)' },
          object_name: { type: 'string', description: '客体名称 (type=relation 时)' },
          relation: { type: 'string', description: '关系类型 (type=relation 时)' },
        },
      },
      scene_tag: {
        type: 'string',
        description: '场景标签，如 "开发"、"工作"、"生活"。默认不分类。',
      },
      importance: {
        type: 'number',
        description: '重要性 1-5。默认 3。5=核心偏好/关键决策，1=临时信息。',
        default: 3,
      },
    },
    required: ['type', 'data'],
  };

  override readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const memoryType = input.type as string;
    const data = input.data as Record<string, any>;
    const sceneTag = input.scene_tag as string | undefined;
    const importance = (input.importance as number) ?? 3;

    const manager = getMemoryManager();
    if (!manager) {
      return this.error('记忆系统未初始化，请稍后再试。');
    }

    // 去重检测：防止短时间内重复存储
    const dedupKey = `${memoryType}:${JSON.stringify(data).slice(0, 100)}`;
    if (manager.wasMemoryStoredRecently(dedupKey)) {
      return this.success('该记忆已在最近 5 分钟内存储过，跳过重复写入。', { dedup: true });
    }

    try {
      switch (memoryType) {
        case 'entity': {
          if (!data.name || !data.entity_type || !data.summary) {
            return this.error('entity 类型需要 name, entity_type, summary 字段');
          }
          const entity = await manager.upsertEntity({
            name: data.name,
            type: data.entity_type,
            summary: data.summary,
            belief: data.belief,
            scene_tag: sceneTag,
            importance,
            category: data.category,
            metadata: data.metadata,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'entity', id: entity.id, scene_tag: sceneTag || '' });
          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_WRITE, { content: `[entity] ${entity.name} (${entity.type}): ${entity.summary}` });
          return this.success(
            `已存储实体: **${entity.name}** (${entity.type})`,
            { id: entity.id, type: 'entity' }
          );
        }

        case 'fact': {
          if (!data.title || !data.content) {
            return this.error('fact 类型需要 title, content 字段');
          }
          const fact = await manager.storeFact({
            title: data.title,
            content: data.content,
            source: data.source ?? 'agent_discovered',
            scene_tag: sceneTag,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'fact', id: fact.id, scene_tag: sceneTag || '' });
          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_WRITE, { content: `[fact] ${fact.title}: ${fact.content}` });
          return this.success(
            `已存储事实: **${fact.title}** (v${fact.version})`,
            { id: fact.id, type: 'fact', version: fact.version }
          );
        }

        case 'event': {
          if (!data.content) {
            return this.error('event 类型需要 content 字段');
          }
          const event = await manager.handleEventFromAgent({
            entityNames: data.entities ?? [],
            content: data.content,
            result: data.result,
            importance,
            scene_tag: sceneTag,
            operator: 'agent',
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'event', id: event.id, scene_tag: sceneTag || '' });
          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_WRITE, { content: `[event] ${event.content}` });
          return this.success(
            `已存储事件: ${event.content.slice(0, 100)}`,
            { id: event.id, type: 'event' }
          );
        }

        case 'relation': {
          if (!data.subject_name || !data.object_name || !data.relation) {
            return this.error('relation 类型需要 subject_name, object_name, relation 字段');
          }
          const relation = await manager.relate({
            subject_name: data.subject_name,
            object_name: data.object_name,
            relation: data.relation,
            strength: data.strength ?? 3,
            scene_tag: sceneTag,
            desc: data.desc,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'relation', id: relation.id, scene_tag: sceneTag || '' });
          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_WRITE, { content: `[relation] ${data.subject_name} → ${data.relation} → ${data.object_name}` });
          return this.success(
            `已存储关系: **${data.subject_name}** → ${data.relation} → **${data.object_name}**`,
            { id: relation.id, type: 'relation' }
          );
        }

        default:
          return this.error(`不支持的记忆类型: ${memoryType}。支持: entity, fact, event, relation`);
      }
    } catch (err) {
      return this.error(`记忆存储失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
