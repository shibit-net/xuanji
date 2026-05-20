# Xuanji 记忆与管家系统设计

> 最终版 — 2026-05-20
> 覆盖：Agent 组成全景 + Prompt 架构 + 存储层 + 推理层 + 行为层
> 前置依赖：审计修复 P7/P1/P2/P3/P5/P8/P9/P10/P12/P13 已完成
> 未修复遗留：P11 (parseCompressionJson 脆弱), P6 (PostToolUse 待确认)

---

## 一、Agent 组成全景

管家行为设计的核心约束：**不是所有 agent 都需要管家素质**。

```
┌────────────────────────────────────────────────────────────┐
│                  前台 Agent (直接面对用户)                    │
├────────────────────────────────────────────────────────────┤
│  默认：xuanji              │ 用户指定：coder / ui-designer  │
│  长久陪伴、具备管家素质     │ 临时调用、不需要管家素质         │
│  加载: L0+L1+L2+自身sp     │ 加载: L0+L1(自己场景)+自身sp   │
├────────────────────────────────────────────────────────────┤
│                  执行 Agent (后台委派)                       │
├────────────────────────────────────────────────────────────┤
│  task 子 agent (depth=1~2) │ agent_team 成员 (协作)        │
│  临时存在，任务结束即销毁   │ 不需要管家素质                 │
│  加载: L0+L1+自身sp        │ 加载: 同左                   │
├────────────────────────────────────────────────────────────┤
│                  记忆 Agent (内部系统)                      │
├────────────────────────────────────────────────────────────┤
│  memory-manager            │ context-compressor            │
│  session-end 提取用        │ 上下文压缩用                  │
│  加载: 仅自身 systemPrompt  │ 加载: 仅自身 systemPrompt    │
└────────────────────────────────────────────────────────────┘
```

### 各 Agent 的 Prompt 构成

```
                        xuanji    coder    task子agent  记忆agent
──────────────────────────────────────────────────────────────────
L0 身份/安全/协议           ✅        ✅        ✅          ❌
L0 记忆操作规则              ✅        ✅        ✅          ❌
L0 主agent调度规则          ✅        ❌        ❌          ❌
L1 场景心智模型              ✅        ✅        ✅          ❌
L2 复杂执行流程              ✅        ❌        ❌          ❌
自身 systemPrompt          xuanji   coder    委派时传     专用
buildContext 完整注入       ✅        ❌        ❌          ❌
buildContext 轻量检索       —         ✅        ✅          ❌
──────────────────────────────────────────────────────────────────
合计 tokens                ~6300    ~3400     ~3500        ~500
```

### 关键推论

1. **管家素质 = xuanji.yaml 的 systemPrompt**。用户换前台 agent 时，该 agent 加载自己的 yaml，管家人格**天然不会污染子 agent 或临时前台**
2. **buildContext 按 agentId 分级**：
   - xuanji 前台：完整注入（提醒 + 话题 + 画像 + 行为上下文）
   - 其他前台：仅注入通用记忆检索结果，不含行为引导

---

## 二、Prompt 架构

### 2.1 三层模型

管家行为相关的内容**不放在 L0/L1/L2 的某一层**，而是横跨 `xuanji.yaml` 的 systemPrompt 和 buildContext 动态注入。

```
xuanji 前台时的完整 Prompt：

┌── L0 系统层 (~2700t) ──────────────────────────────────┐
│  身份(l0-identity) / 安全(l0-safety) / ReAct 纪律       │
│  (l0-react-rules) / agent 协议(l0-agent-protocol)      │
│  调度规则(l0-main-agent) / 记忆操作(l0-base-memory-guide)│
│  所有 agent 共享                                        │
├── L1 场景层 (~300t) ───────────────────────────────────┤
│  当前场景的心智模型（如 discuss、coding）                │
│  当前前台 agent 共享                                    │
├── L2 执行层 (~500t) ───────────────────────────────────┤
│  复杂策略协调（仅 complex 复杂度加载）                   │
├── xuanji.yaml systemPrompt (~2000t) ───────────────────┤
│  角色定义 + 管家人格 + 主动行为原语 + 沉默规则           │
│  仅 xuanji agent 加载                                   │
├── buildContext 动态注入 (~800t) ───────────────────────┤
│  到期提醒 + 话题延续 + 用户画像 + 行为偏差 + 活跃上下文   │
│  xuanji 前台完整注入，其他前台仅活跃上下文               │
└────────────────────────────────────────────────────────┘
```

### 2.2 xuanji.yaml systemPrompt 增强方案

在现有 systemPrompt 的 `## 工作原则` 章节之后，追加以下三个段落（~500t）：

```
## 管家关系

你是用户的长期伙伴（非一次性工具）。用户使用越久，你应该越了解用户。

- **语调**：可靠的同事，平实、直接、温暖但不过度亲昵。不要用
  "温馨提醒您"式模板
- **来源透明**：提及旧讨论时自然地附上时间（"你 5/12 提过…"），
  不要说"根据我的记录"——用户信任自然提及，不信任数据库语气
- **主动但不黏人**：沉默也是策略。不确定该不该说时，不说
- **纠错态度**：记错时直说"这个我记错了，我更新一下"。
  用户会信任能自我修正的助手
- **隐私边界**：健康记录、财务数据、社交评价等信息你存储
  但仅在用户主动提起时才讨论

## 主动行为（每次对话最多一个主动行为）

【提醒】时间到期的内容，简洁告知。"明天下午 3 点有会"。
不要用"温馨提醒您明天下午三点有一个会议需要您参加"。

【关联】当前话题与旧话题有明显关联时自然连接。不确定关联度
时不说。知道来源时间时附上："你 5/12 提过的某某问题，
 跟现在这个场景类似"。

【偏好】应用已知偏好时不刻意强调"我记得你…"。如果推荐内容
不符合偏好，自然转向。

【跟进】上次聊过且用户有兴趣但无下文的话题可以温和问一句。
用户说"不用了"则更新记录。

【观察】用户行为模式有明显变化时温和表达关注。只描述事实不
加判断。用户否认则停止。

沉默规则：用户正在密集操作时仅紧急提醒。
  用户连续忽略同类提醒 → 不再主动提。
  同一条内容每条对话只出现一次。

## 记忆纪律

每次对话自动搜索和存储记忆。
- 搜索：使用 memory_search 搜当前话题 + 活跃上下文
- 存储：发现长期价值信息后自动调用 memory_store。信息类型
  包括偏好、决策及理由、操作经验、人际关系、目标计划、用户纠正

不要问用户"需要记住吗"——你判断，直接存。
```

### 2.3 buildContext 注入流程（权威定义）

```
MemoryManager.buildContext()
  │
  ├── Stage A: ContextSignalCollector（纯统计，无 LLM）
  │    ┌─────────────────────────────┬──────────────────┐
  │    │ 信号                        │ 计算方式          │
  │    ├─────────────────────────────┼──────────────────┤
  │    │ 对话频率                    │ 最近 5 分钟消息数  │
  │    │ 消息长度                    │ 用户消息平均字符数  │
  │    │ 工具调用密度                │ 最近 5 条中 tool%  │
  │    │ 上次活跃间隔                │ now - lastActive  │
  │    │ 当前场景                    │ 场景分类器输出     │
  │    └─────────────────────────────┴──────────────────┘
  │    → 注入 LLM：{ workFlow: true, toolDensity: 0.8, ... }
  │
  ├── Stage B: 记忆检索（语义 + FTS5 RRF 融合，可跳过）
  │    SemanticIndex.search(currentQuery, top=5)
  │    FTS5.search(currentQuery, top=5)
  │    融合策略: Reciprocal Rank Fusion (RRF, k=60)
  │      每条结果: score = 1/(k + rank_semantic) + 1/(k + rank_fts)
  │      按 score 降序取 top-5
  │    → 注入：关联记忆（相似度由 LLM 判断，无硬阈值）
  │
  ├── Stage C: 时间锚点检查（不可跳过）
  │    TimelineInference.checkUpcoming(windowHours=24)
  │    上限 3 条，~150t
  │
  ├── Stage D: 用户画像摘要（不可跳过）
  │    SELECT * FROM user_profile
  │    按 confidence DESC 取 top-5，~200t
  │
  ├── Stage E: 待跟进话题（仅 xuanji，可跳过）
  │    TopicContinuity.getPendingTopics(limit=3)
  │    仅 status='open' AND priority>=3，~150t
  │
  └── Stage F: 行为偏差（仅 xuanji，可跳过）
      PatternRecognizer.detectAnomalies(severity='high')
      首次观察不说，第二次才注入，~100t

Token 预算控制:
  上限 800t，超限时按 F → E → B 顺序向前剪枝。
  C（时间锚点）和 D（用户画像）不可跳过。

注入占比:
  Stage C+D 固定 ~350t
  Stage B+E+F 浮动 0~450t
```

