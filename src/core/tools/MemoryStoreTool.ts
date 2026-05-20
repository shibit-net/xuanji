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
        enum: ['entity', 'fact', 'event', 'relation', 'time_anchor', 'topic', 'user_profile'],
        description: '记忆类型。entity=实体, fact=事实, event=事件, relation=关系, time_anchor=时间锚点(截止日/日程), topic=话题(目标/计划/兴趣), user_profile=用户画像维度',
      },
      data: {
        type: 'object',
        description: '记忆数据，根据 type 不同字段不同：\n'
          + '- entity: { name, entity_type, summary, category?, metadata? }\n'
          + '- fact: { title, content }\n'
          + '- event: { content, entities: ["实体名"] }\n'
          + '- relation: { subject_name, object_name, relation }\n'
          + '- time_anchor: { anchor_type: "deadline|schedule|periodic|context_expiry", target_type: "entity|fact|event", target_id?: "关联对象ID", trigger_time?: 时间戳ms, cron_expr?: "cron表达式", reason: "原因" }\n'
          + '- topic: { topic: "话题名", topic_type: "goal|plan|interest|decision_pending", context_summary?: "上下文摘要" }\n'
          + '- user_profile: { dimension: "维度名", summary: "摘要", confidence?: 0-1 }',
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
          anchor_type: { type: 'string', description: '锚点类型: deadline|schedule|periodic|context_expiry (type=time_anchor 时)' },
          target_type: { type: 'string', description: '关联目标类型: entity|fact|event (type=time_anchor 时)' },
          trigger_time: { type: 'number', description: '触发时间戳 (type=time_anchor 时)' },
          cron_expr: { type: 'string', description: 'cron 表达式 (type=time_anchor 时可选)' },
          topic: { type: 'string', description: '话题名称 (type=topic 时)' },
          topic_type: { type: 'string', description: '话题类型: goal|plan|interest|decision_pending (type=topic 时)' },
          context_summary: { type: 'string', description: '上下文摘要 (type=topic 时可选)' },
          dimension: { type: 'string', description: '画像维度名，如"技能"、"工具偏好"、"工作风格" (type=user_profile 时)' },
          group_name: { type: 'string', description: '群组名称 (type=group_member 时，用于关联已有 group)' },
          entity_name: { type: 'string', description: '实体名称 (type=group_member 时)' },
          role: { type: 'string', description: '角色/关系 (type=group_member 时可选)' },
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

        case 'time_anchor': {
          if (!data.anchor_type || !data.target_type) {
            return this.error('time_anchor 类型需要 anchor_type, target_type 字段');
          }
          const anchor = manager.addTimeAnchor({
            anchor_type: data.anchor_type,
            target_type: data.target_type,
            target_id: data.target_id ?? '',
            trigger_time: data.trigger_time,
            cron_expr: data.cron_expr,
            reason: data.reason,
            priority: importance,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'time_anchor', id: anchor.id, scene_tag: sceneTag || '' });
          return this.success(
            `已存储时间锚点: **${data.anchor_type}** → ${data.target_type}`,
            { id: anchor.id, type: 'time_anchor' }
          );
        }

        case 'topic': {
          if (!data.topic) {
            return this.error('topic 类型需要 topic 字段');
          }
          const topicResult = manager.upsertTopic({
            topic: data.topic,
            topic_type: data.topic_type ?? 'interest',
            context_summary: data.context_summary,
            priority: importance,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'topic', id: topicResult.id, scene_tag: sceneTag || '' });
          return this.success(
            `已存储话题: **${data.topic}** (${data.topic_type ?? 'interest'})`,
            { id: topicResult.id, type: 'topic' }
          );
        }

        case 'user_profile': {
          if (!data.dimension || !data.summary) {
            return this.error('user_profile 类型需要 dimension, summary 字段');
          }
          const result = manager.upsertUserProfile({
            dimension: data.dimension,
            summary: data.summary,
            confidence: data.confidence,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'user_profile', id: result.id, scene_tag: sceneTag || '' });
          return this.success(
            `已更新用户画像: **${data.dimension}** → ${data.summary.slice(0, 80)}`,
            { id: result.id, type: 'user_profile' }
          );
        }

        default:
          return this.error(`不支持的记忆类型: ${memoryType}。支持: entity, fact, event, relation, time_anchor, topic, user_profile`);
      }
    } catch (err) {
      return this.error(`记忆存储失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
