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
      };
      return map[type] || '';
    };

    try {
      switch (memoryType) {
        case 'entity': {
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

        default:
          return this.error(`不支持的记忆类型 "${memoryType}"。支持: entity, fact, event, relation, time_anchor, topic, user_profile。请修正 type 后重试。`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`记忆存储异常: ${msg}。请检查 data 字段格式是否符合 schema 要求，修正后重试。`);
    }
  }
}