---

## 三、存储层

### 3.1 现有表扩展（增量迁移 v11）

```sql
-- 置信度：所有可记忆对象增加置信度曲线
ALTER TABLE entities ADD COLUMN confidence      REAL NOT NULL DEFAULT 0.6;
ALTER TABLE entities ADD COLUMN evidence_count  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE facts    ADD COLUMN confidence      REAL NOT NULL DEFAULT 0.6;
ALTER TABLE facts    ADD COLUMN evidence_count  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE relations ADD COLUMN confidence      REAL NOT NULL DEFAULT 0.6;
ALTER TABLE relations ADD COLUMN evidence_count  INTEGER NOT NULL DEFAULT 1;

-- 社交增强
ALTER TABLE relations ADD COLUMN interaction_count    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE relations ADD COLUMN last_interaction_at  INTEGER;
ALTER TABLE relations ADD COLUMN role_context         TEXT;  -- 'work' | 'life' | 'sports' | ...

CREATE INDEX IF NOT EXISTS idx_facts_confidence       ON facts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_relations_confidence   ON relations(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_entities_confidence    ON entities(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_relations_interaction  ON relations(interaction_count DESC);
```

### 3.2 新增表

#### time_anchors — 时间锚点

```sql
CREATE TABLE IF NOT EXISTS time_anchors (
  id              TEXT PRIMARY KEY,
  anchor_type     TEXT NOT NULL,       -- 'deadline' | 'schedule' | 'periodic' | 'context_expiry'
  target_type     TEXT NOT NULL,       -- 'entity' | 'fact' | 'event' | 'relation'
  target_id       TEXT NOT NULL,
  trigger_time    INTEGER,             -- deadline/schedule 专用
  cron_expr       TEXT,                -- periodic 专用
  grace_minutes   INTEGER DEFAULT 0,
  last_triggered  INTEGER,
  is_active       INTEGER DEFAULT 1,
  reason          TEXT,                -- 提醒内容描述
  conflict_group  TEXT,                -- 同组不视为冲突（如"同一个项目"下两个deadline）
  priority        INTEGER DEFAULT 3,   -- 1-5
  metadata        TEXT,                -- JSON: { "depends_on": ["id1","id2"] }
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_ta_trigger ON time_anchors(trigger_time, is_active);
CREATE INDEX idx_ta_target  ON time_anchors(target_type, target_id);
CREATE INDEX idx_ta_group   ON time_anchors(conflict_group);
```

> 设计决策：`conflict_group` 和 `priority` 为独立列（比 JSON 内嵌更易索引和查询），`depends_on` 等扩展属性放 `metadata` JSON。

#### topic_tracker — 开放式话题追踪

```sql
CREATE TABLE IF NOT EXISTS topic_tracker (
  id              TEXT PRIMARY KEY,
  topic           TEXT NOT NULL,
  topic_type      TEXT NOT NULL DEFAULT 'goal',  -- 'goal' | 'plan' | 'interest' | 'decision_pending'
  source_event_id TEXT,
  status          TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'followed_up' | 'resolved' | 'abandoned'
  priority        INTEGER DEFAULT 3,
  context_summary TEXT,                -- LLM 生成的话题摘要
  mention_count   INTEGER DEFAULT 1,
  last_mentioned_at INTEGER NOT NULL,
  last_followup_at INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_tt_status    ON topic_tracker(status, priority DESC);
CREATE INDEX idx_tt_mentioned ON topic_tracker(last_mentioned_at DESC);
```

> 注意：`topic_type` 不含 `question`——判断一个疑问句是否已被后续对话解答需要深度语义理解，纯关键词无法可靠检测。`decision_pending`（待决策议题）保留，因为它往往带明确的选择表述（"选A还是B"、"要不要换"）。话题检测见 §4.3。

#### user_profile — 用户画像摘要（记忆缓存层）

```sql
CREATE TABLE IF NOT EXISTS user_profile (
  id              TEXT PRIMARY KEY,
  dimension       TEXT NOT NULL,        -- 无约束，由 LLM 自然生成维度名
                                        -- 如 'preference:food', 'goal:learning', 'habit:code'
  summary         TEXT NOT NULL,        -- LLM 定期生成的核摘要
  confidence      REAL NOT NULL DEFAULT 0.6,
  evidence_ids    TEXT,                 -- ,id,id, 格式，支撑摘要的记忆 ID
  pending_count   INTEGER DEFAULT 0,    -- 自上次更新以来新增的证据数
  last_updated_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_up_confidence ON user_profile(confidence DESC);
```

> 设计决策：**不设 UNIQUE(dimension)**。维度的粒度和数量由 LLM 自然决定。当用户说了"不吃辣"和"清淡饮食"，LLM 可以把它们合并为 `preference:diet`；当新出现"喜欢靠窗座位"时，通常不需要新增 `preference_seating`，而是追加到 food/seat 等。维度数量非预期增长时，由每周维护任务做 consolidation。

#### behavior_patterns — 行为模式

```sql
CREATE TABLE IF NOT EXISTS behavior_patterns (
  id              TEXT PRIMARY KEY,
  pattern_type    TEXT NOT NULL,        -- 'cycle' | 'routine' | 'preference'
  description     TEXT NOT NULL,
  related_entity_ids TEXT,
  confidence      REAL DEFAULT 0.5,     -- 上限 0.8
  sample_count    INTEGER DEFAULT 2,
  interval_hours  INTEGER,             -- 模式周期（小时）
  last_observed   INTEGER,
  next_expected   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_bp_expected ON behavior_patterns(next_expected);
CREATE INDEX idx_bp_type     ON behavior_patterns(pattern_type);
```

#### groups + group_members — 社交群组

> **降级说明**：初始设计中包含完整的群组管理。实际审查后认为这套逻辑对个人 AI 管家过于沉重，当前实现中 **已删除 `SocialGraph.ts` 独立类和 `groups`/`group_members` 表**。社交维度通过 `relations` 表的 `role_context` 和 `interaction_count` 两列承载，约等于一条 SQL 的成本。

```sql
-- 此段 DDL 已从 migrateV11 中移除。保留文档记录为将来可能的扩展参考。
-- 替代方案：relations 表的 role_context 列 + interaction_count 列
```

### 3.3 置信度演化规则（纯算法）

采用 Ebbinghaus 遗忘曲线模型：**刚记住时遗忘最快，之后逐渐趋缓**。

```
创建时：               confidence = 0.6, evidence_count = 1
用户显式确认：          confidence = min(1.0, +0.2), evidence_count++
间接证据：              confidence = min(1.0, +0.05), evidence_count++
用户纠错：              confidence *= 0.3
矛盾覆盖（旧记录被推翻）：confidence *= 0.5

遗忘曲线（每次后台任务执行）:
  confidence *= e^(-λ * Δt)，其中 Δt 为距离上次更新的天数

  λ 由记忆类型决定：
  ┌─────────────────┬──────┬────────────────────────────┐
  │ 记忆类型          │ λ    │ 半衰期                     │
  ├─────────────────┼──────┼────────────────────────────┤
  │ 临时事实          │ 0.1  │ ~7 天（如"下周开会"）      │
  │ 普通偏好/事实     │ 0.05 │ ~14 天（如"喜欢清淡饮食"） │
  │ 高频锁定          │ 0.01 │ ~70 天（evidence_count≥5  │
  │                   │      │ 且 confidence>0.9）       │
  │ 用户纠正（负）     │ 0.02 │ ~35 天（纠正记录遗忘更慢） │
  └─────────────────┴──────┴────────────────────────────┘

  默认 λ = 0.05，高频锁定自动切换 λ = 0.01。

触发点：
  MemoryManager.upsertEntity() / storeFact() / relate() 写入时
  deactivateRelation() / rollbackFact() 纠正时
  后台任务 decayAll() 每日执行（λ 已包含 Δt，每日运行不加速遗忘）
```

