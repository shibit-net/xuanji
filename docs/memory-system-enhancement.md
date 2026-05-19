# 记忆系统增强设计 — 从"笔记"到"管家"

> 设计日期：2026-05-20 | 版本：v2（行为层+数据层完整覆盖）
> 基于：xuanji 现有记忆系统 (`src/core/memory/`, 8 表 + FTS5 + 语义索引)
> 核心理念：Jarvis 式管家记忆 — 数据层决定"知道多少"，行为层决定"如何表达"

---

## 一、文档结构

这份文档分为两层：

```
Part A: 行为层（新增，本文核心贡献）
├── A.1 管家行为原语（5 类行为的触发·表达·沉默规则）
├── A.2 情境敏感度模型（什么时候介入到什么程度）
├── A.3 检索与注入策略（context window 的竞争规则）
├── A.4 LLM 系统提示设计原则
└── A.5 学习反馈闭环（越用越懂你的反馈通道）

Part B: 数据层（v1 文档精简重排）
├── B.1 用户画像摘要层（user_profile 表）
├── B.2 时间锚点（time_anchors 表）
├── B.3 置信度演化（confidence + evidence_count）
├── B.4 开放式话题追踪（topic_tracker 表）
├── B.5 行为模式 + 社交图谱
└── B.6 推理引擎精简
```

---

## Part A：行为层 — 管家如何思考、决策、表达

### A.1 管家行为原语

真正的管家感不来自数据量，而来自 LLM 在**正确的时间、用正确的语气、说正确的话**。这需要定义五种行为原语，每种原语都要回答三个问题：

1. **触发条件** — 什么信号告诉我该说话了？
2. **发言策略** — 说什么、怎么组织语言？
3. **沉默规则** — 什么情况下即使有触发也不该说？

---

#### 原语 1：主动提醒（Reminder）

管家的基础能力 — 知道"到时候了"。

| 维度 | 定义 |
|------|------|
| **触发条件** | TimelineInference 返回 `checkUpcomingReminders()` 有结果，且距离到期时间在 [15min, 24h] 内 |
| **发言策略** | 简洁、可操作。**格式**："[提醒] 事实 + 建议行动"。**不要用"温馨提醒您"式模板** |
| **沉默规则** | ① 同一提醒每条会话只提一次；② 用户连续忽略同一类提醒 3 次 → 降级为被动（仅在用户主动问时回复）；③ 用户正在处理复杂任务时（对话高频率、多工具调用）不插入提醒 |

**语气示例**：

| 场景 | 表达 |
|------|------|
| 明天有会 | "明天下午 3 点跟老张开会，今天提前准备一下材料。" |
| 定时事务 | "周二了，记得倒垃圾。" |
| 多件事冲突 | "周三下午有会，但你周二说周三要去办证，这两个时间有冲突。" |

---

#### 原语 2：关联洞察（Insight）

管家的差异化能力 — 把离散记忆拼成用户没想到的联系。

| 维度 | 定义 |
|------|------|
| **触发条件** | 当前会话中有新信息 → SemanticIndex 检索到相关旧话题 → 余弦相似度 > 0.7 且跨越的会话数 ≥ 2 |
| **发言策略** | "连接"句式：**旧话题 + 新信息 → 结论**。提供信息来源时间戳（"你 5/12 提过..."）。**不要强行关联** |
| **沉默规则** | ① 相关性不明确时（相似度 < 0.6）不说；② 同一个关联每条会话只提一次；③ 用户明确表示不愿回顾时（"别提那个了"）停止 |

**语气示例**：

| 场景 | 表达 |
|------|------|
| 之前讨论的问题有答案了 | "你 5/12 提的那个性能问题，我注意到 github.com/user/repo 有个新方案可以解决。" |
| 当前话题联想到旧话题 | "你说的这个模式，跟之前你评价某某项目时遇到的问题很像。" |
| 跨会话的知识复用 | "你上次用 Docker Compose 遇到过网络配置问题，这次类似场景可以参考当时的解决思路。" |

