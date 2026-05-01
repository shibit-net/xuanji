# Agent Team 执行协议

> 本协议是主 agent 在调用 agent_team 工具时**必须遵循**的操作规范

---

## 🚦 执行前强制检查清单

在调用 `agent_team` 之前，主 agent **必须**完成以下检查：

### 1. 任务适配性检查（MANDATORY）

```
[ ] 任务可以拆分为 3+ 个独立子任务
[ ] 每个子任务有明确的输入输出边界
[ ] 子任务之间的依赖关系清晰
[ ] 预估单个 agent 无法在 5 分钟内完成
```

**如果任何一项为 ❌，则使用 `task` 工具而非 `agent_team`**

### 2. 策略选择（MANDATORY）

**前置门槛检查**：至少满足 2 条才使用 agent_team：
- [ ] 任务涉及 ≥3 个文件/模块
- [ ] 需要多人协作（不同专业视角）
- [ ] 有明确的依赖/数据链
- [ ] 有已知决策分歧需辩论统一
- [ ] 单 agent 执行预估 > 15min

不满足门槛 → 使用 `task` 工具或直接执行。

根据任务特征选择策略（P1 优化决策树）：

```
IF 有已知决策分歧/技术选型争议
  → strategy: "debate"  🗣️ 充分论证（含 Judge 预读优化）

ELSE IF 需要先设计架构再分工实现
  → strategy: "hierarchical"  🏗️ 架构师规划 + Workers 执行

ELSE IF 数据需要多阶段转换（收集→分析→报告）
  → strategy: "pipeline"  🔄 ETL 数据流

ELSE IF 子任务有明确的顺序依赖
  → strategy: "sequential"  🔗 阶段串行

ELSE
  → strategy: "parallel"  ⚡ 默认最快
```

**详细策略说明**: 参见 `.xuanji/protocols/agent-team-strategies.md`

### 3. 成员配置检查（MANDATORY）

每个 member 必须满足：

```
[ ] id: 唯一标识符（小写字母+下划线）
[ ] role: 使用正确的 agent ID（explore/plan/coder/doc-writer/test-writer）
[ ] task: 🎯 具体的WHAT — 成员要完成的实际工作（成为用户消息）
    [ ] 明确的任务描述（要分析什么、产出什么）
    [ ] 具体的检查点/交付物（3-5 个要点）
    [ ] 输出格式要求（Markdown/JSON/不超过 X 字）
[ ] system_prompt: 🔧 角色的HOW — 注入系统提示的指导（非工作描述）
    [ ] 关注领域（安全/性能/代码质量/架构）
    [ ] 方法论/约束条件
    [ ] 视角/立场
[ ] timeout: 设置合理超时（60000-180000ms）
```

**🎯 `task` vs `system_prompt` — 关键区别：**
- `task` = 要做什么（用户消息）— "审查 src/auth/login.ts 的 SQL 注入漏洞"
- `system_prompt` = 如何行为（系统提示）— "关注 OWASP Top 10：注入、认证、数据泄露"

### 4. 性能优化检查（MANDATORY）

```
[ ] 避免重复工作：不同 member 不应分析相同的文件
[ ] 使用快速工具：优先使用 grep/glob/list_directory
[ ] 限制范围：明确指定要分析的目录/文件列表
[ ] 限制输出：要求输出不超过 300-500 字
[ ] 合理超时：
    - 单个 member: 60-180 秒
    - 团队总计: 300-600 秒
```

---

## 📋 五种策略详细使用手册

### 策略 1: parallel（并行执行）⭐ 最常用

#### 适用场景
- ✅ 子任务完全独立，无依赖关系
- ✅ 需要快速完成（总时间 = 最慢的那个 agent）
- ✅ 分析不同模块/目录
- ✅ 从多个角度检查同一项目

#### 不适用场景
- ❌ 后续任务需要前面的结果
- ❌ 需要共享中间状态
- ❌ 任务之间有顺序依赖

#### 执行特点
- **总耗时**: max(所有成员耗时) ≈ 最慢的那个
- **资源占用**: 高（多个 agent 同时运行）
- **结果汇总**: 需要手动汇总（使用单个 task）