> **每日 vs 每周**：虽然后台任务每日运行，但 `e^(-λ * Δt)` 中 Δt 是距离上次更新的天数，所以每日运行和每周运行的衰减总量一致。每日运行的唯一差异是**更及时的强度调整**——如果用户今天确认了一条记忆，它立即回升 confidence，而不是等下周才生效。因此每日运行是正确的调度周期。

**写入时的置信度更新**（在 MemoryManager CRUD 方法中同步执行）：

```
upsertEntity(input):
  if (existing) {
    // 已有实体被再次提及 → 间接证据积累
    existing.confidence = min(1.0, existing.confidence + 0.05);
    existing.evidence_count += 1;
  } else {
    // 新实体 → 初始置信度
    new.confidence = 0.6;
    new.evidence_count = 1;
  }

storeFact(input):
  if (existing) {
    // 更新已有事实 → 用户可能在补充
    existing.confidence = min(1.0, existing.confidence + 0.05);
    existing.evidence_count += 1;
  } else {
    new.confidence = 0.6;
    new.evidence_count = 1;
  }

relate(input):
  new.confidence = 0.6;
  new.evidence_count = 1;

deactivateRelation():
  // 旧关系被推翻 → 大幅降置信
  old.confidence *= 0.3;

rollbackFact(title, version):
  // 回滚到对应版本，当前版本置信度降为 0.1

// 用户反馈闭环（由 LLM 在检测到用户反应后调用 memory_store）：
// scene_tag = '反馈' 且 content 含 'positive' → +0.2, evidence_count++
// scene_tag = '反馈' 且 content 含 'negative' → *0.3
```

> **设计原则**：置信度更新全部在 CRUD 方法中同步完成，不依赖后台任务或额外事件监听。后台任务只负责**衰减**，不负责**回升**。

---

## 四、记忆录入管道（Recording Pipeline）

> 新增章节。回答：数据是怎么进入存储层的？什么时候记、记什么、
> 怎么保证质量。

### 4.1 管道总览

```
                    触发层                         提取/处理层                  存储层
    ┌─────────────────────────────┐
    │  实时触发（对话中）           │
    │  ├─ 用户显式声明偏好         │──→ memory_store tool ──────→ entities/facts/relations
    │  ├─ 用户做出决策+理由        │
    │  ├─ 用户纠正                │
    │  └─ LLM 检测到有价值信息     │
    │                             │
    │  session-end 触发（对话后）    │
    │  └─ extractFromSession()    │──→ memory-manager agent    ─→ entities/facts/events
    │                                  (React 循环，3 个工具)      + relations + episodes
    │                             │
    │  后台聚合触发（跨会话）        │
    │  └─ 每周维护任务              │──→ PatternRecognizer      ─→ behavior_patterns
    │                                  TopicContinuity           topic_tracker
    │                                  SocialGraph（已降级，见 §5.5） | relations.*
    │                                  ConfidenceEngine          confidence
    └─────────────────────────────┘
```

### 4.2 实时触发器（对话中）

#### 4.2.1 触发条件矩阵

| 触发条件 | 检测者 | 延迟 | 记录内容 | 示例 |
|---------|--------|------|---------|------|
| 用户声明偏好（"我…"） | LLM（memory_store） | <50ms | entities(type=preference) + relation | "我不吃辣" → entity(辣, dislike) |
| 用户做出决策+理由 | LLM（memory_store） | <50ms | event + fact(source=user_said) | "选 PostgreSQL 因为要地理查询" |
| 用户纠正 | LLM（memory_store） | <50ms | event + fact(source=user_correction) + deactivateRelation | "不对，我用的是 Docker" |
| 用户给出目标/计划 | LLM（memory_store） | <50ms | entity(type=goal) + event | "下个月去日本" |
| 用户分享人际信息 | LLM（memory_store） | <50ms | relations + group | "老张是我同事" |
| LLM 执行操作流程完成 | LLM（memory_store） | <50ms | event + episode | 部署步骤记录 |
| 用户表达开放兴趣 | LLM（memory_store） | <50ms | 触发 session-end 时 TopicContinuity 的话题检测（见 §4.3.1 Step 4） | "想学 Rust" |

#### 4.2.2 纠正触发的反向流程

实时触发后，LLM 检测到纠正意图时，**不只是存一条新事实**，还需要触发对关联旧记忆的降级。完整流程：

```
用户说"不对，我用的是 Docker 不是 Podman"

实时触发（LLM 检测到纠正）：
  ① memory_store({ type: 'fact', source: 'user_correction',
       content: "用户使用的是 Docker" })
  ② memory_search({ query: "Podman", scope: "keyword" })
     → 找到旧 entity(Podman) 和旧 relation(user → 使用 → Podman)
  ③ memory_store({ type: 'relation', action: 'deactivate',
       subject: "我", relation: "使用", object: "Podman" })
     → 触发 ConfidenceEngine: old_rel.confidence *= 0.3
  ④ memory_store({ type: 'relation',
       subject: "我", relation: "使用", object: "Docker" })
     → 触发 ConfidenceEngine: new_rel.confidence = 0.6

session-end 兜底（memory-manager agent）：
  ① memory_search 找到旧事实"用户使用 Podman"
  ② 对比用户纠正内容"用户使用的是 Docker"
  ③ 发现矛盾 → 标记旧 fact 为 is_latest=0
     → 标记旧 entity(Podman) 的 confidence *= 0.3
  ④ 存储新 fact + 创建新 entity(Docker) + 创建新 relation
```

**设计原则**：降级操作由 LLM（`memory_store` tool 的参数 `action: 'deactivate'`）或 memory-manager agent 完成，不在代码中写硬编码的"看到纠正就自动降级"逻辑。这是因为只有 LLM 能判断"这个纠正应该覆盖哪条旧记忆"——代码做不到。

#### 4.2.3 质量门控（实时）

不是所有 LLM 认为"有价值"的信息都应该入库。三个过滤器：

```
过滤器 1 — 时效性判断：
  如果 content 包含明确的时间限定词（"今天"、"这次"、"暂时"），
  且没有跨会话信号（"以后"、"一直"、"每次"）→ 标记为临时事实
  → 创建 fact 但 confidence = 0.4, decayRate λ = 0.1（7 天遗忘）
  → 不创建 topic_tracker

过滤器 2 — 语气判断：
  如果 content 是夸张/比喻/假设（"我想把月亮买下来"），
  且没有后续行动信号 → 不记录
  由 LLM 自己判断——这在 L0 prompt 中给出指导

过滤器 3 — 重复判断：
  如果与已有 memory 相似度 > 0.85（SemanticIndex），
  不创建新记录，仅 evidence_count++、confidence += 0.05
```

**实时 vs session-end 的去重联动**：
对话中 LLM 调用 `memory_store` 后，`wasMemoryStoredRecently()` 会在 `recentToolCalls` 数组中记录该操作的 `dedupKey`。session-end extraction 启动时，memory-manager agent 会先 `memory_search` 查重，而且 `wasMemoryStoredRecently()` 的 5 分钟窗口确保同一段对话不会被重复提取。两层保护：

```
LLM 实时调用 memory_store("我不吃辣")
  → recordToolCall('memory_store', dedupKey='preference:spicy')
  → 击中 SemanticIndex 去重 → evidence_count++, confidence+=0.05

2 分钟后 session-end extraction 启动
  → memory-manager agent 的 first action: memory_search("不吃辣")
  → 找到已有记录, similarity > 0.85
  → 不创建新记录, 仅更新 confidence
  → wasMemoryStoredRecently('preference:spicy', 5min) → true → 跳过
```

