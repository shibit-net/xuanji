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

根据任务特征选择策略（详见 `agent-team-strategies.md`）：

```
IF 子任务完全独立 AND 无依赖关系
  → strategy: "parallel"  ⭐ 优先选择（最快）
  
ELSE IF 需要多角度评估同一问题（技术选型、方案对比）
  → strategy: "debate"  ⭐ 充分论证
  
ELSE IF 需要数据流转（前一步输出 → 后一步输入）
  → strategy: "pipeline"  ⭐ 数据处理
  
ELSE IF 子任务有明确的顺序依赖
  → strategy: "sequential"  ⚠️ 较慢
  
ELSE IF 需要协调者动态分配任务
  → strategy: "hierarchical"  ⚠️ 谨慎使用
  
ELSE
  → 重新评估任务拆分，或使用单个 agent
```

**详细策略说明**: 参见 `.xuanji/protocols/agent-team-strategies.md`

### 3. 成员配置检查（MANDATORY）

每个 member 必须满足：

```
[ ] id: 唯一标识符（小写字母+下划线）
[ ] role: 使用正确的 agent ID（explore/plan/coder/doc-writer/test-writer）
[ ] system_prompt: 包含以下要素：
    [ ] 明确的任务范围（只分析 X 目录/文件）
    [ ] 具体的检查点（3-5 个要点）
    [ ] 输出格式要求（Markdown/JSON/不超过 X 字）
    [ ] 时间限制提示（限时 X 分钟）
[ ] timeout: 设置合理超时（60000-180000ms）
```

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
      system_prompt: "明确的独立任务，不依赖其他成员的结果"
    },
    {
      id: "member2",
      timeout: 120000,
      system_prompt: "另一个完全独立的任务"
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
      role: "explore",  // 快速探索
      priority: 1,
      timeout: 120000,  // 2 分钟
      system_prompt: `快速收集项目结构：
1. list_directory(path: "src/", recursive: true, max_depth: 2)
2. glob(pattern: "**/*.ts", path: "src/")
3. 输出 JSON: {directories: [...], fileCount: N, coreModules: [...]}
限时 2 分钟，只收集信息不分析。`
    },
    {
      id: "security",
      role: "coder",
      priority: 1,
      timeout: 180000,  // 3 分钟
      system_prompt: `检查安全问题：
1. grep(pattern: "exec\\(|spawn\\(", path: "src/")
2. 读取 src/core/tools/BashTool.ts 检查参数处理
3. 输出 Top 3 安全风险（每个不超过 100 字）
使用 grep 快速定位，限时 3 分钟。`
    },
    {
      id: "quality",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `检查代码质量：
1. grep(pattern: "\\bany\\b", path: "src/", output_mode: "count")
2. 读取 src/core/agent/AgentLoop.ts 检查复杂度
3. 输出 Top 3 质量问题（每个不超过 100 字）
限时 3 分钟。`
    },
    {
      id: "architecture",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `分析架构设计：
1. 读取 src/core/*/types.ts 的接口定义
2. 检查 package.json 的依赖结构
3. 输出架构优缺点（不超过 300 字）
限时 3 分钟。`
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

### 模板 2：技术选型（辩论模式）

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
system_prompt: "分析整个项目的代码质量"  // 太宽泛
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
  { id: "analyzer1", system_prompt: "分析项目架构" },
  { id: "analyzer2", system_prompt: "分析项目设计" }  // 会重复读取文件
]
```

✅ **正确示例**：
```typescript
members: [
  { id: "structure", system_prompt: "只分析目录结构和模块划分" },
  { id: "dependency", system_prompt: "只分析 package.json 的依赖关系" }
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
2. 编写明确的 system_prompt（包含范围、检查点、输出格式）
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

## 📊 性能基准

| 场景 | 推荐策略 | 成员数量 | 预期耗时 | 成功率 |
|------|---------|---------|---------|--------|
| 代码分析 | parallel | 3-4 | 3-5 分钟 | 95% |
| 技术选型 | debate | 3 | 5-8 分钟 | 90% |
| 模块分析 | parallel | 3-5 | 3-5 分钟 | 95% |
| 重构方案 | sequential | 2-3 | 5-10 分钟 | 85% |

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

4. 我的 system_prompt 足够明确吗？
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
   - 单个 member 最长 3 分钟
   - 团队总计最长 10 分钟

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