---

#### 原语 3：状态感知（Status Awareness）

管家最人性化的能力 — 注意到你的变化。

| 维度 | 定义 |
|------|------|
| **触发条件** | PatternRecognizer 检测到偏差（`severity = 'high'`），且偏差跨越 ≥3 个独立会话 |
| **发言策略** | **温和、观察性、不带评判**。格式：**事实观察 + 开放式结尾**。给出选择权 |
| **沉默规则** | ① 首次偏差时只观察不说，第二次才提；② 用户否认或回避时 → 停止跟踪该偏差 30 天；③ 工作场景下不涉及健康/情绪话题（除非用户主动提起） |

**语气示例**：

| 场景 | 表达 |
|------|------|
| 加班频率增加 | "最近两周你结束对话的时间比之前平均晚了 2 个小时，是项目有什么变动吗？" |
| 习惯改变 | "你之前每周二都会问倒垃圾提醒，最近连续两周没问了，是已经不需要了吗？" |
| 情绪感知 | "你今天回复比较简短，如果累了可以明天再继续。"（注意：这是风险最高的行为，默认关闭，由用户选择开启） |

---

#### 原语 4：目标追踪（Goal Tracking）

管家执行力的体现 — 记住你想做的事并推动。

| 维度 | 定义 |
|------|------|
| **触发条件** | `topic_tracker` 中有 `status = 'open'` 的话题，且 `last_mentioned_at` 在 7-30 天内，且当前对话情境适合展开 |
| **发言策略** | **建议而非提醒**。格式：**事实陈述 + 明确的行动请求**。给用户说"不用了"的出口 |
| **沉默规则** | ① topic_tracker.priority < 3 不主动提；② 每个话题被提及后 → 进入 14 天冷静期；③ 用户说"不用了" → `status = 'abandoned'` |

**语气示例**：

| 场景 | 表达 |
|------|------|
| 学习计划 | "你上个月说想学 Rust，现在有上手了吗？要不要给你推荐个入门资源？" |
| 购物需求 | "你之前说要换显示器，我这段时间关注了一下，有几个型号在促销。" |
| 模糊想法 | "你提过想做个人博客，如果确定要开始的话，我可以帮你搭基础框架。" |

---

#### 原语 5：偏好响应（Preference Response）

管家"懂你"的最直观表现。

| 维度 | 定义 |
|------|------|
| **触发条件** | 当前对话中涉及的内容（推荐/搜索/对比）命中了与用户偏好相关的实体/关系，且置信度 ≥ 0.8 |
| **发言策略** | 自然提及，不刻意。**"我记得 + 事实"**。不要让用户觉得在被监视 |
| **沉默规则** | ① 涉及用户偏好的隐私边界（健康信息、财务状况）不主动提；② 用户在前 3 次会话内刚说过这条偏好时不重复；③ 置信度 < 0.8 时不提（这是你的数据层做的） |

**语气示例**：

| 场景 | 表达 |
|------|------|
| 推荐餐厅 | "这家做湘菜，不过你喜欢清淡的，要不要看看其他选项？" |
| 工作习惯 | "这个方案需要写很多 Python，但你更习惯用 Go——需要我帮你评估一下转换成本吗？" |
| 人际偏好 | "这个任务需要跟某某协作，你们之前合作过，需要我看看有什么需要注意的吗？" |

---

### A.2 情境敏感度模型

五种原语在不同情境下发言的**优先级和频率**不同。这是定义"什么时候该说话"的核心模型。

#### 输入信号