#### 4.2.4 实时触发在 xuanji.yaml 中的指导

在 §2.2 的 `## 记忆纪律` 段落中扩充：

```
## 记忆纪律

每次对话必须执行两阶段协议。

Phase 1 — 回复前搜索（已有）：
  memory_search({ query: "...", scope: "keyword" })
  memory_search({ scope: "active_context" })

Phase 2 — 回复后存储（增强）：
  在回复之后、进入下一个 ReAct 循环之前，评估本条对话中是否有值得记录的信息。

  必须记录的信息类型（优先级从高到低）：
  1. 【偏好】用户直接说的个人偏好——"我不吃辣"、"我习惯用 Go"
  2. 【决策】用户明确做的决策及理由——"选 X 因为 Y"、"决定改用 Z"
  3. 【纠正】用户纠正你的错误——"不对，刚才说的不准确，实际上是…"
  4. 【目标】用户表达的计划或目标——"下个月去日本"、"想学 Rust"
  5. 【人际】用户提到的人际关系——"某某是我同事"、"某某负责前端"
  6. 【操作流程】你完成的操作步骤——部署/发布/排查的完整流程

  质量门控：
  - 如果内容有明确时间限定（"今天"、"这次"）且无跨会话信号
    → 可以记录，但 confidence 降低，加快遗忘
  - 如果与已有记忆高度相似 → 不创建新记录，仅更新 confidence
  - 如果是夸张/比喻/假设 → 不记录

  不要问用户"需要记住吗"——你按照以上标准判断，直接存。
```

### 4.3 Session-End 提取器

#### 4.3.1 提取流程

```
extractFromSession(messages)
  │
  ├── 1. 拼接对话文本（现有逻辑，max 8000 chars）
  │
  ├── 2. 构建 memory-manager agent 
  │      React 循环（现有逻辑，3 tools: search/store/stats）
  │      maxIterations=5, timeout=60s
  │
  ├── 3. Agent 执行提取（核心步骤）
  │      3a. memory_search — 查重（避免重复记录）
  │      3b. 识别值得记录的信息
  │      3c. memory_store — 写入
  │
  ├── 4. TopicContinuity.extractTopics() ← 新增
  │      关键词初筛 → cheapLLM 确认 → 写入 topic_tracker
  │      与 Step 3 共享同一个 cheapLLM 实例
  │
  ├── 5. 计算增量统计（现有逻辑）
  │      entityCount / factCount / eventCount
  │
  └── 6. 发射 MEMORY_EXTRACTED 事件（现有逻辑）
```

#### 4.3.2 memory-manager agent 的 systemPrompt 设计

当前 memory-manager.yaml 已经有 systemPrompt，但它是通用的。需要增加**提取质量指导**，放到记忆提取 prompt 模板中：

当前 `memory-manager.yaml` 的 systemPrompt（摘要）：

```
# 现有内容（保留）：
你是专业的记忆管理 AI。你的任务是从对话中提取长期价值信息。
使用 memory_search 查重，memory_store 存储。
只记录用户明确表达或可合理推断的信息。
不记录临时琐事、不记录猜测。
```

**需要在 prompt 中追加的内容**：

```
## 提取优先级

按以下顺序判断信息价值：

1. **用户偏好/习惯**（最高优先级）
   识别条件：用户使用"我喜欢/习惯/喜欢/不吃/不用/偏好"等明确表述
   例子："我不吃辣"、"我习惯用 Go"、"我喜欢简洁的 API"

2. **用户决策及理由**
   识别条件：选择某方案 + 给出理由
   例子："选了 PostgreSQL 因为需要地理空间查询"
   注意：只记录决策本身和理由，不记录决策过程中的被否方案（除非用户明确说"因为 X 不好所以选了 Y"）

3. **用户纠正**
   识别条件：用户纠正你的错误或更新旧信息
   例子："不是的，那个项目已经下线了"、"我说的不是这个意思，是…"
   动作：存储纠正事实 + 标记旧相关实体/事实为低置信度

4. **用户目标/计划**
   识别条件：有明确的时间维度和行动意图
   例子："下个月重构支付系统"、"想学 Rust"
   排除：当前会话内的操作步骤（"先写好接口"）

5. **人际关系**
   识别条件：明确的角色/关系描述
   例子："老张是我同事，负责前端"

6. **操作经验**
   识别条件：你执行了多步操作并成功
   例子：完整部署流程、故障排查步骤

## 质量门控

- 【不记录】临时事务（"这周要改个需求" → 不应该进入长期记忆）
- 【不记录】比喻/夸张/假设（"想把服务器扔了"）
- 【不记录】纯任务对话（"帮我打开这个文件"、"运行那个测试"）
- 【标记为临时】有时间限定词("今天"、"这次")且无跨会话信号 → confidence=0.4, 高衰减
- 【去重】与已有记忆相似度>0.85 → 不创建新记录，更新 confidence+0.05
- 【关联】提到的人物优先匹配已有 entities 以建立关系连接
```

#### 4.3.3 人物指代消解

一个常见问题是"老张"和"张经理"是不是同一个人。memory-manager agent 的指导：

```
## 指代消解规则（写入 memory-manager.yaml 的 systemPrompt）

当提取内容中出现人物名称时：

1. 精确匹配：如果 entities 表中已有完全相同的 name → 直接关联
2. 相似匹配：如果 entities 表中 name 包含提取名称的任意部分
   → 优先以已有 entity 为准，不要创建重复
3. **同姓 + 同群组推断**（注意：纯同姓不足以推断为同一人）：
   a. 必须同时满足：同姓 + 同群组（group_members）+ 同场景（scene_tag）
   b. 或：同姓 + relation 表中已有 relation 连接
   c. 满足以上任一条件 → 视为同一人，新增 relation 建立连接
   d. 不满足 → 创建新 entity，由后续会话自然合并
4. 你（用户）→ 始终映射到 user entity（已有根节点）
```

#### 4.3.4 提取失败处理

```
Agent 超时（60s）→ 日志警告，不阻塞会话返回
Agent 执行过程中某条 memory_store 失败 → 跳过，继续执行下一条
Agent 所有调用都失败 → 不阻塞 extractFromSession 的 return
```

### 4.4 跨会话聚合提取

有些信息在单次会话中不显现，跨会话才能形成：

| 提取器 | 触发时机 | 输入 | 输出 |
|--------|---------|------|------|
| PatternRecognizer | 每日 | events 表（仅 user_said/archive） | behavior_patterns |
| TopicContinuity | 每日 | events → 话题检测 | topic_tracker 状态更新 |
| 社交维度 | 无需独立任务 | relations 写入时自增 | role_context / interaction_count |
| ConfidenceEngine | 每日 | 所有表 | confidence 衰减 |

这些不是"实时"的——它们由调度器驱动，是**数据质量维护**而非**记忆录入**。

### 4.5 各层之间的数据流向

```
LLM 对话
  │
  ├── 实时触发 → memory_store → entities/facts/relations/events
  │                              → 置信度写入（CRUD 内）
  │                              → pending_count++（user_profile）
  │
  ├── session-end → extractFromSession()
  │                  ├── memory-manager agent → entities/facts/events/relations
  │                  └── TopicContinuity.extractTopics()
  │                       ├── 关键词初筛
  │                       └── cheapLLM 确认 → topic_tracker
  │
  └── 后台调度器
       ├── 每日: confidence *= e^(-λΔt)
       │           PatternRecognizer.extract() → behavior_patterns
       │           TopicContinuity.markStale() → topic_tracker status
       └── 每周: user_profile 更新（pending_count >= 3 的维度）
                   社交维度 role_context 列由 LLM 写入
```

### 4.6 与现有系统集成

**影响到的现有文件**：