#### 配置要点
```typescript
{
  strategy: "parallel",
  timeout: 300000,  // 团队总超时 = 最慢成员的超时
  members: [
    {
      id: "member1",
      timeout: 180000,  // 各成员可以设置不同超时
      task: "明确的独立任务 — 输出什么、格式要求",
      system_prompt: "角色/行为指导 — 关注什么、如何分析"
    },
    {
      id: "member2",
      timeout: 120000,
      task: "另一个完全独立的具体任务",
      system_prompt: "不同视角的行为指导"
    }
  ]
}
```

#### 标准模板：代码分析

```typescript
{
  team_name: "code-analysis-parallel",
  goal: "并行分析项目的架构、安全、质量",
  strategy: "parallel",
  timeout: 300000,  // 5 分钟
  members: [
    {
      id: "structure",
      role: "explore",
      priority: 1,
      timeout: 120000,
      task: "快速收集项目结构：列出 src/ 目录树，统计文件数量和核心模块，输出 JSON 格式",
      system_prompt: "使用 list_directory 和 glob 快速扫描。限时 2 分钟，只收集不分析。"
    },
    {
      id: "security",
      role: "coder",
      priority: 1,
      timeout: 180000,
      task: "检查安全问题：搜索 exec()/spawn() 调用，审查 BashTool.ts 参数处理，输出 Top 3 安全风险",
      system_prompt: "关注命令注入、参数注入、权限提升。使用 grep 快速定位。限时 3 分钟。"
    },
    {
      id: "quality",
      role: "coder",
      priority: 1,
      timeout: 180000,
      task: "检查代码质量：搜索 any 类型使用，审查 AgentLoop.ts 复杂度，输出 Top 3 质量问题",
      system_prompt: "关注类型安全、函数复杂度、代码异味。限时 3 分钟。"
    },
    {
      id: "architecture",
      role: "plan",
      priority: 1,
      timeout: 180000,
      task: "分析架构设计：审查核心模块类型定义，检查依赖结构，输出架构优缺点（不超过 300 字）",
      system_prompt: "关注模块耦合、接口设计、依赖管理。限时 3 分钟。"
    }
  ]
}

// 第二阶段：汇总（使用单个 task）
task({
  description: "基于以上 4 位专家的分析，生成最终报告...",
  subagent_type: "plan",
  timeout: 120000
})
```

### 模板 2：技术选型（辩论模式 + Judge 预读优化）

**P1 优化**：Judge 在辩论前先预读关键文件，输出事实摘要。正反方引用摘要而非重复读取文件，Token 节省 ~46%。