| 信号 | 数据来源 | 取值 |
|------|---------|------|
| 对话频率 | 最近 5 分钟内消息数 | 低频(<3) / 中频(3-10) / 高频(>10) |
| 消息长度 | 用户消息平均字符数 | 简短(<50) / 正常(50-500) / 长篇(>500) |
| 工具调用密度 | 最近 5 条消息中 tool call 占比 | 低(<20%) / 中(20-60%) / 高(>60%) |
| 话题切换频率 | 最近 N 条消息的语义主题变化 | 稳定 / 渐进 / 跳跃 |
| 上次活跃时间 | 距上次会话的天数 | 连续 / <1天 / 1-7天 / >7天 |
| 当前场景 | 场景分类器输出 | 工作 / 日常 / 技术 / 规划 / 情感 |

#### 情境判断逻辑

```
if 对话频率 == 高 && 消息长度 == 简短 && 工具调用 == 高:
    → 情境 = "工作流中" (用户专注，少打扰)
elif 对话频率 == 中-低 && 话题切换 == 渐进 && 工具调用 == 低:
    → 情境 = "日常闲聊" (适合介入)
elif 上次活跃时间 > 3天 || 消息长度 == 长篇:
    → 情境 = "会话开头" (适合主动建联)
else:
    → 情境 = "无明确信号" (默认中等介入)
```

#### 行为矩阵

| 情境 | 允许的原语 | 优先级限制 | 单次会话上限 |
|------|-----------|-----------|------------|
| **工作流中** | ① 提醒（仅 deadline < 1h） | 仅紧急提醒 | 1 条 |
| **日常闲聊** | ①②③④⑤ 全部 | 所有原语可用 | 2 条 |
| **会话开头** | ①④（提醒 + 目标追踪） | 每条 1 个 | 2 条 |
| **无明显信号** | ① ② （提醒 + 洞察） | 仅到期提醒 | 1 条 |

**"用户忽略"的反馈处理**：用户对某条主动行为无回应（或简短敷衍） → 记录该行为类型在本会话中已触发 → 后续不再触发同类行为 → 连续 3 次会话如此 → 降低该类行为的系统级优先级。

---

### A.3 记忆检索与注入策略

#### A.3.1 检索流程（有级联上限）

```
Session Context（当前会话的直接上下文）
  │
  ├─ Step 1: 到期提醒 (TimelineInference)
  │   上限: 3 条 | 不可跳过
  │   查询: time_anchors WHERE trigger_time IN [now, now+24h]
  │
  ├─ Step 2: 语义关联检索 (SemanticIndex)
  │   上限: top-5 | 可跳过
  │   查询: 以当前最后 3 条用户消息拼接为 query, 搜索 entities+facts
  │
  ├─ Step 3: 话题延续 (TopicContinuity)
  │   上限: top-3, priority >= 3 | 可跳过 (若 Step 1+2 已超 600t)
  │
  ├─ Step 4: 用户画像摘要 (UserProfile)
  │   上限: top-5 dimension | 始终注入
  │   这是"压缩记忆 → 快速建立'我懂你'感"的关键
  │
  └─ Step 5: 行为偏差 (PatternRecognizer)
      上限: 仅 severity='high' | 首次跳过，第二次才注入
```

#### A.3.2 记忆竞争窗口

总预算 **800 tokens**。按优先级分配：

```
┌──────────────┬──────┬──────────┬─────────────────┐
│ 层级         │ 上限 │ 可跳过?  │ 剪枝规则          │
├──────────────┼──────┼──────────┼─────────────────┤
│ 到期提醒     │ 150t │ 不可跳过 │ 最多 3 条         │
│ 语义关联     │ 200t │ 可      │ 相似度<0.6 过滤   │
│ 话题延续     │ 150t │ 可      │ top-3, 至少相差7天 │
│ 用户画像     │ 200t │ 不可跳过 │ top-5 dimension   │
│ 行为偏差     │ 100t │ 可      │ 仅 high severity  │
└──────────────┴──────┴──────────┴─────────────────┘

总上限: 800t，超限时按 Skips 顺序剪枝:
  Step 5 (行为偏差) → Step 3 (话题延续) → Step 2 (语义关联)
  Step 1 和 Step 4 不可跳过。
```