| 文件 | 变更 |
|------|------|
| `memory-manager.yaml` | systemPrompt 精简（删除与 `l0-base-memory-guide.yaml` 重复的提取指导） |
| `MemoryManager.ts` | `extractFromSession()` 增加 `TopicContinuity.extractTopics()` 调用 |
| `MemoryManager.ts` | `storeFact()`/`upsertEntity()` 增加 `pending_count++` 逻辑 |
| `ChatSession.ts` | **删除 `detectCorrection()`**（41 行硬编码正则 + 调用） |

**读权限修正**：所有前台 agent（coder、stock-analyst 等）应增加 `memory_search` 工具，使其在切换到前台时能感知记忆上下文。`memory_store` 不开放——只有 xuanji 和 memory-manager 写入记忆。

| agent yaml | 变更 |
|-----------|------|
| `software-engineer.yaml` | tools 增加 `memory_search` |
| `stock-analyst.yaml` | tools 增加 `memory_search` |
| `ui-designer.yaml` | tools 增加 `memory_search` |
| `product-manager.yaml` | tools 增加 `memory_search` |

**不影响**：
- L0/L1/L2 YAML 组件不需要修改
- 子 agent 不需要修改（子 agent 不执行记忆读写）
- buildContext 不需要修改（录入和检索是分离的）

### 4.7 已清理的技术债：`detectCorrection()`

**问题**：`ChatSession.ts` 第 316-346 行存在一个硬编码的 `detectCorrection()` 方法，用 3 条正则检测用户纠正意图：

```typescript
const correctionPatterns = [
  /(?:不对|不是|错了|错误|更正|纠正)(?:\s*[，,]\s*)(.+)/,
  /(?:应该说?|正确(?:的|说法)?是?|应该是)\s*(.+)/,
  /(?:记住|记着|别忘了|以后)\s*(.+)/,
];
```

命中后直接调 `storeFact()` 写入记忆，**绕过了 `memory_store` tool 的整个链路**（去重检查、SemanticIndex、反馈日志）。

**为什么它是技术债**：
1. 正则覆盖不全 — "你搞错了"、"我说的是 A 不是 B" 都命中不了
2. 绕过去重 — `memory_store` tool 有 `wasMemoryStoredRecently()` 检查，但 `detectCorrection` 直接写 `storeFact()`，无去重
3. 重复劳动 — LLM 在 L0 prompt 中已被指导检测纠正并 `memory_store`；session-end extraction 的 memory-manager agent 也会兜底
4. 脏引用 — 通过 `(contextManager as any).archiveDelegate` 获取 MemoryManager，类型不安全

**修复**：删除整个 `detectCorrection()` 方法及其调用点（ChatSession.ts 删 41 行）。纠正检测职责还给 LLM：

```
用户纠正 "不是那样，是 XX"
  │
  └── LLM 在 L0 prompt 指导下检测到纠正意图
       ├── 实时: memory_store({ source: 'user_correction' })
       └── 兜底: session-end extraction
            └── memory-manager agent 分析对话
                 └── TopicContinuity.extractTopics()
```

**不影响**：其他两条触发链路（LLM 主动存储 + session-end extraction）保持不变。

---

## 五、推理引擎层

### 5.1 新文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `TimelineInference.ts` | ~200 | time_anchors CRUD + 到期检查 + 冲突检测 |
| `TopicContinuity.ts` | ~200 | topic_tracker 话题检测 + 状态管理 |
| `PatternRecognizer.ts` | ~250 | events 表模式提取 + 偏差检测 |

**ConfidenceEngine 不独立成文件**：置信度是 entities/facts/relations 的行列属性，直接在 `MemoryManager` 的 CRUD 方法中写入。

**SocialGraph 不独立成文件**：社交维度通过 `relations` 表的 `role_context` 和 `interaction_count` 两列承载（migrateV11 中已增加），查询走通用 `getRelations()` + `role_context` 过滤，不需要独立类。

### 5.2 TimelineInference

```typescript
class TimelineInference {
  constructor(private db: Database.Database) {}

  // 注册时间锚点（由 memory_store 或 events 写入时触发）
  async addAnchor(input: TimeAnchorInput): Promise<TimeAnchor>;

  // 检查到期提醒（buildContext Stage C 调用）
  async checkUpcoming(windowHours?: number): Promise<Reminder[]>;

  // 冲突检测
  async detectConflicts(anchorId: string): Promise<Conflict[]>;
}

interface Reminder {
  anchorId: string; targetId: string;
  description: string;  // 来自 reason 字段
  triggerIn: number;    // ms
  conflictGroup?: string;
  priority: number;
}
```

### 5.3 TopicContinuity

```typescript
class TopicContinuity {
  constructor(
    private db: Database.Database,
    private cheapLLM?: CheapLLM,     // 仅用于话题确认
    private semanticIndex?: SemanticIndex,
  ) {}

  // 从会话中检测开放式话题
  // 调用方：MemoryManager.extractFromSession() 的 finally 阶段
  // （与事件/事实提取并行，不阻塞返回）
  async extractTopics(messages: any[]): Promise<TopicSignal[]>;

  // 获取待跟进话题（buildContext Stage E 调用）
  async getPendingTopics(limit: number): Promise<PendingTopic[]>;
}
```

**调用方**：`MemoryManager.extractFromSession()`（session-end extraction 现有方法）在完成实体/事实/事件提取后，调用 `TopicContinuity.extractTopics(messages)`。使用同一个 `cheapLLM` 实例，不需要独立连接。错误处理：`extractTopics` 失败时不阻塞 `extractFromSession` 返回，仅打 warn 日志。

**话题检测流程**：

```
① 关键词初筛（纯统计，零成本）
   关键词集: ["想", "打算", "考虑", "要不要", "有空去/来", "找个时间"]
   排除集（操作性表述）:
     "看看"+"文件/代码/日志/函数/参数"  → 当前任务
     "试一下"+"方案/方法/工具"          → 技术决策（非话题）
     "帮我看/做"+"代码/任务/文件"       → 当前任务

② cheapLLM 确认（session-end，异步，不阻塞）
   输入: 命中的消息原文
   判断: "这是一个人生目标/计划/兴趣的表述，还是当前任务操作？"
   → LLM 确认后才写入 topic_tracker

③ 优先级
   topic_type = 'goal' → priority 4-5
   topic_type = 'plan' → priority 3-4
   topic_type = 'interest' → priority 2-3
   topic_type = 'decision_pending' → priority 3-4

④ 生命周期
   open → 用户主动推进 → 更新为 resolved
   open → 用户说"不用了" → abandoned
   open → 连续 3 次会话未被提及 → abandoned
   follow_up → 用户回应"还没顾上" → back to open
```

### 5.4 PatternRecognizer

```typescript
class PatternRecognizer {
  constructor(private db: Database.Database) {}

  // 从 events 表提取模式（每日运行，不每周）
  async extractPatterns(): Promise<PatternExtraction[]>;
  // 检测预期行为缺失（每日运行）
  async detectMissedBehaviors(): Promise<MissedBehavior[]>;
}
```

**提取规则**（纯算法，无 LLM）：

```
只扫描 events 表中的用户行为事件（operator = 'user' 或 'archive'，排除 tool call 事件）。
cycle:   同一事件 ≥3 次，间隔均匀（±20%）
routine: 同一事件固定时段出现 ≥2 次（如每天 09:00）
preference: 连续选择同一选项 ≥2 次

confidence 上限 0.8（保留不确定性给 LLM 决策）
```

**每日运行**（非每周）的原因：daily routine 的偏差检测需要小时级精度。每周一次会导致"连续错过 2 次"= 2 周延迟，失去管家的及时性。

### 5.5 社交维度

社交维度**不设独立类**，通过 `relations` 表的 `role_context` 和 `interaction_count` 两列承载：

- `role_context` — 关系语境（'work' / 'life' / 'sports'），由 LLM 在调用 `relate()` 时写入。查询走 `MemoryManager.getRelations()` + `role_context` 过滤
- `interaction_count` — 在 `relate()` 写入时自动 +1。无独立维护任务

