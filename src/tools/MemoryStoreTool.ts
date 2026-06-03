/**
 * MemoryStoreTool — 记忆存储工具
 *
 * Agent 调用此工具存储持久化记忆（实体、事实、事件、关系）
 * 设计文档：docs/memory-system-part-3-integration.md §4.1, §5.3
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/memory/globals';
import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';

export class MemoryStoreTool extends BaseTool {
  readonly name = 'memory_store';
  readonly description = [
    'Store, update, or delete memory in the persistent memory database.',
    'Use when you confirm user preferences, complete important tasks, discover user habits, or need to fix/remove incorrect memories.',
    '',
    '=== DELETE / UPDATE ===',
    'To delete an entity:   memory_store({ type: "entity", data: { action: "delete", id: "entity-uuid" } })',
    'To update an entity:   memory_store({ type: "entity", data: { action: "update", id: "entity-uuid", name: "...", summary: "..." } })',
    'To delete a fact:      memory_store({ type: "fact", data: { action: "delete", id: "fact-uuid" } })',
    'To delete a relation:  memory_store({ type: "relation", data: { action: "delete", subject_name: "A", object_name: "B", relation: "动词" } })',
    'To transfer relations: memory_store({ type: "relation", data: { action: "transfer", from_entity: "旧实体名", to_entity: "新实体名" } })',
    '',
    '=== STORE ===',
    'entity: { name, entity_type (project|tool|person|preference|concept|user), summary }',
    'fact: { title (≤25 chars), content, source? }',
    'event: { content, entities: ["related entity names"] }',
    'relation: { subject_name, object_name, relation (verb) }',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['entity', 'fact', 'event', 'relation', 'time_anchor', 'topic', 'user_profile', 'episode'],
        description: 'Memory type. entity=entity, fact=fact, event=event, relation=relation, time_anchor=time anchor (deadline/schedule), topic=topic (goal/plan/interest), user_profile=user profile dimension, episode=reusable narrative memory. Do not store project progress here; use XUANJI.md.',
      },
      data: {
        type: 'object',
          description: 'Memory data. Fields vary by type:\n'
          + '- ALL TYPES: action: "delete"|"update"|"transfer" (for deletion/modification), id: "entity/fact uuid" (for delete/update by ID)\n'
          + '- entity: { name, entity_type, summary, category?, metadata? } or { action:"delete", id:"uuid" } or { action:"update", id:"uuid", name?, summary? }\n'
          + '- fact: { title, content } or { action:"delete", id:"uuid" }\n'
          + '- event: { content, entities: ["entity name"] }\n'
          + '- relation: { subject_name, object_name, relation } or { action:"delete", subject_name, object_name, relation } or { action:"transfer", from_entity:"旧名", to_entity:"新名" }\n'
          + '- time_anchor: { anchor_type: "deadline|schedule|periodic|context_expiry", target_type: "entity|fact|event", target_id?: "target object ID", trigger_time?: timestamp ms, cron_expr?: "cron expression", reason: "reason" }\n'
          + '- topic: { topic: "topic name", topic_type: "goal|plan|interest|decision_pending", context_summary?: "context summary" }\n'
          + '- user_profile: { dimension: "dimension name", summary: "summary", confidence?: 0-1 }\n'
          + '- episode: { title: "reusable narrative title", narrative: "context, process, outcome, and lesson" }',
        properties: {
          action: { type: 'string', enum: ['delete', 'update', 'transfer'], description: 'Maintenance action: delete/update entity or fact, delete/transfer relations. Omit for normal store.' },
          id: { type: 'string', description: 'Entity/fact UUID (for action: delete/update by ID)' },
          name: { type: 'string', description: 'Entity name (for type=entity)' },
          entity_type: { type: 'string', description: 'Entity type: person|vehicle|activity|project|tool|preference|concept|user (for type=entity)' },
          summary: { type: 'string', description: 'Entity description (for type=entity)' },
          category: { type: 'string', description: 'Hierarchical category label, e.g. "car", "investment", "technology" (optional for type=entity)' },
          metadata: {
            type: 'object',
            description: 'Structured attributes (JSON), e.g. {"brand":"Audi","model":"A8"} (optional for type=entity)',
          },
          from_entity: { type: 'string', description: 'Source entity name for transferring all its relations to to_entity (for type=relation with action=transfer)' },
          to_entity: { type: 'string', description: 'Target entity name that receives all relations from from_entity (for type=relation with action=transfer)' },
          title: { type: 'string', description: 'Fact title (for type=fact)' },
          content: { type: 'string', description: 'Fact/event content' },
          entities: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of related entity names (for type=event)',
          },
          subject_name: { type: 'string', description: 'Subject name (for type=relation)' },
          object_name: { type: 'string', description: 'Object name (for type=relation)' },
          relation: { type: 'string', description: 'Relation type (for type=relation)' },
          anchor_type: { type: 'string', description: 'Anchor type: deadline|schedule|periodic|context_expiry (for type=time_anchor)' },
          target_type: { type: 'string', description: 'Target type: entity|fact|event (for type=time_anchor)' },
          trigger_time: { type: 'number', description: 'Trigger timestamp (for type=time_anchor)' },
          cron_expr: { type: 'string', description: 'Cron expression (optional for type=time_anchor)' },
          topic: { type: 'string', description: 'Topic name (for type=topic)' },
          topic_type: { type: 'string', description: 'Topic type: goal|plan|interest|decision_pending (for type=topic)' },
          context_summary: { type: 'string', description: 'Context summary (optional for type=topic)' },
          dimension: { type: 'string', description: 'Profile dimension name, e.g. "skill", "tool preference", "work style" (for type=user_profile)' },
          group_name: { type: 'string', description: 'Group name (for type=group_member, used to associate existing group)' },
          entity_name: { type: 'string', description: 'Entity name (for type=group_member)' },
          role: { type: 'string', description: 'Role/relationship (optional for type=group_member)' },
        },
      },
      scene_tag: {
        type: 'string',
        description: 'Scene tag, e.g. "development", "work", "life". Default uncategorized.',
      },
      importance: {
        type: 'number',
        description: 'Importance 1-5. Default 3. 5=core preference/key decision, 1=transient info.',
        default: 3,
      },
    },
    required: ['type', 'data'],
  };

  override readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const memoryType = input.type as string;
    let rawData = input.data;
    // LLM 经常把 data 序列化成 JSON 字符串，自动解析
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData as string);
      } catch {
        return this.error(`data 字段必须是对象，不能是字符串。收到: ${(rawData as string).slice(0, 200)}。正确格式: memory_store({type:"${memoryType}", data:{...}})，注意 data 是嵌套对象，不要包在引号里。`);
      }
    }
    const data = rawData as Record<string, any>;
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

    const example = (type: string) => {
      const map: Record<string, string> = {
        entity: `memory_store({type:"entity", data:{name:"实体名", entity_type:"project|tool|person|preference|concept", summary:"一句话描述"}})`,
        fact: `memory_store({type:"fact", data:{title:"事实标题(≤25字)", content:"完整内容", source:"agent_discovered"}})`,
        event: `memory_store({type:"event", data:{content:"事件描述", entities:["关联实体名"], progress_pct:50, phase:"当前阶段", blockers:"阻塞项", next_milestone:"下一步"}})`,
        relation: `memory_store({type:"relation", data:{subject_name:"主体名", object_name:"客体名", relation:"关系动词"}})`,
        time_anchor: `memory_store({type:"time_anchor", data:{anchor_type:"deadline|schedule|periodic", target_type:"entity|fact|event", trigger_time:时间戳ms, reason:"原因"}})`,
        topic: `memory_store({type:"topic", data:{topic:"话题名", topic_type:"goal|plan|interest|decision_pending"}})`,
        user_profile: `memory_store({type:"user_profile", data:{dimension:"维度名", summary:"画像描述"}})`,
        episode: `memory_store({type:"episode", data:{title:"叙事标题", narrative:"叙事正文"}})`,
      };
      return map[type] || '';
    };

    try {
      switch (memoryType) {
        case 'entity': {
          // 维护操作：删除实体
          if (data.action === 'delete') {
            if (!data.id) return this.error('删除实体需要提供 id 字段');
            await manager.deleteEntity(data.id);
            manager.recordToolCall('memory_store', undefined, dedupKey);
            return this.success(`已删除实体: ${data.id}`);
          }
          // 维护操作：按 ID 更新实体
          if (data.action === 'update') {
            if (!data.id) return this.error('更新实体需要提供 id 字段');
            await manager.updateEntityById(data.id, {
              name: data.name,
              summary: data.summary,
              importance: data.importance ?? importance,
              metadata: data.metadata,
            });
            manager.recordToolCall('memory_store', undefined, dedupKey);
            return this.success(`已更新实体: ${data.name || data.id}`);
          }
          // 默认：创建/upsert
          if (!data.name || !data.entity_type || !data.summary) {
            const missing = [!data.name && 'name', !data.entity_type && 'entity_type', !data.summary && 'summary'].filter(Boolean).join(', ');
            return this.error(`entity 缺少必填字段: ${missing}。收到: ${JSON.stringify(data)}。正确格式: ${example('entity')}。请修正后重试。`);
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
          // 维护操作：删除 fact
          if (data.action === 'delete') {
            if (!data.id) return this.error('删除 fact 需要提供 id 字段');
            await manager.deleteFact(data.id);
            manager.recordToolCall('memory_store', undefined, dedupKey);
            return this.success(`已删除事实: ${data.id}`);
          }
          if (!data.title || !data.content) {
            const missing = [!data.title && 'title', !data.content && 'content'].filter(Boolean).join(', ');
            return this.error(`fact 缺少必填字段: ${missing}。收到: ${JSON.stringify(data)}。正确格式: ${example('fact')}。请修正后重试。`);
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
            return this.error(`event 缺少必填字段: content。收到: ${JSON.stringify(data)}。正确格式: ${example('event')}。请修正后重试。`);
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
          // 维护操作：删除关系
          if (data.action === 'delete') {
            if (!data.subject_name || !data.object_name || !data.relation) {
              return this.error('删除关系需要提供 subject_name、object_name、relation 字段');
            }
            // 按名称解析实体 ID
            const subj = await manager.findEntityByName(data.subject_name);
            const obj = await manager.findEntityByName(data.object_name);
            if (!subj || !obj) return this.error(`找不到实体: ${!subj ? data.subject_name : data.object_name}`);
            await manager.deactivateRelation(subj.id, obj.id, data.relation, 'agent cleanup');
            manager.recordToolCall('memory_store', undefined, dedupKey);
            return this.success(`已删除关系: ${data.subject_name} → ${data.relation} → ${data.object_name}`);
          }
          // 维护操作：转移关系（将 from_entity 的所有关系迁移到 to_entity，用于实体合并）
          if (data.action === 'transfer') {
            if (!data.from_entity || !data.to_entity) {
              return this.error('转移关系需要提供 from_entity 和 to_entity 字段（实体名称）');
            }
            const from = await manager.findEntityByName(data.from_entity);
            const to = await manager.findEntityByName(data.to_entity);
            if (!from || !to) return this.error(`找不到实体: ${!from ? data.from_entity : data.to_entity}`);
            const transferred = await manager.transferRelations(from.id, to.id);
            manager.recordToolCall('memory_store', undefined, dedupKey);
            return this.success(`已转移 ${transferred} 条关系: ${data.from_entity} → ${data.to_entity}`);
          }
          if (!data.subject_name || !data.object_name || !data.relation) {
            const missing = [!data.subject_name && 'subject_name', !data.object_name && 'object_name', !data.relation && 'relation'].filter(Boolean).join(', ');
            return this.error(`relation 缺少必填字段: ${missing}。收到: ${JSON.stringify(data)}。正确格式: ${example('relation')}。请修正后重试。`);
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
            const missing = [!data.anchor_type && 'anchor_type', !data.target_type && 'target_type'].filter(Boolean).join(', ');
            return this.error(`time_anchor 缺少必填字段: ${missing}。收到: ${JSON.stringify(data)}。正确格式: ${example('time_anchor')}。请修正后重试。`);
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
            return this.error(`topic 缺少必填字段: topic。收到: ${JSON.stringify(data)}。正确格式: ${example('topic')}。请修正后重试。`);
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
            const missing = [!data.dimension && 'dimension', !data.summary && 'summary'].filter(Boolean).join(', ');
            return this.error(`user_profile 缺少必填字段: ${missing}。收到: ${JSON.stringify(data)}。正确格式: ${example('user_profile')}。请修正后重试。`);
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

        case 'episode': {
          if (!data.title || !data.narrative) {
            const missing = [!data.title && 'title', !data.narrative && 'narrative'].filter(Boolean).join(', ');
            return this.error(`episode 缺少必填字段: ${missing}。收到: ${JSON.stringify(data)}。正确格式: memory_store({type:"episode", data:{title:"叙事标题", narrative:"叙事正文"}})。请修正后重试。`);
          }
          const episode = await manager.storeEpisode({
            title: data.title,
            narrative: data.narrative,
          });
          manager.recordToolCall('memory_store', undefined, dedupKey);
          eventBus.emitSync(XuanjiEvent.MEMORY_STORED, { type: 'episode', id: episode.id, scene_tag: sceneTag || '' });
          eventBus.emitSync(XuanjiEvent.HOOK_MEMORY_WRITE, { content: `[episode] ${data.title}` });
          return this.success(
            `已存储叙事记忆: **${data.title}**`,
            { id: episode.id, type: 'episode' }
          );
        }

        default:
          return this.error(`不支持的记忆类型 "${memoryType}"。支持: entity, fact, event, relation, time_anchor, topic, user_profile, episode。项目进度不要写入 Memory，应写入 XUANJI.md。请修正 type 后重试。`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`记忆存储异常: ${msg}。请检查 data 字段格式是否符合 schema 要求，修正后重试。`);
    }
  }
}