```typescript
{
  team_name: "tech-decision-debate",
  goal: "评估技术方案 A vs B",
  strategy: "debate",
  timeout: 1800000,  // 30 分钟
  max_rounds: 3,     // 不要超过 3，否则 Token 爆炸
  members: [
    {
      id: "advocate_a",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持方案 A。
约束：
1. 第一轮输出完整论点（含代码引用行号）
2. 后续轮次仅回应对方论点 + 补充新证据
3. 禁止重复读取已读文件，引用 Judge 摘要中的行号即可`
    },
    {
      id: "advocate_b",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持方案 B。
约束：
1. 第一轮输出完整论点（含代码引用行号）
2. 后续轮次仅回应对方论点 + 补充新证据
3. 禁止重复读取已读文件，引用 Judge 摘要中的行号即可`
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: `[debate_role:judge]
你在辩论开始前先执行预读阶段。

预读阶段（仅你执行）：
1. 读取所有涉及的关键源码文件
2. 输出一份「事实摘要」包含：关键函数行号、分支条件、边界值
3. 将摘要共享给正反双方

辩论阶段：
4. 双方基于摘要引用代码，而非重复读取文件
5. 仅在事实争议时才重新读取具体行`
    }
  ]
}
```

```typescript
{
  team_name: "tech-decision-debate",
  goal: "评估技术方案 A vs B",
  strategy: "debate",
  timeout: 480000,  // 8 分钟
  members: [
    {
      id: "advocate_a",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持方案 A（${方案A描述}）：
1. 列出 3 个核心优势
2. 分析适用场景
3. 评估实施成本
输出不超过 400 字。`
    },
    {
      id: "advocate_b",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持方案 B（${方案B描述}）：
1. 列出 3 个核心优势
2. 分析适用场景
3. 评估实施成本
输出不超过 400 字。`
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: `基于双方论述，做出最终评估：
1. 对比两个方案的优劣
2. 给出推荐方案和理由
3. 列出实施建议
输出不超过 500 字。`
    }
  ]
}
```

### 模板 3：模块化分析（并行模式）

```typescript
{
  team_name: "module-analysis-parallel",
  goal: "分析不同模块的代码质量",
  strategy: "parallel",
  timeout: 300000,
  members: [
    {
      id: "core_module",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `只分析 src/core/ 目录：
1. 检查类型安全（any 的使用）
2. 检查错误处理（try-catch）
3. 输出 Top 3 问题（不超过 300 字）`
    },
    {
      id: "adapter_module",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `只分析 src/adapters/ 目录：
1. 检查 UI 组件的可维护性
2. 检查事件处理的完整性
3. 输出 Top 3 问题（不超过 300 字）`
    },
    {
      id: "infra_module",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `只分析 src/memory/, src/permission/, src/mcp/：
1. 检查数据持久化的安全性
2. 检查权限控制的完整性
3. 输出 Top 3 问题（不超过 300 字）`
    }
  ]
}
```

---

## ⚠️ 常见错误与避免方法

### 错误 1：任务范围过大导致超时

❌ **错误示例**：
```typescript
// ❌ 没有 task 字段 — 成员不知道具体要做什么
task: "分析整个项目的代码质量"  // 太宽泛，没有具体范围
```

✅ **正确示例**：
```typescript
system_prompt: `只分析 src/core/agent/ 目录下的 3 个文件：
- AgentLoop.ts
- SubAgentLoop.ts
- SubAgentFactory.ts
检查类型安全和错误处理，输出不超过 300 字。`
```

### 错误 2：使用错误的 agent ID

❌ **错误示例**：
```typescript
role: "subagent_planner"  // 这是内部标识符，不是 agent ID
```

✅ **正确示例**：
```typescript
role: "plan"  // 使用 list_agents 查看可用的 agent ID
```

### 错误 3：成员之间重复工作

❌ **错误示例**：
```typescript
members: [
  { id: "analyzer1", task: "分析项目架构" },         // ❌ 缺少 system_prompt
  { id: "analyzer2", system_prompt: "分析项目设计" }  // ❌ 缺少 task，会重复读取文件
]
```

✅ **正确示例**：
```typescript
members: [
  { id: "structure", task: "只分析目录结构和模块划分", system_prompt: "关注模块和目录组织" },
  { id: "dependency", task: "只分析 package.json 的依赖关系", system_prompt: "关注依赖版本和冲突" }
]
```

### 错误 4：sequential 策略导致超时

❌ **错误示例**：
```typescript
strategy: "sequential",  // 4 个任务顺序执行 = 12 分钟
members: [
  { timeout: 180000 },  // 3 分钟
  { timeout: 180000 },  // 3 分钟
  { timeout: 180000 },  // 3 分钟
  { timeout: 180000 }   // 3 分钟
]
```

✅ **正确示例**：
```typescript
strategy: "parallel",  // 4 个任务并行执行 = 3 分钟
members: [
  { timeout: 180000 },
  { timeout: 180000 },
  { timeout: 180000 },
  { timeout: 180000 }
]
```

---

## 🔄 执行流程（主 agent 必须遵循）

### Step 1: 任务评估
```
1. 分析用户请求
2. 判断是否适合使用 agent_team（参考检查清单）
3. 如果不适合，使用 task 工具
```

### Step 2: 策略选择
```
1. 根据任务特征选择策略（parallel/sequential/pipeline/debate）
2. 优先选择 parallel（最快）
```

### Step 3: 任务拆分
```
1. 将任务拆分为 3-5 个独立子任务
2. 确保每个子任务有明确边界
3. 避免子任务之间重复工作
```

### Step 4: 成员配置
```
1. 为每个子任务选择合适的 agent（explore/plan/coder）
2. 编写明确的 task（具体要做什么）和 system_prompt（如何行为）
3. 设置合理的 timeout
```

### Step 5: 执行与监控
```
1. 调用 agent_team
2. 如果超时，分析原因：
   - 任务范围过大？→ 缩小范围
   - 策略不当？→ 改用 parallel
   - 某个 agent 卡住？→ 降低该 agent 的任务复杂度
3. 如果失败，降级到单个 task
```

### Step 6: 结果汇总
```
1. 如果使用 parallel 策略，需要手动汇总结果
2. 使用单个 task(subagent_type: "plan") 生成最终报告
```

---

## 📊 性能基准（P2 优化）

| 场景 | 推荐策略 | 成员数量 | 推荐 timeout | 成功率 |
|------|---------|---------|-------------|--------|
| 代码分析 | parallel | 3-4 | 1,200,000ms | 95% |
| 技术选型 | debate | 3 | 1,800,000ms | 90% |
| 模块分析 | parallel | 3-5 | 1,200,000ms | 95% |
| 架构+实现 | hierarchical | 3-4 | 1,500,000ms | 85% |
| CI 流水线 | sequential | 3-4 | 600,000ms | 90% |
| 数据看板 | pipeline | 2-3 | 600,000ms | 90% |

**超时公式**: `timeout = baseTimeout × complexityFactor`（详见 `agent-team-strategies.md`）

**如果实际耗时超过预期 2 倍，应立即中止并降级到单个 agent。**

---

## 🚨 失败处理协议

### 超时处理
```
IF agent_team 超时
  1. 分析超时原因（任务过大/策略不当/agent 卡住）
  2. 尝试优化配置（缩小范围/改用 parallel/减少成员）
  3. 如果再次超时，降级到单个 task
```

### 部分失败处理
```
IF 某个 member 失败但其他成功
  1. 收集成功的结果
  2. 对失败的部分使用单个 task 补充
  3. 汇总所有结果
```

### 完全失败处理
```
IF agent_team 完全失败
  1. 立即降级到单个 task
  2. 使用 plan agent 完成整个任务
  3. 记录失败原因到 memory
```

---

## ✅ 执行前自检（主 agent 内心独白）

在调用 agent_team 之前，主 agent 应该问自己：

```
1. 这个任务真的需要多个 agent 吗？
   → 单个 agent 5 分钟内能完成吗？

2. 我能清晰地拆分为 3+ 个独立子任务吗？
   → 每个子任务的边界清晰吗？

3. 我选择的策略合理吗？
   → parallel 是否可行？

4. 每个成员的 task 是否具体且互不重叠？system_prompt 是否描述了正确的行为指导？
   → 包含范围、检查点、输出格式、时间限制吗？

5. 我设置的 timeout 合理吗？
   → 单个 member 2-3 分钟，团队总计 5-10 分钟？

6. 我有备用方案吗？
   → 如果超时，我会降级到单个 task 吗？
```

**如果任何一个问题的答案是"不确定"，应重新评估或使用单个 agent。**

---

## 📝 执行日志模板

主 agent 在调用 agent_team 时，应该输出以下信息：

```
🎯 任务：${用户请求}

📋 评估结果：
- 适合使用 agent_team：✅/❌
- 选择策略：${strategy}
- 成员数量：${members.length}
- 预期耗时：${estimated_time}

👥 成员配置：
1. ${member1.id} (${member1.role}): ${member1.任务摘要}
2. ${member2.id} (${member2.role}): ${member2.任务摘要}
...

⏱️ 开始执行...
```

---

## 🎓 学习与改进

每次使用 agent_team 后，主 agent 应该：

1. **记录执行结果**
   - 成功/失败
   - 实际耗时 vs 预期耗时
   - 遇到的问题

2. **存储到 memory**
   ```typescript
   memory_store({
     type: "tool_pattern",
     content: "使用 agent_team 分析代码，parallel 策略，4 个成员，耗时 3.5 分钟，成功",
     keywords: ["agent_team", "parallel", "code_analysis"]
   })
   ```

3. **优化未来执行**
   - 如果某个配置多次成功，形成标准模板
   - 如果某个配置多次失败，避免再次使用

---

## 🔒 强制规则（不可违反）

1. **禁止使用错误的 agent ID**
   - 只能使用：explore, plan, coder, doc-writer, test-writer
   - 使用前必须调用 list_agents 确认

2. **禁止无限制的任务范围**
   - 必须明确指定要分析的目录/文件
   - 必须限制输出长度（不超过 500 字）

3. **禁止过长的超时**
   - 单个 member: 系统自动计算（基于策略+复杂度），无需手动设置
   - Debate 团队总计最长 60 分钟（30min 基础 × 2.0 轮次因子）
   - Hierarchical 团队总计最长 30 分钟

4. **禁止重复工作**
   - 不同 member 不应分析相同的文件
   - 使用 grep/glob 快速定位，避免逐文件读取

5. **必须有降级方案**
   - 如果 agent_team 失败，必须降级到单个 task
   - 不能让用户等待超过 10 分钟

---

## 📚 参考资源

- 可用 agent 列表：调用 `list_agents()`
- 详细使用指引：`.xuanji/agent-team-guide.md`
- 项目规则：`.xuanji/rules.md`