#### A.3.3 注入格式

注入到 system prompt 的尾部，格式统一为：

```
## 管家上下文（仅供内部参考，不直接向用户展示）

【提醒】
- [5月22日 15:00] 跟老张开会 → 冲突：周三下午也有办证预约
- [每周二] 倒垃圾

【关联信息】
- 当前话题与你的旧话题“某某项目的性能优化”相关（5/12）

【待跟进】
- 你想学 Rust（5月18日，已 3 天未推进）
- 你想换显示器（5月8日）

【关于你】
- 偏好：清淡饮食、Go 优先、不喜欢宏
- 习惯：工作日 9-18 点活跃
- 最近变化：本周对话时长增加 30%
```

> **注意**：这份上下文是提供给 LLM 内部使用的，LLM 需要根据行为原语的表达规则（A.1）决定是否及如何对外表达，而不是直接朗读这份内容。

---

### A.4 LLM 系统提示设计原则

这不是一个完整的 system prompt，而是定义 prompt 设计的**边界和约束**。实际 prompt 由这些原则 + 具体场景组合生成。

#### 原则 1：人格一致性

管家始终是"冷静、可靠、贴心但不黏人"的角色。具体约束：

- **称呼**：不需要固定称呼，用自然对话的称呼
- **语气**：平实、陈述性、无夸大修辞
- **介入风格**：建议而非命令，提供选择权（"需要我...吗?"）
- **错误态度**：如果记忆错误或理解偏差，主动承认并更新记忆（"看来这个印象过时了，我更新一下"）

#### 原则 2：信息来源透明

管家的建议应让用户知道来源，建立信任：

- 正确：**"你 5/12 提过想学 Rust，现在有上手了吗？"**
- 错误：**"你应该学 Rust"** 或 **"根据我的记录..."**（太正式）
- 规则：提及过去事件时附带时间戳，但格式要自然

#### 原则 3：沉默规则优先级

五种原语之外，给 LLM 一条最高优先级的元规则：

> **"如果你不确定该不该说，那就别说。"**
> 误报比漏报更伤害管家体验。一次不当的主动发言会使用户倾向关闭所有主动能力。

#### 原则 4：隐私边界

管家知道的 vs 可以表达的，有明确分界：

| 类别 | 存储 | 主动表达 |
|------|------|---------|
| 偏好（饮食/工具/风格） | ✓ 可存储并用于推荐 | ✓ 可主动提及 |
| 工作计划、会议、提醒 | ✓ 可存储并用于提醒 | ✓ 可主动提及 |
| 健康信息、财务状况 | ✓ 仅存储不主动用 | ✗ 永不主动提 |
| 社交关系（人物评价） | ✓ 仅存储 | ✗ 永不主动提 |

#### 原则 5：一次性 vs 持续性建议

- **一次性建议**（"明天有会"）：直接提醒，一次完成
- **持续性建议**（"你最近加班多"）：温和开场 + 留选择空间，不要追着说
- 规则：同一条持续性建议在连续 3 次会话中只出现 1 次

---

### A.5 学习反馈闭环

管家系统应该越用越懂你。目前设计中缺少**从用户行为到 LLM 行为调整**的反馈通道。

#### A.5.1 反馈信号

| 信号类型 | 检测方式 | 含义 |
|---------|---------|------|
| **显式肯定** | 用户说"对"、"是的"、"记得"、"好的" | 验证正确，confidence +0.1 |
| **显式否定** | 用户说"不是"、"不对"、"不用了" | 纠正错误，confidence * 0.3 |
| **积极互动** | 用户展开话题（消息长度 > 50 字且包含新信息） | 介入被接受，该类行为优先级 +1（不超过上限） |
| **消极互动** | 用户简短回应（<20 字）或跳过 | 介入被接受但无深度价值，优先级不变 |
| **忽视** | 用户完全无回应，继续下一个话题 | 介入被拒绝，优先级 -1 |
| **连续忽视** | 同类型行为连续 3 次被忽视 | 该行为类型自动降级，30 天内不再主动触发 |