**降级原因**：初始设计中包含完整的 `SocialGraph.ts` 独立类、`groups` + `group_members` 表、每周社交强度评估。审查后认为这套逻辑更适合 CRM 场景，对个人 AI 管家过于沉重。两个列带来的数据足以支持"这个人跟我是工作关系还是朋友"这类查询。

### 5.6 buildContext 配套：ContextSignalCollector

新加的一个**轻量统计模块**，在 buildContext Stage A 执行：

```typescript
// 纯统计，无 LLM，<1ms
class ContextSignalCollector {
  collect(messages: any[], lastActiveAt: number): ContextSignals;
}

interface ContextSignals {
  dialogFrequency: 'low' | 'medium' | 'high';
    // last5min 消息数: <3=low, 3-10=medium, >10=high
  messageLength: 'short' | 'normal' | 'long';
    // 用户最近消息平均字符: <50=short, 50-500=normal, >500=long
  toolDensity: 'low' | 'medium' | 'high';
    // 最近 5 条消息 tool 占比: <20%=low, 20-60%=medium, >60%=high
  idleHours: number;
    // now - lastActiveAt / 3600000
  currentScene: string;
    // 场景分类器输出（已有）
}
```

这些信号注入 system prompt 后，LLM 自行决定介入程度，不在代码层做 if/else 判断。只在 buildContext 的剪枝逻辑（Stage F/E 是否跳过）使用 `toolDensity`（高密度时跳过主动行为注入）。

---

## 六、调度器集成

### 6.1 后台任务

| 任务 | 周期 | 耗时 | 说明 |
|------|------|------|------|
| 置信度衰减 | 每日 | <100ms | confidence *= e^(-λ * Δt)，ΔT 为距上次更新天数 |
| 行为模式提取 | 每日 | <500ms | scan events（仅 user_said/archive 事件），纯算法 |
| 用户画像更新 | 每周 | <500ms | 检查 `user_profile.pending_count >= 3` 的维度，触发 cheapLLM 重新生成 summary，更新后 `pending_count = 0` |
| 社交强度评估 | 每周 | <200ms | update interaction_count |
| 话题静默标记 | 每日 | <50ms | 3次未提及 → abandoned |

> **pending_count 递增**：在 `MemoryManager.storeFact()` 和 `upsertEntity()` 中，如果写入的 entity/fact 的 `scene_tag` 或 `type` 匹配已有 `user_profile.dimension`（前缀匹配，如 `preference:diet` 匹配 `preference:food`），则 `pending_count += 1`。无需 LLM，纯字符串前缀匹配。

### 6.2 调度器注册

```typescript
// system: true 防止用户误删
Scheduler.addCronJob({
  schedule: '0 3 * * *',     // 每天 03:00
  action: 'custom',
  prompt: '执行每日记忆维护：置信度衰减、行为模式提取、话题静默标记',
  system: true,
});
Scheduler.addCronJob({
  schedule: '0 4 * * 1',     // 每周一 04:00
  action: 'custom',
  prompt: '执行每周记忆维护：用户画像更新、社交强度评估',
  system: true,
});
```

### 6.3 CareManager 与 TimelineInference 的分工

最终版保留 CareManager，明确分工：

| 能力 | CareManager | TimelineInference |
|------|------------|-------------------|
| 纪念日（月-日匹配 events） | ✅ `buildDailyCare()` | ❌ |
| 时间感知（idle 时间间隔） | ✅ `buildTimeAwareness()` | ❌ |
| 精确到期提醒（deadline/schedule） | ❌ | ✅ `checkUpcoming()` |
| 周期事务（每周二倒垃圾） | ❌ | ✅ `addAnchor(periodic)` |
| 冲突检测（同时段多个事务） | ❌ | ✅ `detectConflicts()` |

CareManager 负责"今天是什么日子"（回顾性），TimelineInference 负责"接下来有什么事"（前瞻性）。两者在 buildContext 中互补：Stage C（TimelineInference）+ 已有 CareManager 的纪念日注入，互不冲突。

### 6.4 cheapLLM 接口定义

系统中已有的 `CheapLLMProvider`(`src/core/providers/CheapLLMProvider.ts`)：

```typescript
interface CheapLLM {
  complete(prompt: string): Promise<string>;
}
```

配置：低 temperature (0.3)、低 maxTokens (1024)。当前使用 deepseek-v4-pro，未来可换本地模型或 haiku。

使用位置：
- `TopicContinuity.extractTopics()` → 确认话题意图
- `user_profile` 定期更新 → 生成维度摘要
- `SessionFactory` 初始化时注入 MemoryManager

---

## 七、行为层

### 7.1 行为原语

五种主动行为，定义在 `xuanji.yaml` 的 systemPrompt 中（§2.2）。每种原语的**触发条件和沉默规则**由以下配合保障：

| 原语 | 触发数据源 | 沉默剪枝者 |
|------|-----------|-----------|
| 提醒 | TimelineInference.checkUpcoming() | buildContext Stage C（不可跳过） |
| 关联 | SemanticIndex search（无阈值，top-5） | buildContext Stage B（LLM 自判） |
| 偏好 | user_profile + searchEntitiesWithGraph | buildContext Stage D（LLM 自判） |
| 跟进 | TopicContinuity.getPendingTopics() | buildContext Stage E（仅 xuanji） |
| 观察 | PatternRecognizer.detectMissed() | buildContext Stage F（仅 high+首次跳过） |

### 7.2 情境敏感度

不写代码判断矩阵。ContextSignalCollector 将 5 个统计信号注入 prompt，LLM 自行决定介入程度。prompt 中的指导：

```
当前对话信号：工具调用频率{toolDensity}、
  对话节奏{dialogFrequency}、消息长度{messageLength}
用户高频操作时，仅做必要的提醒。日常闲聊时可以更主动。
```

### 7.3 学习反馈闭环

用户对主动行为的回应 → events 表记录（`scene_tag: ',feedback,'`）：

```typescript
// LLM 检测到用户反应后调用 memory_store
memory_store({
  type: 'event',
  data: {
    content: '用户对[reminder:xxx]的回应: positive — 用户说"好的"',
    entityNames: ['user', '管家行为反馈'],
    importance: 2,
    scene_tag: '反馈',
  }
})
```

每周后台任务：扫描 `events WHERE scene_tag LIKE '%,反馈,%'` → 按行为类型聚类 → 动态调整优先级权重（连续 3 次 negative → 降级）。

---

## 八、审计遗留项确认

| ID | 问题 | 状态 | 对本文影响 |
|----|------|------|-----------|
| P7 | 推演引擎死代码 | ✅ 已删 | 数据层干净 |
| P1 | Event 版本链 | ✅ SSOT | 无影响 |
| P2 | SemanticIndex 写入 | ✅ 追加+compact | 正常使用 |
| P3 | relation_changes ID | ✅ 已修 | 正常使用 |
| P5 | Level 3 丢失 | ✅ 持久化 | 正常使用 |
| P8 | 语义内容截断 | ✅ 回查源表 | 正常使用 |
| P9 | access_count 无限 | ✅ cap+decay | 正常使用 |
| P10 | 叙事记忆重复 | ✅ 60s 窗口 | 正常使用 |
| P12 | BFS O(N) | ✅ Set | 正常使用 |
| P13 | 分层 prompt 注入 | ✅ 属性注入 | **memory-manager agent 创建时仍手动构造 systemPrompt，未使用 LayeredPromptBuilder。** 不影响本设计，但建议后续修 |
| P11 | parseCompressionJson 脆弱 | 🔲 未修 | context-compressor agent 输出格式脆弱。建议先加 ```` 代码块提取降级 |
| P6 | PostToolUse 链路 | 🔲 待确认 | 需确认 HookRegistry 初始化状态 |

**对 Phase 1 的影响**：P11 和 P6 不影响新设计。P13 是优化项。

---

## 九、升级实施计划

### 9.1 总览

整个升级分为 6 个 Phase + 1 个预备 Phase，共约 10 天。

