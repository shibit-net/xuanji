# Xuanji 记忆系统 · 系统集成与实现

> 前一篇：[检索、图谱与注入](./memory-system-part-2-retrieval.md)

---

## 目录

1. [MemoryManager 类完整定义](#1-memorymanager-类完整定义)
2. [实时触发机制](#2-实时触发机制)
   - 2.6 [层级 2：会话结束提取](#26-层级-2会话结束提取)
3. [自动推论引擎](#3-自动推论引擎)
4. [定时维护](#4-定时维护)
5. [Agent 工具定义](#5-agent-工具定义)
6. [与现有系统的集成](#6-与现有系统的集成)
7. [EventBus 事件](#7-eventbus-事件)
8. [实现顺序建议](#8-实现顺序建议)
9. [生产配置参考](#9-生产配置参考)

---

## 1. MemoryManager 类完整定义

### 1.1 类结构

```typescript
// src/core/memory/MemoryManager.ts

export class MemoryManager {
  private db: Database;
  private graph: MemoryGraph;
class MemoryManager {
  /**
   * 最终统一构造函数
   *
   * @param dbPath SQLite 数据库路径
   * @param cheapLLM 可选，轻量 LLM provider（用于自动提取），推荐 deepseek-chat
   * @param hookRegistry 可选，HookRegistry 实例（用于 PostToolUse 兜底）
   * @param subAgentStore 可选，子 Agent 结果存档
   * @param episodicMemory 可选，叙事记忆
   * @param semanticIndex 可选，语义搜索索引
   * @param skillRegistry 可选，Skill 注册表（learn 工具注册 skill）
   * @param toolRegistry 可选，Tool 注册表（learn 工具注册 MCP 暴露的 tool）
   * @param mcpManager 可选，MCP 管理器（learn 安装 MCP server）
   * @param searchService 可选，外部搜索服务（install 用）
   */
  constructor(
    private dbPath: string,
    private cheapLLM?: ILLMProvider,
    private hookRegistry?: HookRegistry,
    private subAgentStore?: SubAgentResultStore,
    private episodicMemory?: EpisodicMemory,
    private semanticIndex?: SemanticIndex,
    private skillRegistry?: SkillRegistry,
    private toolRegistry?: IToolRegistry,
    private mcpManager?: MCPManager,
    private searchService?: PluginSearchService,
  ) {}

  // ─── 生命周期 ───────────────────────────────────────
  async init(): Promise<void>;
  async close(): Promise<void>;
  reset(): void;

  // ─── Entity CRUD ─────────────────────────────────────
  async upsertEntity(input: EntityInput): Promise<Entity>;
  async getEntity(id: string): Promise<Entity | null>;
  async searchEntities(filter: EntityFilter): Promise<Entity[]>;
  async deleteEntity(id: string): Promise<void>;

  // ─── Relation CRUD ───────────────────────────────────
  async relate(input: RelationInput): Promise<Relation>;
  async deactivateRelation(subjectId: string, objectId: string, relation: string, reason?: string): Promise<void>;
  async getRelations(entityId: string, options?: RelationQuery): Promise<Relation[]>;

  // ─── Event CRUD ──────────────────────────────────────
  async recordEvent(input: EventInput): Promise<Event>;
  async getTimeline(filter: TimelineFilter): Promise<Event[]>;

  // ─── Fact CRUD ───────────────────────────────────────
  async storeFact(input: FactInput): Promise<Fact>;
  async updateFact(title: string, input: Partial<FactInput>): Promise<Fact>;
  async rollbackFact(title: string, version: number): Promise<Fact>;
  async searchFacts(filter: FactFilter): Promise<Fact[]>;

  // ─── 全文搜索 + 语义搜索 ────────────────────────────
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  // ─── 图查询（委托给 MemoryGraph） ─────────────────────
  /** 路径发现：按名称查找，内部自动解析为 ID 后委托 MemoryGraph */
  async findPaths(fromName: string, toName: string, maxHops?: number): Promise<PathResult[]>;

  // ─── Prompt 注入 ──────────────────────────────────────
  async buildContext(options: BuildContextOptions): Promise<string>;

  // ─── 事件处理 ─────────────────────────────────────────
  /** 存储原子事件并触发派生状态推演（LLM 调 memory_store 后调用此方法） */
  async handleEventFromAgent(input: EventInput): Promise<Event>;

  /** 记录一次 tool call（用于 wasMemoryStoredRecently 检测） */
  recordToolCall(toolName: string, sessionId?: string): void;

  // ─── ArchiveDelegate（上下文压缩回调） ───────────────
  async archiveMessages(messages: Message[]): Promise<void>;

  // ─── 统计信息 ─────────────────────────────────────────
  getStats(): MemoryStats;
}
```

### 1.2 实现要点

**`initDB()` — 建表 + 初始化 FTS5 触发器**：

```typescript
private initDB(): void {
  this.db.pragma('journal_mode = WAL');
  this.db.pragma('foreign_keys = ON');

  this.db.exec(`
    CREATE TABLE IF NOT EXISTS entities (...);
    CREATE TABLE IF NOT EXISTS relations (...);
    CREATE TABLE IF NOT EXISTS events (...);
    CREATE TABLE IF NOT EXISTS facts (...);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(...);
    
    -- 索引
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    -- ... 所有索引
  `);

  this.ensureFtsTriggers();
}
```

---

## 2. 实时触发机制

### 2.1 三级触发汇总

| 层级 | 触发点 | 触发者 | 延迟要求 | LLM 成本 |
|------|--------|--------|----------|---------|
| **1. LLM 主动存储** | AgentLoop 工具调用 → `memory_store` | 主 Agent 自己在合适的时机调用 tool | < 50ms（内部查重 <1ms） | 0（tool call 额外成本忽略） |
| **2. PostToolUse 兜底** | AgentLoop → HookRegistry → PostToolUse | 钩子监听器检测 LLM 是否已存，未存则异步提取 | < 5ms（仅检查日志） | ~500 tokens（仅当 LLM 忘存时） |
| **3. 会话结束提取** | ChatSession.run() finally | setTimeout 5s 后异步执行 | 不阻塞用户 | ~1k tokens（轻量 LLM） |
| **4. 定时维护** | setInterval / cron（每周） | Timer | 不阻塞 | 0（纯算法） |

### 2.2 设计选择：只用 tool call，不用文本标记

**核心决定**：LLM 通过 `memory_store` 工具调用来存储记忆，不在流式输出中使用 `<memory:>` 文本标记。

| 方式 | 优点 | 缺点 |
|------|------|------|
| **文本标记** `<memory:event>` | 零额外调用成本 | 格式不稳定（拼写错误、被截断）；无错误反馈；子 Agent 无法使用 |
| **工具调用** `memory_store` | 格式 100% 稳定（JSON Schema 校验）；有错误反馈；子 Agent 也能调 | 多一次 tool call（< 50ms） |

**结论**：格式稳定比零成本更重要。LLM 调一次 `memory_store` 的成本可以忽略，但一条解析失败的记忆可能导致用户偏好丢失，且难以追溯。

**因此**：
- 去掉 `onText` 中的 `<memory:>` 标记解析逻辑
- 去掉 `handleTextDelta()` / `parseMemoryTags()` 等方法
- `l0-base-memory-guide.yaml` 中改用 tool call 描述

### 2.3 层级 1：LLM 主动存储（主路径）

**触发方式**：LLM 在合适的时机主动调用 `memory_store` 工具。

**Prompt 引导**（`l0-base-memory-guide.yaml`）：

```yaml
content: |
  # Memory System — Quick Reference

  ## When to Store (via memory_store tool)

  当你确认以下信息时，**主动调用 memory_store**：
  - 用户明确说出的固定偏好（"我喜欢/我不喜欢/我习惯"）
  - 用户纠正你的做法（"不对，应该用X"）
  - 你刚完成的任务（通过 task/agent_team 执行完毕）
  - 你发现的用户隐性偏好模式
  - 重要的项目决策及其原因

  ## When NOT to Store
  - 一次性的查询结果（"帮我查一下天气"）
  - 推测的内容（你不太确定的信息）
  - 已经在当前对话中用 memory_store 存过的同一主题

  ## 自我执行记录

  每次通过 task 或 agent_team 完成子任务后，记录执行结果：
  memory_store({
    type: "event",
    data: { content: "完成了项目A的用户注册接口", entities: ["项目A"] },
    scene: "开发"
  })

  如果发现了用户的隐性偏好，也一并记录：
  memory_store({
    type: "entity",
    data: { name: "参数校验", entity_type: "preference", summary: "张三要求所有接口做参数校验" },
    scene: "开发"
  })

  ## Storage Format (for memory_store tool)
  - type=entity: { name, entity_type, summary, belief? }
  - type=relation: { subject, relation, object, strength? }
  - type=fact: { title, content }
  - type=event: { content, entities, importance? }
```

**`l0-base-memory-guide.yaml` 组件配置更新**：

```yaml
id: base-memory-guide
name: Memory Guide
layer: L0
priority: 80
estimatedTokens: 400     # 从 300 增加到 400，因为 tool call 说明更详细
requiredTools:
  - memory_search
  - memory_store
content: |
  # Memory System — Quick Reference
  ...
```

### 2.4 层级 2：PostToolUse 兜底捕获

**触发点**：`AgentLoop.run()` 中的 `HookRegistry.emit('PostToolUse')`（AgentLoop.ts:366-379）

**兜底逻辑**：LLM 不一定每次都记得调 `memory_store`。PostToolUse hook 作为兜底，检测 LLM 是否已存，如果未存则异步提取。

```typescript
// MemoryManager 初始化时注册 PostToolUse 监听器
this.hookRegistry?.on('PostToolUse', async (context) => {
  // 只对 task/agent_team 的完成做兜底
  if ((context.toolName === 'task' || context.toolName === 'agent_team') && !context.toolIsError) {
    // 查重：检测 LLM 是否已经主动存过
    if (this.wasMemoryStoredRecently(context.sessionId)) {
      return { success: true, blocked: false };
    }
    // 未存 → 异步启动兜底提取
    this.scheduleAutoExtract(context.toolResult, context.toolName);
  }
  return { success: true, blocked: false };
});
```

**`wasMemoryStoredRecently()` — LLM 主动存储检测**：

```typescript
/**
 * 检测当前 session 中 LLM 是否已经主动调用了 memory_store
 *
 * 检查最近 2 分钟内的 tool call 日志。
 * 如果 LLM 已存，兜底提取跳过，避免重复。
 *
 * eventLog 是 MemoryManager 实例的内存数组，
 * 生命周期跟随 MemoryManager 实例（不持久化到 SQLite）。
 * 每次 MemoryManager.init() 时重置。
 * 每条日志: { event: string, sessionId: string, timestamp: number }
 */
private eventLog: Array<{ event: string; sessionId: string; timestamp: number }> = [];

/** 记录一次 tool call 事件 */
private recordToolCall(event: string, sessionId: string): void {
  this.eventLog.push({ event, sessionId, timestamp: Date.now() });
  // 保留最近 500 条，防止内存泄漏
  if (this.eventLog.length > 500) {
    this.eventLog = this.eventLog.slice(-250);
  }
}

private wasMemoryStoredRecently(sessionId?: string, contextWindow: number = 120_000): boolean {
  if (!sessionId) return false;

  const recent = this.eventLog.filter(e =>
    e.event === 'tool:memory_store' &&
    e.sessionId === sessionId &&
    e.timestamp > Date.now() - contextWindow
  );
  return recent.length > 0;
}
```

**`scheduleAutoExtract()` — 轻量异步提取**：

```typescript
private scheduleAutoExtract(toolResult: string | undefined, toolName: string): void {
  if (!toolResult || toolResult.length > 5000) return; // 太长的不处理

  // 异步执行，不阻塞主流程
  setTimeout(async () => {
    try {
      // 用便宜 LLM 提取可记忆的信息
      const response = await this.cheapLLM.stream([{
        role: 'system',
        content: `从以下 ${toolName} 的执行结果中提取值得记忆的信息。

输出 JSON 数组，不要任何其他文字：
[
  {
    "type": "entity|event|fact",
    "data": { ... },
    "scene": "开发|生活|工作",
    "confidence": 0-1
  }
]

规则：
- 只提取确定的信息（confidence >= 0.8）
- 忽略代码内容、错误堆栈、中间过程
- 只提取"完成了什么"、"发现了什么偏好"、"做了什么决策"
- 不确定的不要输出
- 用中文输出`,
      }, {
        role: 'user',
        content: toolResult.slice(0, 4000),
      }]);

      const items = JSON.parse(response);
      for (const item of items) {
        if (item.confidence >= 0.8) {
          // 通过 MemoryStoreTool 的工具接口存储，复用其查重逻辑
          // 等价于调 memory_store({ type, data, scene })
          await this.dispatchStore(item.type, item.data, item.scene);
        }
      }
    } catch (err) {
      log.debug('Auto-extract failed (non-critical):', err);
    }
  }, 1000); // 1 秒后执行，确保主流程不受影响
}

/**
 * 通用的存储分发方法：按 type 调用对应的 CRUD 方法
 * 由 scheduleAutoExtract 和 handleEventFromAgent 复用
 */
private async dispatchStore(type: string, data: any, scene?: string): Promise<void> {
  switch (type) {
    case 'entity':
      await this.upsertEntity({ ...data, scene_tag: scene || data.scene_tag });
      break;
    case 'fact':
      await this.storeFact({ ...data, scene_tag: scene || data.scene_tag });
      break;
    case 'event':
      await this.recordEvent({
        entityNames: data.entities || data.entityNames || [],
        content: data.content || '',
        result: data.result,
        importance: data.importance,
        scene_tag: scene || data.scene_tag,
      });
      break;
    case 'relation':
      await this.relate({
        subject_name: data.subject || data.subject_name,
        relation: data.relation,
        object_name: data.object || data.object_name,
        scene_tag: scene || data.scene_tag,
      });
      break;
  }
}
```

**重复防止总结**：

```
LLM 主动存 → wasMemoryStoredRecently() 返回 true → 兜底跳过
LLM 忘记存 → wasMemoryStoredRecently() 返回 false → 兜底提取
兜底提取前 → memory_store 内部查重（见下方 4.1 节） → 跳过已存在的内容
```

### 2.5 自动推论引擎 — 派生状态维护

核心设计：LLM 只存原子事件，MemoryManager 自动推演派生状态。

```
LLM 调 memory_store({ type: "event", data: { content: "完成用户注册接口", entities: ["项目A"] } })

MemoryManager.handleEventFromAgent():
  1. 存入 events 表                                       ← LLM 的职责到此为止
  2. tryUpdateProjectStatus(event)                        ← 纯算法，不依赖 LLM
     a. 查 project_snapshots 取最新快照
     b. 关键词分析："完成" + "接口" → progress +15%
     c. 检测 phase 信号：无 → 保持"开发"
     d. 更新 current_focus：从"用户注册"→"登录模块"
     e. 写入新 snapshot（不覆盖旧记录）
  3. tryTrackRelationChange(event)                        ← 纯算法
     a. 检测 content 是否含"改成"、"换了"、"不用...用..."
     b. 查 event 前后上下文，找 subject → relation → 旧值 → 新值
     c. 写入 relation_changes 表
     d. 更新 relations 表（is_active 标记）
```

**`tryUpdateProjectStatus()` 实现**：

```typescript
/**
 * 从原子事件自动推演项目状态
 *
 * 不依赖 LLM，纯关键词规则引擎。
 * 规则不完美可以接受——后续事件会不断修正偏差。
 * 因为 project_snapshots 是追加模式（不覆盖），
 * 每次事件都产生一个新快照，偏差只会影响中间点，
 * 最终状态由完整事件序列保证。
 */
private async tryUpdateProjectStatus(event: Event): Promise<void> {
  // 只有涉及 project 类型的事件才处理
  const projectIds = this.db.prepare(`
    SELECT id FROM entities
    WHERE type = 'project' AND id IN (${event.entity_ids.split(',').map(() => '?').join(',')})
  `).all(...event.entity_ids.split(',')) as { id: string }[];

  if (projectIds.length === 0) return;

  for (const { id: projectId } of projectIds) {
    const content = event.content;

    // 关键词规则引擎
    const progressDelta = this.estimateProgressDelta(content);
    const newFocus = this.extractNewFocus(content);
    const phaseTransition = this.detectPhaseTransition(content);
    const isBlocker = /\b(阻塞|问题|bug|卡住|不能|失败|报错|错误)\b/i.test(content);
    const isUnblock = /\b(解决|修复|完成|通过)\b/i.test(content) && !isBlocker;

    // 获取当前状态
    const current = this.db.prepare(`
      SELECT * FROM project_snapshots
      WHERE project_id = ? ORDER BY snapshot_at DESC LIMIT 1
    `).get(projectId) as ProjectSnapshot | undefined;

    // 计算新状态
    const blocker = isBlocker
      ? content.slice(0, 200)
      : isUnblock ? null : (current?.blockers ?? null);

    const snapshot: Omit<ProjectSnapshot, 'id'> = {
      project_id: projectId,
      phase: phaseTransition ?? current?.phase ?? '开发',
      status: '进行中',
      progress_pct: Math.min(100, Math.max(0, (current?.progress_pct ?? 0) + progressDelta)),
      current_focus: newFocus ?? current?.current_focus ?? content.slice(0, 100),
      blockers: blocker,
      next_milestone: current?.next_milestone ?? null,
      tech_stack: current?.tech_stack ?? null,
      snapshot_at: Date.now(),
    };

    this.db.prepare(`
      INSERT INTO project_snapshots
        (id, project_id, phase, status, progress_pct, current_focus, blockers, next_milestone, tech_stack, snapshot_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(), snapshot.project_id, snapshot.phase, snapshot.status,
      snapshot.progress_pct, snapshot.current_focus, snapshot.blockers,
      snapshot.next_milestone, snapshot.tech_stack, snapshot.snapshot_at
    );

    log.info(`Project status updated: ${projectId} → ${snapshot.phase} ${snapshot.progress_pct}%`);
  }
}

/**
 * 关键词 → 进度增量映射
 *
 * 设计原则：给合理的大致值就行，不需要精确。
 * 因为每条事件都会触发一次推演，偏差会随时间被拉平。
 */
private estimateProgressDelta(content: string): number {
  const patterns: [RegExp, number][] = [
    // 大块完成
    [/(完成|做完|搞定|交付).*(接口|模块|功能|页面|组件|系统|服务)/, 15],
    [/(完成|做完|搞定).*(开发|编码|实现|集成|联调)/, 12],
    [/(通过).*(测试|验收|评审|审核)/, 15],
    [/(部署|上线|发布|发布上线)/, 20],

    // 中等推进
    [/(开始|着手|正在).*(开发|编码|实现)/, 5],
    [/(修复|解决|处理).*(BUG|bug|问题|缺陷|故障)/, 5],
    [/(优化|重构|改进).*(性能|结构|代码)/, 3],
    [/(新增|添加).*(功能|接口|页面)/, 8],

    // 负向（回退）
    [/重构/, -5],
    [/(回滚|退回|放弃|推翻|重来)/, -10],
    [/暂停|搁置|延期/, 0],

    // 默认
    [/(研究|调研|学习|了解|看了|读了)/, 2],
  ];

  // 取最大匹配的 delta
  for (const [pattern, delta] of patterns) {
    if (pattern.test(content)) return delta;
  }
  return 5; // 默认小幅推进
}

private extractNewFocus(content: string): string | null {
  // "开始做XXX" → newFocus = "XXX"
  const match = content.match(/(?:开始|着手|正在)(?:做|写|开发|实现|处理)?[：:]\s*(.+)/);
  if (match) return match[1].trim();

  // "做XXX" → 可能也是新焦点
  const match2 = content.match(/(?:现在在做|当前在做|接下来做|下一步做)[：:]\s*(.+)/);
  if (match2) return match2[1].trim();

  return null;
}

private detectPhaseTransition(content: string): string | null {
  const transitions: [RegExp, string][] = [
    [/(进入|开始).*(测试|联调|集成测试)/, '测试'],
    [/(完成|通过).*(测试|联调)/, '部署'],
    [/(部署|上线|发布)/, '部署'],
    [/(通过.*验收|验收.*通过)/, '维护'],
    [/重构|重新设计/, '设计'],
  ];

  for (const [pattern, phase] of transitions) {
    if (pattern.test(content)) return phase;
  }
  return null;
}
```

**`tryTrackPreferenceChange()` 实现**：

```typescript
/**
 * 从原子事件检测偏好变更并写入 relation_changes
 *
 * 检测信号：用户纠正（memory_store source='user_correction'）
 * 或 content 中包含"改成"、"换了"、"不用...改用..."
 * 然后查 events 表找前后的 relation 状态，
 * 推断 old_value → new_value。
 */
private async tryTrackPreferenceChange(event: Event): Promise<void> {
  const content = event.content;

  // 1. 关键词检测：这是变更事件吗？
  const changeMatch = content.match(
    /(?:改成|换了|换成|改用|不用|不要|废弃|弃用)\s*(.+?)(?:了|\.|!|$)/
  );
  if (!changeMatch) return;

  const newValue = changeMatch[1].trim();

  // 2. 找事件涉及的 subject entity
  const subjectIds = event.entity_ids.split(',');
  const subjects = this.db.prepare(`
    SELECT id, name FROM entities WHERE id IN (${subjectIds.map(() => '?').join(',')})
  `).all(...subjectIds) as { id: string; name: string }[];

  for (const subject of subjects) {
    // 3. 找 subject 当前关联的、可能被替换的 tool/preference
    //    匹配 relation 中最近更新的同类实体
    const currentRelation = this.db.prepare(`
      SELECT r.object_id, e.name, r.relation
      FROM relations r JOIN entities e ON e.id = r.object_id
      WHERE r.subject_id = ? AND r.is_active = 1
        AND e.type IN ('tool', 'preference')
      ORDER BY r.updated_at DESC LIMIT 5
    `).all(subject.id) as { object_id: string; name: string; relation: string }[];

    // 4. 尝试找旧值（content 中可能提到了旧值）
    const oldMatch = content.match(/(?:不用|不要|弃用|废弃)\s*(.+?)(?:，|,|了|\.|\s|$)/);
    const oldName = oldMatch?.[1]?.trim();

    const matched = oldName
      ? currentRelation.find(r => r.name.includes(oldName))
      : currentRelation.find(r => content.includes(r.name));

    if (matched) {
      // 5. 查找新实体的 ID（按名称模糊匹配，取第一个）
      const newEntity = this.db.prepare(`
        SELECT id, name FROM entities
        WHERE name LIKE ? AND type IN ('tool', 'preference')
        ORDER BY updated_at DESC LIMIT 1
      `).get(`%${newValue}%`) as { id: string; name: string } | undefined;

      const newEntityId = newEntity?.id;
      if (!newEntityId) {
        // 没有现成的 entity → 先创建，再用创建后的 ID
        const created = await this.upsertEntity({
          name: newValue,
          type: 'tool',
          summary: newValue,
          scene_tag: event.scene_tag || '开发',
        });
        // upsertEntity 返回的 entity 包含 id
        // 这里简化为用 newValue 作为占位 ID 的场景不常见
        log.warn(`tryTrackPreferenceChange: 未找到实体 "${newValue}"，使用名称本身`);
        // 用名称作为 new_value 的 fallback
      }

      const oldEntityId = matched.object_id;  // 从 relations 查询结果直接取 ID
      const newEntityIdToUse = newEntityId || newValue;

      // 5. 写入 relation_changes（存 ID 非名称）
      this.db.prepare(`
        INSERT INTO relation_changes (id, subject_id, relation, old_value, new_value, reason, scene_tag, changed_at, operator)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(),
        subject.id,
        matched.relation,
        oldEntityId,
        newEntityIdToUse,
        content.slice(0, 200),
        event.scene_tag || '',
        Date.now(),
        'user_correction'    // 用户纠正是最高优先级来源
      );

      // 6. 更新 relations 表：标记旧记录 inactive，创建新记录
      this.db.prepare(`
        UPDATE relations SET is_active = 0, updated_at = ?
        WHERE subject_id = ? AND object_id = ? AND relation = ?
      `).run(Date.now(), subject.id, matched.object_id, matched.relation);

      // 查找或创建新 entity（如果还没创建的话）
      if (!newEntityId) {
        const created = await this.upsertEntity({
          name: newValue,
          type: matched.relation === '偏好' ? 'preference' : 'tool',
          summary: newValue,
        });
        // 用创建后的 ID 创建新 relation
        if (created) {
          await this.relate({
            subject_name: subject.name,
            relation: matched.relation,
            object_name: created.id,
          });
        }
      } else {
        await this.relate({
          subject_name: subject.name,
          relation: matched.relation,
          object_name: newEntityId,
        });
      }
    }
  }
}
```

### 2.5.1 集成到事件处理管线

在 `handleEventFromAgent()` 中串联：

```typescript
async handleEventFromAgent(input: EventInput): Promise<Event> {
  // 1. 存储原子事件
  const event = await this.recordEvent(input);

  // 2. 派生状态推演（并行，失败不阻塞主流程）
  Promise.all([
    this.tryUpdateProjectStatus(event),
    this.tryTrackPreferenceChange(event),
  ]).catch(err => log.error('Derived state update failed:', err));

  return event;
}
```

设计原则：派生推演**失败不影响主流程**。即使 `tryUpdateProjectStatus` 抛异常，事件本身已经成功存储。下次事件触发时会重试推演，不会丢失。`project_snapshots` 是追加模式，缺失一个快照只是中间点缺失，最终状态由完整事件序列保证。

### 2.6 层级 2：会话结束提取

**触发点**：`ChatSession.run()` 的 `finally` 块

```typescript
// ChatSession.ts
async run(input: string, opts?: { fromDrain?: boolean }): Promise<void> {
  try {
    // ... 现有逻辑 ...
    await this.agentLoop.run(input);
    // ... 现有逻辑 ...
  } finally {
    // 现在的逻辑（不变）
    this.stateTracker.transitionTo('idle');
    await this.checkPendingCompletions();
    await this.drainPendingQueue();
    await this.callbacks?.onAfterExecution?.();

    // ← 新增：异步执行会话结束记忆提取（5 秒后，不阻塞用户）
    this.scheduleMemoryExtraction();
  }
}

private scheduleMemoryExtraction(): void {
  // 防抖：如果 10 秒内又有新 run，取消上次的
  if (this._extractTimer) clearTimeout(this._extractTimer);
  this._extractTimer = setTimeout(async () => {
    try {
      const messages = this.agentLoop.getContextManager().getMessages();
      await this.memoryManager?.extractFromSession(messages);
    } catch (err) {
      log.error('Memory extraction failed:', err);
    }
  }, 5000);
}
```

**`extractFromSession()` 实现**（轻量 LLM 调用）：

```typescript
async extractFromSession(messages: Message[]): Promise<void> {
  // 使用便宜模型，不阻塞主流程
  const response = await this.cheapLLM.stream([
    { role: 'system', content: `
分析以下对话，提取值得长期记住的信息。

只提取以下类型之一（JSON 数组）：
1. {"type":"entity","name":"...","type":"preference|user|tool","summary":"一句话描述"}
2. {"type":"fact","title":"...","content":"..."}
3. {"type":"event","content":"...","importance":3}

规则：
- 只提取 user 明确说的或可以明确推断的
- 忽略一次性指令（如"帮我查一下天气"）
- 已经通过 memory_store 工具存储的不需要重复提取
- 不确定的不要提取
- 用中文回复
`},
    { role: 'user', content: this.formatMessages(messages) },
  ]);

  // 解析 JSON 并存储
  try {
    const items = JSON.parse(response);
    for (const item of items) {
      switch (item.type) {
        case 'entity': await this.upsertEntity(item); break;
        case 'fact': await this.storeFact(item); break;
        case 'event': await this.recordEvent(item); break;
      }
    }
  } catch (err) {
    log.warn('Failed to parse memory extraction result:', err);
  }
}
```

**成本控制**：
- 每次提取 ~1k tokens 输入 + ~200 tokens 输出
- 假设每天 50 次会话 → 60k tokens/天 → ~$0.03/天（按 deepseek-chat 价格）
- 可以只给有 `entity` 或 `fact` 相关关键词的会话做提取

---

## 3. 定时维护

### 3.1 维护任务

```typescript
async runMaintenance(): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { merged: 0, archived: 0, deleted: 0 };

  // 1. 合并重复 Entity（相似 name 且同 type）
  const duplicates = this.db.prepare(`
    SELECT a.id, b.id, a.name, b.name FROM entities a
    JOIN entities b ON a.type = b.type AND a.id < b.id
    WHERE a.name = b.name OR levenshtein(a.name, b.name) < 2
  `).all();
  // 选择后写的保留，前写的合并引用到后写

  // 2. 归档低价值 Event（importance < 3 且超过 90 天）
  const toArchive = this.db.prepare(`
    DELETE FROM events WHERE importance < 3
    AND time < ? - 90 * 86400 * 1000
  `).run(Date.now());
  report.archived = toArchive.changes;

  // 3. 清理孤立 Relation（两端 entity 已被删除的）
  // 通过 ON DELETE CASCADE 自动处理

  // 4. 更新 ref_count
  this.db.exec(`
    UPDATE entities SET ref_count = (
      SELECT COUNT(*) FROM relations
      WHERE subject_id = entities.id OR object_id = entities.id
    );
  `);

  return report;
}
```

### 3.2 调度方式

```typescript
// MemoryManager 启动时
async startMaintenanceScheduler(): Promise<void> {
  // 每周日凌晨 3 点执行
  const scheduleNext = () => {
    const now = Date.now();
    const nextSunday = getNextSunday(now);
    const delay = nextSunday - now;
    
    this._maintenanceTimer = setTimeout(async () => {
      await this.runMaintenance();
      scheduleNext();  // 递归调度下一周
    }, delay);
  };
  
  scheduleNext();
}
```

对 Electron 应用，可以变成一个 IPC 命令让用户手动触发，或集成到系统 cron。

---

## 4. Agent 工具定义

### 4.1 memory_search 工具

```typescript
// src/core/tools/MemorySearchTool.ts
import { BaseTool } from './BaseTool';

export class MemorySearchTool extends BaseTool {
  readonly name = 'memory_search';
  readonly description = [
    '搜索长期记忆：用户偏好、项目上下文、历史事实、实体关联。',
    '在任何决策前，建议先搜索相关记忆。',
    '支持全文搜索、实体关联查询、路径发现。',
  ].join('\n');
  
  readonly input_schema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词（如 "张三 PostgreSQL 偏好"）',
      },
      type: {
        type: 'string',
        enum: ['auto', 'entity', 'fact', 'event', 'relation'],
        description: '搜索类型，默认 auto 自动识别',
        default: 'auto',
      },
      scope: {
        type: 'string',
        enum: ['auto', 'memory', 'subagent', 'episode'],
        description: '搜索范围。memory=主记忆库, subagent=子Agent执行结果, episode=叙事记忆, auto=全部',
        default: 'auto',
      },
      scene: {
        type: 'string',
        description: '场景过滤（如 "开发"、"生活"），留空不过滤',
      },
      max_results: {
        type: 'integer',
        description: '最大返回数量（1-20）',
        default: 5,
      },
      use_semantic: {
        type: 'boolean',
        description: '是否启用语义搜索（默认 true）',
        default: true,
      },
    },
    required: ['query'],
  };

  constructor(private memoryManager: MemoryManager) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const type = (input.type as string) || 'auto';
    const scene = input.scene as string | undefined;
    const maxResults = Math.min((input.max_results as number) || 5, 20);

    try {
      // 1. 全文搜索
      const searchResults = await this.memoryManager.search(query, { scene, limit: maxResults });

      // 2. 如果有 entity 命中，补充关系查询
      const entities = searchResults.filter(r => r.type === 'entity');
      const enriched = await Promise.all(
        entities.map(async (e) => ({
          ...e,
          related: await this.memoryManager.getRelations(e.id).catch(() => []),
        }))
      );

      // 3. 格式化结果
      const formatted = this.formatResults(enriched, query);
      return this.success(formatted);
    } catch (err) {
      return this.error(`记忆搜索失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private formatResults(results: any[], query: string): string {
    if (results.length === 0) {
      return `未找到与 "${query}" 相关的记忆。`;
    }

    const parts: string[] = [`## 记忆搜索结果：${query}`];
    for (const r of results) {
      parts.push(`### [${r.type}] ${r.name || r.title}`);
      parts.push(`${r.summary || r.content}`);
      if (r.related && r.related.length > 0) {
        parts.push(`关联：${r.related.map((rel: any) => `${rel.name}（${rel.relation}）`).join('、')}`);
      }
      parts.push('');
    }
    return parts.join('\n');
  }
}
```

### 4.2 memory_store 工具

```typescript
// src/core/tools/MemoryStoreTool.ts
import { BaseTool } from './BaseTool';

export class MemoryStoreTool extends BaseTool {
  readonly name = 'memory_store';
  readonly description = [
    '存储一条长期记忆。',
    '在你发现以下信息时使用：',
    '- 用户的固定偏好（"我喜欢..."、"我不喜欢..."）',
    '- 项目决策和架构选择',
    '- 重复出现的模式',
    '- 重要的上下文信息',
    '注意：一次性信息不需要存储。不确定是否重要的，等用户纠正后再存。',
  ].join('\n');

  readonly input_schema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['entity', 'relation', 'fact', 'event'],
        description: '记忆类型',
      },
      data: {
        type: 'object',
        description: '记忆数据，不同 type 格式不同',
      },
      scene: {
        type: 'string',
        description: '场景标签（"开发"、"生活"、"工作"），逗号分隔',
      },
    },
    required: ['type', 'data'],
  };

  constructor(private memoryManager: MemoryManager) {
    super();
  }

  /**
   * 内部查重：在写入前检查是否已有相似内容
   * 返回 { skipped: true, message } 表示跳过
   * 返回 { skipped: false } 表示继续
   */
  private async checkDuplicate(
    type: string,
    data: Record<string, unknown>,
    scene?: string,
  ): Promise<{ skipped: boolean; message?: string }> {
    if (type === 'entity') {
      const name = data.name as string;
      const entityType = data.entity_type as string;
      if (name) {
        const existing = this.memoryManager.db.prepare(`
          SELECT id, summary FROM entities
          WHERE name = ? AND type = ? AND scene_tag LIKE ?
        `).get(name, entityType, `%${scene || ''}%`) as { id: string; summary: string } | undefined;

        if (existing) {
          const newSummary = data.summary as string;
          if (!newSummary || existing.summary === newSummary) {
            return { skipped: true, message: `已存在，跳过：${name}` };
          }
        }
      }
    }

    if (type === 'fact') {
      const title = data.title as string;
      if (title) {
        const existing = this.memoryManager.db.prepare(`
          SELECT id, content FROM facts
          WHERE title = ? AND is_latest = 1
        `).get(title) as { id: string; content: string } | undefined;

        if (existing) {
          const newContent = data.content as string;
          if (!newContent || this.similarity(existing.content, newContent) > 0.8) {
            return { skipped: true, message: `事实已存在，跳过：${title}` };
          }
        }
      }
    }

    if (type === 'event') {
      const content = data.content as string;
      if (content) {
        const recent = this.memoryManager.db.prepare(`
          SELECT content FROM events
          WHERE ABS(created_at - ?) < 300000
          ORDER BY created_at DESC LIMIT 3
        `).all(Date.now()) as { content: string }[];

        for (const r of recent) {
          if (this.similarity(r.content, content) > 0.85) {
            return { skipped: true, message: `相似事件已存在，跳过重复` };
          }
        }
      }
    }

    return { skipped: false };
  }

  /**
   * 简单文本相似度（字符集 Jaccard，够用）
   */
  private similarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const type = input.type as string;
    const data = input.data as Record<string, unknown>;
    const scene = input.scene as string | undefined;

    try {
      // ── 查重 — LLM 和兜底同时写入的重复防止 ──
      const dupCheck = await this.checkDuplicate(type, data, scene);
      if (dupCheck.skipped) {
        return this.success(dupCheck.message);
      }

      // MemoryManager 记录本次 tool call
      this.memoryManager?.recordToolCall('memory_store');

      switch (type) {
        case 'entity': {
          await this.memoryManager.upsertEntity({
            name: data.name as string,
            type: data.entity_type as string,
            summary: data.summary as string,
            belief: data.belief as string | undefined,
            scene_tag: scene,
          });
          return this.success(`已记住：${data.name}`);
        }
        case 'fact': {
          await this.memoryManager.storeFact({
            title: data.title as string,
            content: data.content as string,
            source: 'agent_discovered',
            scene_tag: scene,
          });
          return this.success(`已记录事实：${data.title}`);
        }
        case 'relation': {
          await this.memoryManager.relate({
            subject_name: data.subject as string,
            relation: data.relation as string,
            object_name: data.object as string,
            strength: (data.strength as number) || 3,
            scene_tag: scene,
          });
          return this.success(`已记录关系：${data.subject} ${data.relation} ${data.object}`);
        }
        case 'event': {
          await this.memoryManager.recordEvent({
            entityNames: (data.entities as string[]) || [],
            content: data.content as string,
            result: data.result as string | undefined,
            importance: (data.importance as number) || 3,
            scene_tag: scene,
          });
          return this.success(`已记录事件`);
        }
        default:
          return this.error(`不支持的记忆类型: ${type}`);
      }
    } catch (err) {
      return this.error(`记忆存储失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

---

## 5. 与现有系统的集成

### 5.1 集成总图

```
┌─ 已有的 ─────────────────────────────────────┐
│  xuanji.yaml (已声明 memory_search/store)     │
│  l0-base-memory-guide.yaml (已存在)           │
│  better-sqlite3 (已有依赖)                    │
│  HookRegistry + EventBus (已有)              │
│  LayeredPromptBuilder (已有)                 │
│  AgentLoop.onText (已有)                     │
│  PathManager.getUserMemoryPath() (已有)      │
└──────────────────────────────────────────────┘

┌─ 新增的 ─────────────────────────────────────┐
│  MemoryManager (src/core/memory/)            │
│  MemoryGraph (src/core/memory/)              │
│  MemorySearchTool (src/core/tools/)          │
│  MemoryStoreTool (src/core/tools/)           │
│  ToolRegistry 注册两个新工具                  │
│  LayeredPromptBuilder 注入 memoryManager      │
│  ChatSession.onText 添加标记解析              │
└──────────────────────────────────────────────┘
```

### 5.2 需要修改的文件

| 文件 | 修改内容 | 影响 |
|------|---------|------|
| `src/core/memory/MemoryManager.ts` | **新增** 主类 | 核心 |
| `src/core/memory/MemoryGraph.ts` | 已写好 | 核心 |
| `src/core/memory/types.ts` | **新增** 类型定义 | 核心 |
| `src/core/tools/MemorySearchTool.ts` | **新增** 搜索工具 | Agent 可用 |
| `src/core/tools/MemoryStoreTool.ts` | **新增** 存储工具 | Agent 可用 |
| `src/core/tools/ToolRegistry.ts` | 注册 memory_search / memory_store | 工具注册 |
| `src/core/prompt/LayeredPromptBuilder.ts` | 构造函数新增 memoryManager 参数 + build 中调用 | 注入点 |
| `src/core/chat/ChatSession.ts` | onText 中添加标记解析 + finally 中 scheduleExtraction | 触发点 |
| `src/core/events/events.ts` | 新增 MEMORY_STORED / MEMORY_SEARCHED 事件（可选） | 事件 |
| `src/core/di/index.ts` 或 `SessionFactory.ts` | 创建 MemoryManager 实例并注入 | 依赖注入 |
| `src/core/templates/agents/xuanji.yaml` | memory_search / memory_store 已声明，不需要改 | — |
| `src/core/templates/prompts/l0-base-memory-guide.yaml` | 补充 memory_store 工具调用说明 | 引导 |

### 5.3 关键修改：SessionFactory

```typescript
// SessionFactory.ts
export class SessionFactory {
  async createSession(...): Promise<ChatSession> {
    // ... 现有逻辑 ...

    // 1. 创建 MemoryManager
    const memoryManager = new MemoryManager(getUserMemoryPath(userId));
    await memoryManager.init();
    container.register('memoryManager', memoryManager);

    // 2. 创建 LayeredPromptBuilder 时传入
    const builder = new LayeredPromptBuilder(
      userId,
      projectRoot,
      agentId,
      undefined,
      memoryManager,
    );

    // 3. 注册记忆工具到 ToolRegistry
    const registry = container.resolve<IToolRegistry>('toolRegistry');
    registry.register(new MemorySearchTool(memoryManager));
    registry.register(new MemoryStoreTool(memoryManager));

    // ... 现有逻辑 ...
  }
}
```

### 5.4 关键修改：ChatSession

```typescript
// ChatSession.ts — 修改 setupMemoryCapture 方法
private setupMemoryCapture(): void {
  this.agentLoop.on({
    onText: (text: string) => {
      // 现有的 StateTracker 逻辑（不变）
      if (this._useNewPath && this._stateMachine) {
        this._stateMachine.transition({ type: 'AGENT_TEXT_STARTED' });
      } else {
        this.stateTracker.transitionTo('outputting');
      }

      // 原始文本直接传递给 callbacks（不做标记解析）
      this.callbacks?.onText?.(text);
    },
  });
}

// run() 的 finally 中添加异步提取
finally {
  // ... 现有逻辑 ...
  this.scheduleMemoryExtraction();
}
```

---

## 6. EventBus 事件

可选，用于 UI 通知和监控。

```typescript
// events.ts 新增
export enum XuanjiEvent {
  // ... 现有事件 ...

  // === 记忆系统 ===
  MEMORY_STORED = 'memory:stored',
  MEMORY_SEARCHED = 'memory:searched',
  MEMORY_EXTRACTED = 'memory:extracted',
  MEMORY_MAINTENANCE = 'memory:maintenance',
  MEMORY_LEARNING_PROGRESS = 'memory:learning:progress',
  MEMORY_DELIVER_MESSAGE = 'deliver:message',
}
```

---

## 7. 实现顺序建议

### Phase 1：基础存储（2-3 天）

```
1. MemoryManager.initDB() — SQLite 建表 + 索引 + FTS5
2. Entity CRUD（upsertEntity / searchEntities）
3. Fact CRUD（storeFact / updateFact / rollbackFact）
4. 单元测试（CRUD + 版本管理）
```

### Phase 2：检索与注入（2 天）

```
5. FTS5 搜索（search 方法）
6. buildContext() — prompt 注入
7. LayeredPromptBuilder 集成
8. 端到端测试（build → prompt 含记忆块）
```

### Phase 3：Agent 工具（1 天）

```
9. MemorySearchTool + MemoryStoreTool
10. ToolRegistry 注册
11. l0-base-memory-guide.yaml 补充
12. 主 Agent 调用验证
```

### Phase 4：实时触发（2 天）

```
13. memory_store tool call 的记录（recordToolCall + wasMemoryStoredRecently）
14. ChatSession 集成
15. 会话结束异步提取（extractFromSession）
16. 集成测试（对话 → 自动记忆 → 下次检索可见）
```

### Phase 5：图查询（1 天）

```
17. MemoryGraph 集成到 MemoryManager
18. Relation CRUD + 增量同步
19. MemorySearchTool 补充图查询
20. 子 Agent 记忆注入
```

### Phase 6：生产化（1 天）

```
21. 定时维护
22. EventBus 事件
23. 错误恢复（启动时检测数据库完整性）
24. 性能测试（1000 entity + 3000 relation 下的检索延迟）
```

---

## 8. 生产配置参考

### 8.1 缓存策略

MemoryGraph 在内存中常驻，无需磁盘缓存。FTS5 搜索由 SQLite 内部管理缓存。

### 8.2 备份策略

```bash
# 每日备份 memory.db
cp ~/.xuanji/users/{userId}/memory/memory.db \
   ~/.xuanji/users/{userId}/memory/backups/memory-$(date +%Y%m%d).db

# 保留最近 30 天
find ~/.xuanji/users/{userId}/memory/backups/ -mtime +30 -delete
```

### 8.3 恢复策略

```typescript
async repair(): Promise<void> {
  // 1. 检查数据库完整性
  const integrity = this.db.prepare('PRAGMA integrity_check').get() as any;
  if (integrity['integrity_check'] !== 'ok') {
    log.error('Database integrity check failed:', integrity);
    // 2. 尝试恢复
    this.db.exec('PRAGMA quick_check');
    // 3. 如果还是失败，从备份恢复
  }
}
```

### 8.4 数据量预期

| 使用时长 | Entity | Relation | Fact | Event | db 文件大小 |
|---------|--------|----------|------|-------|-----------|
| 1 个月 | ~200 | ~500 | ~300 | ~500 | ~1MB |
| 6 个月 | ~800 | ~2000 | ~1500 | ~3000 | ~5MB |
| 1 年 | ~1500 | ~5000 | ~3000 | ~8000 | ~12MB |
| 3 年 | ~3000 | ~10000 | ~6000 | ~20000 | ~25MB |

SQLite 在 25MB 级别的检索延迟 < 10ms，无需分表。

### 8.5 与 DecisionStore 的共存

现有 `PermissionAudit` 用 `DecisionStore`（独立的 `decisions.db`）。两者职责不同：

- `DecisionStore` — 权限决策缓存（"用户允许了读取 /etc/hosts"）
- `MemoryManager` — 长期记忆（"用户是后端开发，偏好 Docker"）

两者各自独立，database 文件也分开。不合并。

---

## 附录：测试策略

### 单元测试

```
src/core/memory/__tests__/
├── MemoryManager.test.ts      — CRUD + 版本管理 + 去重
├── MemoryGraph.test.ts        — 路径发现 + 子图 + 相似推理 + 聚合
├── FTS5Search.test.ts         — 搜索安全 + 中文分词 + 场景过滤
├── ProjectStatus.test.ts      — 关键词规则引擎 + 进度推演
└── Dedup.test.ts              — Jaccard 相似度 + checkDuplicate
```

核心测试用例：

| 测试 | 验证内容 |
|------|---------|
| Entity upsert 去重 | 相同 name+type 应更新而非创建 |
| Fact 版本管理 | store→update→rollback 版本号正确递增 |
| 查重逻辑 | 相同 title 内容相似 > 0.8 应跳过 |
| Event 并发写入 | 同一毫秒写入两条事件不丢失 |
| FTS5 搜索安全 | 特殊字符 AND OR NOT 不导致语法错误 |
| 路径发现 | 3 跳内正确的 BFS 结果 |
| is_active 过滤 | 图查询只返回活跃关系 |
| scene_tag 精确匹配 | LIKE '%,开发,%' 不误匹配 'AI开发' |

### 集成测试

```
src/core/memory/__tests__/
└── MemoryIntegration.test.ts
```

| 场景 | 步骤 |
|------|------|
| 完整记忆循环 | 存储 entity → 搜索 → L0 注入 → 下次对话可见 |
| 偏好变更追踪 | 用户纠正 → memory_store → 查 relation_changes 有记录 |
| 会话结束提取 | 模拟对话 → scheduleExtraction → 检查 events 表有记录 |
| PostToolUse 兜底 | task 完成不调 memory_store → 检查兜底提取触发 |
| 并发去重 | LLM 和兜底同时写同一个 idea → 只存了一条 |

### 边界测试

| 测试 | 验证 |
|------|------|
| 大文本（100KB） | FTS5 索引不崩溃 |
| 特殊字符（emoji、Unicode） | 存储和检索不乱码 |
| 空值处理 | name/content/title 为空时优雅降级 |
| 数据库损坏 | PRAGMA integrity_check 失败时能恢复 |
| 并发写入（100 线程） | WAL 模式下不出现 SQLITE_BUSY |

---

## 附录：文件清单

```
src/core/memory/
├── MemoryManager.ts       ← 主类（CRUD + 搜索 + 注入 + 触发）
├── MemoryGraph.ts         ← 内存拓扑图（已写完）
└── types.ts               ← memory 系统的类型定义

src/core/tools/
├── MemorySearchTool.ts    ← Agent 可调用的搜索工具
└── MemoryStoreTool.ts     ← Agent 可调用的存储工具

docs/
├── memory-system-part-1-storage.md
├── memory-system-part-2-retrieval.md
└── memory-system-part-3-integration.md
```