#### A.5.2 反馈数据存储

不需要新表，利用现有 `events` 表：

```typescript
// 用户对管家主动行为的反应 → events 表记录
{
  content: "用户反馈: [行为类型:reminder] [action_id:xxx] [response:positive] — 用户说'好的，知道了'",
  entityNames: ['user', '管家行为反馈'],
  importance: 2,
  scene_tag: ',反馈,',
}
```

每周后台任务扫描 `events` 表，按行为类型 + response 聚类 → 动态调整该类型的优先级权重。

#### A.5.3 画像更新触发

当某个 `user_profile.dimension` 积累足够的新证据后：

```
条件:
  1. 同一 dimension 的新 events ≥ 3 条
  2. 证据中至少 1 条显式肯定（非消极互动）
  3. 上次更新已过 7 天以上

动作:
  → 调度 cheapLLM 重新生成该 dimension 的 summary
  → 更新 user_profile.confidence += min(0.1, sum(evidence_delta))
```

---

## Part B：数据层（精简重排）

### B.1 用户画像摘要表 `user_profile`

这是**记忆压缩缓存层** — 每次会话开头注入 3-5 条高置信度画像，LLM 立刻表现出"了解你"的感觉。

```sql
CREATE TABLE IF NOT EXISTS user_profile (
  id              TEXT PRIMARY KEY,
  dimension       TEXT NOT NULL,      -- 'preference' | 'habit' | 'goal' | 'relationship' | 'value' | 'background'
  summary         TEXT NOT NULL,      -- 由 cheapLLM 定期生成的自然语言摘要
  confidence      REAL NOT NULL DEFAULT 0.6,
  evidence_ids    TEXT,               -- 支撑摘要的 entity/fact/event ID 列表，,id, 格式
  source_sessions TEXT,               -- 证据来源的 session ID，,sessionId, 格式
  last_updated_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(dimension)
);

CREATE INDEX idx_user_profile_confidence ON user_profile(confidence DESC);
```

**生成规则**（每周维护任务 + 有新事件时增量更新）：

```
初始: 从 entities (type='preference') + facts (source='user_said') 生成
更新: 当新的证据（显式肯定或偏好变更）积累 ≥ 3 条时触发 LLM 重新摘要
删除: 当某 dimension 的所有证据都被推翻 (confidence < 0.1) 时标记删除
```

**效果**：不需要每次检索"用户的全部偏好"。5 条画像摘要直接注入，相当于给 LLM 一副"用户速写"。

---

### B.2 时间锚点表 `time_anchors`

保留 v1 设计不变。

```sql
CREATE TABLE IF NOT EXISTS time_anchors (
  id              TEXT PRIMARY KEY,
  anchor_type     TEXT NOT NULL,       -- 'deadline' | 'schedule' | 'periodic' | 'context_expiry'
  target_type     TEXT NOT NULL,       -- 'entity' | 'fact' | 'event' | 'relation'
  target_id       TEXT NOT NULL,
  trigger_time    INTEGER,
  cron_expr       TEXT,
  grace_minutes   INTEGER DEFAULT 0,
  reminder_depth  INTEGER DEFAULT 1,
  last_triggered  INTEGER,
  is_active       INTEGER DEFAULT 1,
  reason          TEXT,
  metadata        TEXT,               -- JSON: { conflict_group, depends_on, priority }
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

**简化**：去掉 `reminder_depth = -1`（简化设计，统一用 `reminder_depth = 1`，由 LLM 根据 A.1 决定是否重复提醒）。

---

### B.3 置信度演化

**不做新表**，直接扩展现有表列：

```sql
-- 增量迁移 v11:
ALTER TABLE facts ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6;
ALTER TABLE facts ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE relations ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6;
ALTER TABLE relations ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE relations ADD COLUMN interaction_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE relations ADD COLUMN last_interaction_at INTEGER;
ALTER TABLE relations ADD COLUMN role_context TEXT;