```
Phase 0 (0.5d)  预备：清理已知技术债
    ↓
Phase 1 (0.5d)  Prompt 增强：管家人格上线
    ↓
Phase 2 (1.5d)  存储层：迁移 v11 + 新表 DDL
    ↓
Phase 3 (1d)    时间感知：TimelineInference + buildContext Stage C
    ↓
Phase 4 (1d)    话题延续：TopicContinuity + buildContext Stage E
    ↓
Phase 5 (1.5d)   推理引擎：PatternRecognizer + 社交列运维 + 调度任务
    ↓
Phase 6 (2d)    行为层：记忆录入管道完善 + ContextSignalCollector + 行为原语对齐
```

每个 Phase 的设计原则：
- **可独立上线** — 每个 Phase 完成即可部署，不依赖后续 Phase
- **向后兼容** — 新表/新列通过 migrateV11 增量迁移，不影响旧数据
- **可回滚** — 每个 Phase 的代码变更不超过 3 个文件

---

### 9.2 Phase 0 — 预备：清理已知技术债

**工作量**: 0.5d | **已完成**: `detectCorrection()` 删除（ChatSession.ts -41 行）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 00. ✅ 删除 `detectCorrection()`（3 条正则 + 调用） | `ChatSession.ts` | 已做 |
| 01. fix P11: parseCompressionJson 增加 ``` 代码块提取降级 | `MemoryManager.ts` parseCompressionJson | 0.25d |
| 02. verify P6: 审计 `wasMemoryStoredRecently` dedupKey 传递路径 | `MemoryStoreTool.ts` + `ChatSession.ts` | 0.25d |

**验收标准**：
- P11: context-compressor agent 输出 markdown 混合 JSON 时不再静默降级
- P6: 确认 PostToolUse 兜底链路的 `dedupKey` 参数正确传递

---

### 9.3 Phase 1 — Prompt 增强：管家人格上线

**工作量**: 0.5d | **不涉及代码变更**，纯 prompt 工程

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 1.1 追加管家人格段落 | `xuanji.yaml` systemPrompt（§2.2 的三个段落） | 0.25d |
| 1.2 增强记忆纪律段落 | `xuanji.yaml` systemPrompt（§4.2.4 的 Phase 2 指导） | 0.25d |

**验收标准**：
- xuanji 前台对话中，回复语气更自然（附时间来源、不刻意说"我记得"）
- 纠正检测不再依赖正则，走 LLM 语义判断
- 其他 agent（coder / ui-designer）前台时无变化（不加载 xuanji.yaml）

**回滚方案**：恢复 `xuanji.yaml` 的旧 systemPrompt。纯文本变更，无数据影响。

---

### 9.4 Phase 2 — 存储层：迁移 v11 + 新表 DDL

**工作量**: 1.5d | **数据层变更，0 风险回滚**

| 任务 | 文件 | 工作量 | 步骤 |
|------|------|--------|------|
| 2.1 新增 migrateV11 DDL | `MemoryManager.ts` | 0.5d | 写 DDL（7 条 ALTER TABLE + 5 张新表 + 索引），放在 `migrateV10` 之后 |
| 2.2 置信度写入逻辑 | `MemoryManager.ts` | 0.5d | 在 `upsertEntity()` / `storeFact()` / `relate()` / `deactivateRelation()` / `rollbackFact()` 中增加 confidence + evidence_count 更新逻辑 |
| 2.3 pending_count 递增 | `MemoryManager.ts` | 0.25d | 在 `storeFact()` / `upsertEntity()` 中增加 `user_profile.pending_count++` 逻辑（前缀匹配 dimension） |
| 2.4 新增类型定义 | `types.ts` | 0.25d | 新增 `TimeAnchor` / `UserProfile` / `BehaviorPattern` / `Group` / `GroupMember` / `TopicTracker` 接口 |

**费用计算**: 5 张新表，按平均每张 200 条记录估算，SQLite 新增 ~50KB。现有 memory.db 通常在 1-5MB，总体增长 <10%。

**验收标准**：
- 启动时 migrateV11 成功执行，schema_version = 11
- 执行 `memory_store({ type: 'fact', ... })` 后，facts 表 confidence = 0.6
- 执行同一条 `memory_store` 两次后，evidence_count = 2
- `user_profile` 表在相关写入后 `pending_count` 递增

**回滚方案**：
```sql
-- 降级到 v10 的 DDL（保留表和数据，只删索引确保下次迁移幂等）
DROP INDEX IF EXISTS idx_facts_confidence;
DROP INDEX IF EXISTS idx_relations_confidence;
DROP INDEX IF EXISTS idx_entities_confidence;
DROP INDEX IF EXISTS idx_relations_interaction;
DELETE FROM schema_version WHERE version = 11;
```
新表（`time_anchors` / `topic_tracker` / `user_profile` / `behavior_patterns`）的数据有则保留，无则空表不影响旧逻辑。

---

### 9.5 Phase 3 — 时间感知：TimelineInference

**工作量**: 1d | **新文件，无侵入**

| 任务 | 文件 | 工作量 | 步骤 |
|------|------|--------|------|
| 3.1 新建 TimelineInference | `src/core/memory/TimelineInference.ts` | 0.5d | 实现 `addAnchor()` / `checkUpcoming()` / `detectConflicts()` |
| 3.2 注入 MemoryManager | `MemoryManager.ts` | 0.25d | MemoryManager 新增 `timelineInference` 属性，init() 时创建 |
| 3.3 buildContext Stage C | `MemoryManager.ts` `buildContext()` | 0.25d | 调用 `timelineInference.checkUpcoming(24)`，注入结果到 prompt |

**验收标准**：
- 通过 `memory_store` 写入一条带时间锚点的事实后，`time_anchors` 表有记录
- 会话开头，如果 24 小时内有到期事务，prompt 中出现 `【提醒】` 段
- 冲突检测：同一时间段的两个锚点被标记为冲突

---

### 9.6 Phase 4 — 话题延续：TopicContinuity

**工作量**: 1d | **新文件 + extractFromSession 增强**

| 任务 | 文件 | 工作量 | 步骤 |
|------|------|--------|------|
| 4.1 新建 TopicContinuity | `src/core/memory/TopicContinuity.ts` | 0.5d | 实现 `extractTopics()`（关键词初筛 + cheapLLM 确认）/ `getPendingTopics()` / `markStale()` |
| 4.2 注入 MemoryManager | `MemoryManager.ts` | 0.25d | MemoryManager 新增 `topicContinuity` 属性，init() 时创建 |
| 4.3 extractFromSession 集成 | `MemoryManager.ts` `extractFromSession()` | 0.25d | 在提取完成后调用 `topicContinuity.extractTopics(messages)` |

**验收标准**：
- 会话包含"想学 Rust" → session-end 后 `topic_tracker` 新增一条 `status=open` 记录
- 会话包含"帮我看下这个报错" → 不被创建为话题
- 连续 3 次会话未提及某话题 → `status` 变为 `abandoned`

---

### 9.7 Phase 5 — 推理引擎 + 调度任务

**工作量**: 1.5d | **两个新文件 + Scheduler 增强**

| 任务 | 文件 | 工作量 | 步骤 |
|------|------|--------|------|
| 5.1 新建 PatternRecognizer | `src/core/memory/PatternRecognizer.ts` | 0.75d | 实现 `extractPatterns()`（只扫 user_said/archive event）/ `detectMissedBehaviors()` / 每日调度 |
| 5.2 relations 社交列运维 | `MemoryManager.ts` | 0.25d | `interaction_count` 在每次 `relate()` 写入时 +1，`role_context` 由 LLM 通过 `memory_store` 写入。**不设 SocialGraph 独立类、不设 groups/group_members 表** |
| 5.3 user_profile 更新任务 | `MemoryManager.ts` 或新文件 | 0.25d | 每周任务：查 `pending_count >= 3` → cheapLLM 生成摘要 → 更新 `summary` + `pending_count = 0` |
| 5.4 调度器注册 | `SessionFactory.ts` 或 `Scheduler.ts` | 0.25d | 注册 2 个 system cronjob（每日 + 每周） |
| 5.5 confidence 衰减任务 | `MemoryManager.ts` | 0.25d | `decayAll()` 方法实现 Ebbinghaus 指数衰减 |

**社交图谱降级说明**：最初设计中包含 `SocialGraph.ts` 独立类、`groups` + `group_members` 表、每周社交强度评估。审查后认为这套逻辑更适合 CRM 场景，对个人 AI 管家过于沉重。降级方案：
- 保留 `role_context` 列（一条 ALTER TABLE，零维护成本）
- 保留 `interaction_count` 列（`relate()` 时自动 +1，无独立任务）
- **删除** `SocialGraph.ts` 独立类（~140 行）
- **删除** `groups` + `group_members` 表（2 张表）
- **删除** 每周社交强度评估任务
- 社交上下文查询走通用 `getRelations()` + `role_context` 过滤即可

**验收标准**：
- PatternRecognizer: 同一时段事件 ≥3 次 → `behavior_patterns` 新增 `pattern_type=cycle`
- `role_context` 和 `interaction_count` 在 `relate()` 写入时被填充
- user_profile: 在相关特征积累 3 条证据后自动更新摘要
- 置信度: `confidence *= e^(-0.05)` 正确计算

---

### 9.8 Phase 6 — 行为层对齐 + 记忆录入管道完善

**工作量**: 2d | **接口对齐 + memory-manager.yaml 增强 + 所有 agent yaml**

| 任务 | 文件 | 工作量 | 步骤 |
|------|------|--------|------|
| 6.1 ContextSignalCollector | `MemoryManager.ts` `buildContext()` 内新增 Stage A | 0.5d | 纯统计：对话频率/消息长度/工具调用密度/上次活跃时间/当前场景 |
| 6.2 memory-manager.yaml prompt 精简 | `memory-manager.yaml` | 0.5d | 删除与 `l0-base-memory-guide.yaml` 重复的提取指导，保留会话完整性审查 + 数据维护 + 话题确认职责 |
| 6.3 buildContext Stage B/D/E/F 对齐 | `MemoryManager.ts` `buildContext()` | 0.5d | Stage B（RRF 语义检索）+ D（user_profile）+ E（topic_tracker）+ F（behavior_patterns） |
| 6.4 前台 agent 读权限对齐 | 4 个 yaml 文件 | 0.25d | `software-engineer.yaml` / `stock-analyst.yaml` / `ui-designer.yaml` / `product-manager.yaml` 增加 `memory_search` 工具 |
| 6.5 学习反馈闭环 | `MemoryManager.ts` + 调度任务 | 0.25d | 每周扫描 events(scene_tag=反馈) → 聚类 → 动态调整行为优先级 |

**验收标准**：
- buildContext 输出的 prompt 中包含对话信号（toolDensity / dialogFrequency）
- xuanji 前台时 buildContext 注入完整（提醒+话题+画像+偏差）
- 其他 agent 前台时 buildContext 仅注入通用检索结果
- 用户连续 3 次忽略同类提醒 → 该提醒优先级自动降级

---

### 9.9 依赖关系图

```
Phase 0 ──────────────────────────────────────────────────
  │
  ├── Phase 1（纯 prompt，无依赖）
  │
  ├── Phase 2（存储层，无外部依赖）
  │     │
  │     ├── Phase 3（TimelineInference，依赖 Phase 2）
  │     │
  │     ├── Phase 4（TopicContinuity，依赖 Phase 2）
  │     │
  │     └── Phase 5（PatternRecognizer + 社交列运维，依赖 Phase 2）
  │            │
  │            └── Phase 6（行为层对齐，依赖 Phase 3+4+5）
  │
  └── 所有 Phase 完成后 → deploy
```

**关键路径**: Phase 0 → Phase 2 → Phase 5 → Phase 6（约 5 天）
**旁路**: Phase 1（0.5d）+ Phase 3（1d）+ Phase 4（1d）可并行执行

---

### 9.10 回滚策略

每个 Phase 独立回滚：

| Phase | 回滚操作 | 数据影响 |
|-------|---------|---------|
| 0 | git revert ChatSession.ts 变更 | 无 |
| 1 | 恢复 xuanji.yaml 旧 systemPrompt | 无 |
| 2 | git revert migrateV11 + 新表 DDL（schema_version 回退到 10） | 新表数据可保留，旧逻辑忽略新表 |
| 3 | git remove TimelineInference.ts + revert buildContext | 无（新表数据被忽略） |
| 4 | git remove TopicContinuity.ts + revert extractFromSession | 无 |
| 5 | git remove PatternRecognizer.ts + revert scheduler | 无 |
| 6 | git revert buildContext + memory-manager.yaml | 无 |

---

### 9.11 测试策略

| 类型 | 覆盖范围 | 方式 | 频次 |
|------|---------|------|------|
| 迁移测试 | migrateV11 幂等性 | 备份现有 memory.db → 启动 xuanji → 检查 schema_version | 每次 Phase 2 变更 |
| 功能测试 | 各 Phase 验收标准 | 手动执行对应场景 + 检查 SQLite 表 | 每个 Phase 完成时 |
| 回归测试 | 记忆搜索/存储 | 执行旧场景（记忆搜索、session-end extraction）确认未退化 | Phase 2+4+6 |
| prompt 测试 | Prompt 输出检查 | 检查 buildContext 输出是否包含预期段落 | Phase 1+6 |

---

## 十、设计原则

1. **管家素质 = xuanji.yaml systemPrompt**，不污染其他 agent。这是框架自然保证的，不需要额外代码
2. **置信度是行属性**，不独立成类，直接在 CRUD 中写入
3. **话题检测：关键词初筛 → cheapLLM 确认 → 写入**。纯关键词不可行，加一层 LLM 过滤（session-end 异步，不阻塞）
4. **行为模式 confidence 上限 0.8**，保留不确定性给 LLM 做最终判断
5. **沉默规则 > 发言规则**。buildContext 的剪枝逻辑保证：工具高密度时跳过所有主动行为注入
6. **用户反馈闭环**：每个主动行为后跟踪用户反应，调整优先级
7. **buildContext 分级注入**：xuanji 前台完整注入，其他前台仅通用检索
8. **ContextSignalCollector 纯统计**：不调用 LLM，只算客观指标。语义判断留给 LLM

---

## 附录：交叉审查修复清单

| # | 问题 | 修复方式 |
|---|------|---------|
| 1 | buildContext 步骤矛盾 | §2.3 作为唯一权威定义。Stage A-F 命名清晰，有剪枝规则和 token 预算 |
| 2 | user_profile UNIQUE 锁死 | §3.2 DDL 不设 UNIQUE，维度由 LLM 自然生成 |
| 3 | 话题检测纯关键词不可行 | §4.3 改为关键词初筛 + cheapLLM 确认 |
| 4 | 社交图谱无数据输入 | §4.5 定义 interaction_count 的 3 种触发条件 |
| 5 | time_anchors metadata 不统一 | §3.2 conflict_group/priority 独立列，扩展属性 JSON |
| 6 | SemanticIndex 阈值无标定 | §2.3 改 top-3 注入，无硬阈值，LLM 自判相关度 |
| 7 | 情境信号计算缺失 | §4.6 新增 ContextSignalCollector，纯统计 |
| 8 | PatternRecognizer 周期不匹配 | §5.1 改为每日运行 |
| 9 | cheapLLM 未定义 | §5.3 明确为已有 CheapLLMProvider 接口 |
| 10 | 审计遗留 | §7 确认对本文无影响，P11 建议 Phase 0 修 |
| 11 | Token 计算偏差 | §2.1 修正为 ~6300t (L0 2700 + L1 300 + L2 500 + sp 2000 + ctx 800) |
| 12 | 组件命名漂移 | 全文统一用 MemoryManager/CareManager |
| 13 | 话题冷静期逻辑 | §4.3 定义：14 天冷却 + "下次会话再提"是 update last_mentioned_at 非 reset |
| 14 | pattern_type 命名 | 统一为 'cycle' \| 'routine' \| 'preference' |
| 15 | topic_type 与关键词矛盾 | §3.2 topic_type 删除 question/decision_pending，改为关键词+LLM 可处理的四类 |