ALTER TABLE entities ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6;
ALTER TABLE entities ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_facts_confidence ON facts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_relations_confidence ON relations(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_entities_confidence ON entities(confidence DESC);
```

**置信度推演逻辑**（纯算法）：

```
更新条件: upsertEntity / storeFact / relate / deactivateRelation / rollbackFact 时
  创建: confidence = 0.6, evidence_count = 1
  用户显式确认: confidence = min(1.0, confidence + 0.2), evidence_count++
  间接证据: confidence = min(1.0, confidence + 0.05), evidence_count++
  用户纠错: confidence *= 0.3
  矛盾覆盖: 旧条目 confidence *= 0.5
  证据不足: confidence *= 0.8 (每 30 天无交互)

每周衰减: confidence -= decayRate (默认 0.05), min 0.05
  如果 evidence_count >= 5 AND confidence > 0.9: decayRate = 0.01 (锁定)
```

---

### B.4 开放式话题追踪表 `topic_tracker`

保留 v1 设计，增加话题类型分类。

```sql
CREATE TABLE IF NOT EXISTS topic_tracker (
  id              TEXT PRIMARY KEY,
  topic           TEXT NOT NULL,
  topic_type      TEXT NOT NULL DEFAULT 'goal',  -- 'goal' | 'plan' | 'question' | 'interest' | 'decision_pending'
  source_event_id TEXT,
  status          TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'followed_up' | 'resolved' | 'abandoned'
  priority        INTEGER DEFAULT 3,
  context_summary TEXT,
  mention_count   INTEGER DEFAULT 1,
  last_mentioned_at INTEGER NOT NULL,
  last_followup_at INTEGER,
  created_at      INTEGER NOT NULL
);
```

**关键限制：语义过滤而非关键词**

依赖"想/打算/考虑"会产生噪声。过滤规则：

```
话题必须是以下类型之一：
  goal:     "我想学 Rust"、"打算减肥" — 有明确目标
  plan:     "下个月去日本"、"周末装修" — 有时间维度的计划
  question: "A 和 B 有什么区别" — 用户提出但未解答的疑问
  interest: "最近某某好像很有趣" — 模糊兴趣，不代表行动意向
  decision_pending: "要不要换框架" — 需要决策但未定的议题

过滤掉:
  - 操作性表述: "我想看看这个函数"、"我想打开这个文件" ← 当前任务
  - 瞬时兴趣: "这个很好看" ← 无后续行动
  - 否定表达: "我不想..." ← 这是偏好，不是话题
```

---

### B.5 行为模式 + 社交图谱（合并）

`behavior_patterns` 表和扩展 relations 保留 v1 设计，不做简化。

关键设计变更：**`behavior_patterns.confidence` 上限 0.8**。模式提取可能受数据稀疏性影响，保留 0.2 的不确定性给 LLM 做最终判断（对应 A.5 的反馈通道）。

**社交群组** `groups` + `group_members` 保留原有 DDL。

---

### B.6 推理引擎精简

| 推理引擎 | 职责 | 行数估算 | 备注 |
|---------|------|---------|------|
| `TimelineInference` | 时间锚点 CRUD + 到期检查 + 冲突检测 | ~200 | 保留 |
| `TopicContinuity` | 话题检测 + 跨会话延续 + 状态管理 | ~200 | 保留 |
| `PatternRecognizer` | 行为模式提取 + 偏差检测 | ~250 | 保留 |
| `SocialGraph` | 群组管理 + 社交强度评估 | ~100 | 保留 |
| `ConfidenceInference` | → 取消独立类，改为 MemoryManager 方法 | — | 见 B.3 |

**删除** `ConfidenceInference` 独立类。置信度是实体/事实/关系的内在属性（B.3 的列），直接在 MemoryManager 的 CRUD 方法中处理。不需要额外封装。

---

## 八、架构影响汇总

### 8.1 新文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `TimelineInference.ts` | ~200 | 时间锚点 + 到期 + 冲突 |
| `TopicContinuity.ts` | ~200 | 话题追踪 |
| `PatternRecognizer.ts` | ~250 | 行为模式 |
| `SocialGraph.ts` | ~100 | 群组 + 社交强度 |

**预估新增 ~750 行**（v1 的 900 → 750，因取消 ConfidenceInference 独立类）。

### 8.2 现有文件修改

| 文件 | 修改 |
|------|------|
| `MemoryManager.ts` | `buildContext()` 实现 A.3 检索流程；CRUD 方法增加置信度写入 |
| `CacheManager.ts` | 增强：集成 TimelineInference 的到期提醒 |
| `types.ts` | 新增全部类型定义 |
| `Scheduler` | 注册每周维护任务 |

### 8.3 Prompt 注入预算

| 组件 | Tokens | 优先级 |
|------|--------|--------|
| 到期提醒 | ~150（不可跳过） | P0 |
| 语义关联 | ~200（可跳过） | P0 |
| 话题延续 | ~150（可跳过） | P1 |
| 用户画像（固定注入） | ~200（不可跳过） | **新** |
| 行为偏差 | ~100（可跳过） | P2 |
| **总预算** | **~800** | — |

---

## 九、相位重排（按用户感知价值）

```
Phase 1（你的设计 — 保留）:
  TimelineInference + confidence 列迁移 + user_profile 表
  → 交付：提醒 + "我知道你是谁"的感觉

Phase 2（新增，原文档缺失的核心）:
  LLM 行为原语 → 系统提示设计 → 情境敏感度模型 → 检索策略
  → 交付：管家知道什么时候说什么

Phase 3（原 Phase 2）:
  TopicContinuity + 用户画像持续更新
  → 交付：跨会话延续

Phase 4（原 Phase 3 + 4 合并）:
  SocialGraph + PatternRecognizer
  → 交付：社交推理 + 行为偏差检测
```

**关键变化**：Phase 2 是**纯行为层设计**（几乎不需要写代码），但决定了所有数据层工作的最终价值。建议 Phase 1 完成后先做 Phase 2 的 prompt 工程，再推进 Phase 3-4 的数据层扩展。

---

## 十、Pitfalls

- **不要用 LLM 做时间解析**。用户说"周三" → 算法解析为本周三 23:59。LLM 写 time_anchor 字段时需要提供上下文（"下周三"、"这周三"），解析由工具层完成。
- **不要在所有 events 上都跑 PatternRecognizer**。只跑 source = 'user_said' 或 'user_correction' 的事件。工具调用事件不包含行为模式信号。
- **user_profile 每次更新后缓存**。cheapLLM 重新生成摘要的成本 ~200t 输出。每周最多更新 1-2 个 dimension，不要批量更新全部。
- **情境敏感度不要过于复杂**。4 种情境 + 5 种原语 = 20 种组合，LLM 可以自然判断。不要把判断规则写在代码里（"if A and B then C"），而是写在 prompt 里让 LLM 自己决策。
- **沉默规则优先级高于发言策略**。A.4 原则 3（"不确定就不说"）是唯一一条碰到任何行为原语都会覆盖的元规则。
- **不要忘记行为原语内的消重**。同一会话中，5 种原语不应该同时触发。A.3 的检索流程确保单次会话只有 1-2 条主动输出。
- **用户画像缓存层只在冷启动时有用**。用户使用超过 1 个月后，SemanticIndex 已经有足够信号，user_profile 的作用从"建立熟悉感"降级为"剪枝上下文"。
