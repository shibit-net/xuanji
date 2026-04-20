# Agent Team 五种策略使用手册

> 本手册详细说明 agent_team 的 5 种执行策略，帮助主 agent 选择最合适的策略

---

## 策略对比总览

| 策略 | 执行方式 | 总耗时 | 适用场景 | 推荐度 |
|------|---------|--------|---------|--------|
| **parallel** | 并行执行 | max(成员耗时) | 独立任务 | ⭐⭐⭐⭐⭐ |
| **sequential** | 顺序执行 | sum(成员耗时) | 有依赖关系 | ⭐⭐⭐ |
| **pipeline** | 流水线 | sum(成员耗时) | 数据流转 | ⭐⭐⭐⭐ |
| **hierarchical** | 层级协作 | 动态 | 主从关系 | ⭐⭐ |
| **debate** | 辩论模式 | 多轮迭代 | 多角度评估 | ⭐⭐⭐⭐ |

---

## 策略 1: parallel（并行执行）⭐⭐⭐⭐⭐

### 适用场景
- ✅ 子任务完全独立，无依赖关系
- ✅ 需要快速完成（总时间 = 最慢的那个 agent）
- ✅ 分析不同模块/目录
- ✅ 从多个角度检查同一项目

### 不适用场景
- ❌ 后续任务需要前面的结果
- ❌ 需要共享中间状态
- ❌ 任务之间有顺序依赖

### 执行特点
- **总耗时**: max(所有成员耗时) ≈ 最慢的那个
- **资源占用**: 高（多个 agent 同时运行）
- **结果汇总**: 需要手动汇总（使用单个 task）
- **失败处理**: 某个成员失败不影响其他成员

### 配置要点
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

### 标准模板：代码分析

```typescript
{
  team_name: "code-analysis-parallel",
  goal: "并行分析项目的架构、安全、质量",
  strategy: "parallel",
  timeout: 300000,
  members: [
    {
      id: "structure",
      role: "explore",
      priority: 1,
      timeout: 120000,
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
      timeout: 180000,
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

// 第二阶段：汇总
task({
  description: "基于以上 4 位专家的分析，生成最终报告...",
  subagent_type: "plan",
  timeout: 120000
})
```

### 使用建议
1. **成员数量**: 3-5 个最佳（太多会增加协调成本）
2. **超时设置**: 单个成员 2-3 分钟，团队总计 5 分钟
3. **任务拆分**: 确保每个成员的任务完全独立
4. **结果汇总**: 使用单个 task 汇总所有成员的输出

### 性能预期
- **3 个成员**: 约 3 分钟
- **4 个成员**: 约 3-4 分钟
- **5 个成员**: 约 4-5 分钟

---

## 策略 2: sequential（顺序执行）⭐⭐⭐

### 适用场景
- ✅ 后续任务依赖前面的结果
- ✅ 需要逐步细化分析
- ✅ 任务有明确的先后顺序
- ✅ 需要传递上下文

### 不适用场景
- ❌ 任务完全独立（应该用 parallel）
- ❌ 对速度要求高（会很慢）
- ❌ 成员数量过多（> 3 个）

### 执行特点
- **总耗时**: sum(所有成员耗时) = 累加
- **资源占用**: 低（一次只运行一个 agent）
- **结果汇总**: 自动传递给下一个成员
- **失败处理**: 前面失败会阻塞后续

### 配置要点
```typescript
{
  strategy: "sequential",
  timeout: 600000,  // 团队总超时 = 所有成员超时之和
  members: [
    {
      id: "step1",
      timeout: 120000,
      system_prompt: "第一步：收集信息，输出结构化数据"
    },
    {
      id: "step2",
      timeout: 180000,
      system_prompt: "第二步：基于上一步的输出，进行深度分析"
    },
    {
      id: "step3",
      timeout: 120000,
      system_prompt: "第三步：基于分析结果，生成最终报告"
    }
  ]
}
```

### 标准模板：逐步分析

```typescript
{
  team_name: "step-by-step-analysis",
  goal: "逐步分析项目并生成报告",
  strategy: "sequential",
  timeout: 600000,
  members: [
    {
      id: "collector",
      role: "explore",
      priority: 1,
      timeout: 120000,
      system_prompt: `第一步：收集项目基础信息
1. 列出 src/ 的目录结构
2. 统计文件数量和代码行数
3. 识别核心模块
4. 输出 JSON 格式的结构化数据

限时 2 分钟。`
    },
    {
      id: "analyzer",
      role: "plan",
      priority: 2,
      timeout: 240000,
      system_prompt: `第二步：基于上一步的结构化数据，深度分析
1. 读取核心模块的代码
2. 分析架构设计和模块依赖
3. 识别潜在问题
4. 输出分析报告（不超过 1000 字）

限时 4 分钟。`
    },
    {
      id: "reporter",
      role: "plan",
      priority: 3,
      timeout: 120000,
      system_prompt: `第三步：基于分析报告，生成最终建议
1. 总结关键发现
2. 按优先级排序问题
3. 提供可操作的改进建议
4. 输出最终报告（不超过 800 字）

限时 2 分钟。`
    }
  ]
}
```

### 使用建议
1. **成员数量**: 2-3 个最佳（太多会很慢）
2. **超时设置**: 单个成员 2-4 分钟，团队总计 8-10 分钟
3. **数据传递**: 前一个成员的输出会自动传递给下一个
4. **错误处理**: 如果前面失败，整个流程中止

### 性能预期
- **2 个成员**: 约 4-6 分钟
- **3 个成员**: 约 6-10 分钟
- **4 个成员**: 约 10-15 分钟（不推荐）

### 何时使用
- 需要逐步细化的任务（探索 → 分析 → 报告）
- 后续步骤强依赖前面的结果
- 不在意总耗时（可以接受 10 分钟）

---

## 策略 3: pipeline（流水线）⭐⭐⭐⭐

### 适用场景
- ✅ 数据需要经过多个处理阶段
- ✅ 每个阶段输出结构化数据
- ✅ 类似 ETL 流程（提取 → 转换 → 加载）
- ✅ 需要明确的数据流转

### 不适用场景
- ❌ 任务完全独立（应该用 parallel）
- ❌ 不需要数据流转（应该用 sequential）
- ❌ 数据格式不统一

### 执行特点
- **总耗时**: sum(所有成员耗时) = 累加
- **资源占用**: 低（一次只运行一个 agent）
- **结果汇总**: 自动流转到下一阶段
- **失败处理**: 前面失败会阻塞后续

### 配置要点
```typescript
{
  strategy: "pipeline",
  timeout: 600000,
  members: [
    {
      id: "extract",
      timeout: 120000,
      system_prompt: "提取数据，输出 JSON: {data: [...]}"
    },
    {
      id: "transform",
      timeout: 180000,
      system_prompt: "读取上一步的 JSON，转换数据，输出新的 JSON"
    },
    {
      id: "load",
      timeout: 120000,
      system_prompt: "读取转换后的 JSON，生成最终报告"
    }
  ]
}
```

### 标准模板：数据处理流水线

```typescript
{
  team_name: "data-pipeline",
  goal: "提取、转换、分析项目数据",
  strategy: "pipeline",
  timeout: 600000,
  members: [
    {
      id: "extractor",
      role: "explore",
      priority: 1,
      timeout: 120000,
      system_prompt: `阶段 1：提取项目元数据
1. 使用 glob 查找所有 TypeScript 文件
2. 使用 grep 统计代码行数
3. 识别核心模块和依赖关系
4. 输出 JSON 格式：
{
  "files": ["src/core/agent/AgentLoop.ts", ...],
  "modules": ["agent", "tools", "permission"],
  "stats": {"totalFiles": 99, "totalLines": 15000}
}

限时 2 分钟。`
    },
    {
      id: "transformer",
      role: "coder",
      priority: 2,
      timeout: 240000,
      system_prompt: `阶段 2：转换和分析数据
1. 读取上一阶段的 JSON 数据
2. 对每个核心模块进行代码质量分析
3. 识别问题和改进点
4. 输出 JSON 格式：
{
  "modules": [
    {"name": "agent", "issues": [...], "score": 7.5},
    ...
  ],
  "summary": "..."
}

限时 4 分钟。`
    },
    {
      id: "reporter",
      role: "plan",
      priority: 3,
      timeout: 120000,
      system_prompt: `阶段 3：生成最终报告
1. 读取上一阶段的分析结果
2. 按优先级排序问题
3. 生成可操作的改进建议
4. 输出 Markdown 格式的最终报告

限时 2 分钟。`
    }
  ]
}
```

### 使用建议
1. **成员数量**: 3-4 个最佳
2. **数据格式**: 使用 JSON 作为中间格式
3. **超时设置**: 单个成员 2-4 分钟，团队总计 8-10 分钟
4. **错误处理**: 每个阶段都要验证输入数据

### 性能预期
- **3 个阶段**: 约 6-8 分钟
- **4 个阶段**: 约 8-12 分钟

### 何时使用
- 需要多阶段数据处理
- 每个阶段输出结构化数据
- 类似 ETL 或数据分析流程

---

## 策略 4: hierarchical（层级协作）⭐⭐

### 适用场景
- ✅ 有明确的主从关系
- ✅ 需要一个协调者分配任务
- ✅ 工作者需要接受指令
- ✅ 动态任务分配

### 不适用场景
- ❌ 任务已经明确拆分（应该用 parallel）
- ❌ 不需要协调者（应该用其他策略）
- ❌ 任务简单（增加不必要的复杂度）

### 执行特点
- **总耗时**: 动态（取决于协调者的决策）
- **资源占用**: 中等
- **结果汇总**: 协调者负责汇总
- **失败处理**: 协调者可以重新分配任务

### 配置要点
```typescript
{
  strategy: "hierarchical",
  timeout: 600000,
  members: [
    {
      id: "coordinator",
      role: "plan",
      priority: 1,  // 最高优先级 = 协调者
      timeout: 180000,
      system_prompt: "你是协调者，负责分析任务并分配给工作者"
    },
    {
      id: "worker1",
      role: "coder",
      priority: 2,  // 较低优先级 = 工作者
      timeout: 180000,
      system_prompt: "你是工作者，执行协调者分配的任务"
    },
    {
      id: "worker2",
      role: "coder",
      priority: 2,
      system_prompt: "你是工作者，执行协调者分配的任务"
    }
  ]
}
```

### 标准模板：动态任务分配

```typescript
{
  team_name: "hierarchical-analysis",
  goal: "由协调者分配任务，工作者执行",
  strategy: "hierarchical",
  timeout: 600000,
  members: [
    {
      id: "coordinator",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你是项目分析协调者：
1. 分析项目结构，识别需要检查的模块
2. 将任务分配给 2 个工作者：
   - worker1: 负责 src/core/ 的分析
   - worker2: 负责 src/adapters/ 的分析
3. 收集工作者的报告并汇总
4. 生成最终建议

限时 3 分钟。`
    },
    {
      id: "worker1",
      role: "coder",
      priority: 2,
      timeout: 180000,
      system_prompt: `你是工作者 1：
1. 等待协调者分配任务
2. 执行分配的任务（分析 src/core/）
3. 输出分析报告
4. 将结果返回给协调者

限时 3 分钟。`
    },
    {
      id: "worker2",
      role: "coder",
      priority: 2,
      timeout: 180000,
      system_prompt: `你是工作者 2：
1. 等待协调者分配任务
2. 执行分配的任务（分析 src/adapters/）
3. 输出分析报告
4. 将结果返回给协调者

限时 3 分钟。`
    }
  ]
}
```

### 使用建议
1. **成员数量**: 1 个协调者 + 2-3 个工作者
2. **优先级设置**: 协调者 priority = 1，工作者 priority = 2
3. **超时设置**: 协调者和工作者各 3 分钟，团队总计 10 分钟
4. **任务分配**: 协调者需要明确指定每个工作者的任务

### 性能预期
- **1 协调者 + 2 工作者**: 约 6-9 分钟
- **1 协调者 + 3 工作者**: 约 9-12 分钟

### 何时使用
- 任务需要动态分配
- 需要一个"管理者"角色
- 工作者的任务取决于初步分析结果

### 注意事项
⚠️ **不推荐频繁使用**，因为：
- 增加了协调开销
- 总耗时通常比 parallel 长
- 实现复杂度高

---

## 策略 5: debate（辩论模式）⭐⭐⭐⭐

### 适用场景
- ✅ 需要多个角度评估同一问题
- ✅ 技术方案对比（方案A vs 方案B）
- ✅ 需要辩论和反驳
- ✅ 决策需要充分论证

### 不适用场景
- ❌ 任务有明确答案（不需要辩论）
- ❌ 时间紧迫（辩论需要多轮）
- ❌ 只需要一个视角

### 执行特点
- **总耗时**: 多轮迭代（3-5 轮）
- **资源占用**: 中等
- **结果汇总**: 评审者给出最终结论
- **失败处理**: 可以提前结束辩论

### 配置要点
```typescript
{
  strategy: "debate",
  max_rounds: 3,  // 最多 3 轮辩论
  timeout: 600000,
  members: [
    {
      id: "advocate",
      timeout: 180000,
      system_prompt: "你支持方案 A，提供论据和证据"
    },
    {
      id: "opponent",
      timeout: 180000,
      system_prompt: "你支持方案 B，反驳方案 A 并提供论据"
    },
    {
      id: "judge",
      timeout: 120000,
      system_prompt: "你是评审，基于双方论述给出最终结论"
    }
  ]
}
```

### 标准模板：技术选型辩论

```typescript
{
  team_name: "tech-decision-debate",
  goal: "评估 React vs Vue 用于新项目",
  strategy: "debate",
  max_rounds: 3,
  timeout: 600000,
  members: [
    {
      id: "react_advocate",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持使用 React：
1. 论述 React 的优势：
   - 生态系统丰富（Next.js、React Native）
   - 社区活跃，资源多
   - 团队熟悉度高
   - 性能优秀（虚拟 DOM、Fiber）
2. 反驳 Vue 的论点
3. 提供具体数据和案例

每轮限时 3 分钟。`
    },
    {
      id: "vue_advocate",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持使用 Vue：
1. 论述 Vue 的优势：
   - 学习曲线平缓
   - 开发效率高（模板语法）
   - 文档质量优秀
   - 渐进式框架，灵活性强
2. 反驳 React 的论点
3. 提供具体数据和案例

每轮限时 3 分钟。`
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: `你是中立的技术评审：
1. 评估双方的论述质量
2. 考虑项目实际需求：
   - 团队技能
   - 项目规模
   - 时间预算
   - 长期维护
3. 给出最终建议和理由

限时 2 分钟。`
    }
  ]
}
```

### 使用建议
1. **成员数量**: 2 个辩论者 + 1 个评审
2. **轮次设置**: 3 轮最佳（太多会很慢）
3. **超时设置**: 每个辩论者 3 分钟/轮，评审 2 分钟
4. **论述要求**: 要求提供具体数据和案例

### 性能预期
- **3 轮辩论**: 约 8-10 分钟
- **5 轮辩论**: 约 12-15 分钟

### 何时使用
- 技术选型决策（框架、数据库、架构）
- 需要充分论证的决策
- 有多个可行方案需要对比

### 辩论流程
```
第 1 轮：
  - advocate: 提出论点
  - opponent: 提出反驳
  - judge: 评估

第 2 轮：
  - advocate: 回应反驳，补充论据
  - opponent: 继续反驳，提供证据
  - judge: 评估

第 3 轮：
  - advocate: 总结论点
  - opponent: 总结论点
  - judge: 给出最终结论
```

---

## 策略选择决策树

```
任务是否可以拆分为 3+ 个独立子任务？
├─ 否 → 使用单个 agent (task 工具)
└─ 是 → 继续判断

子任务是否完全独立？
├─ 是 → strategy: "parallel" ⭐ 最快
└─ 否 → 继续判断

是否需要多角度评估同一问题？
├─ 是 → strategy: "debate" ⭐ 充分论证
└─ 否 → 继续判断

是否需要数据流转（前一步输出 → 后一步输入）？
├─ 是 → strategy: "pipeline" ⭐ 数据处理
└─ 否 → 继续判断

是否需要协调者动态分配任务？
├─ 是 → strategy: "hierarchical" ⚠️ 谨慎使用
└─ 否 → strategy: "sequential" ⚠️ 较慢
```

---

## 性能对比

| 场景 | parallel | sequential | pipeline | hierarchical | debate |
|------|----------|-----------|----------|--------------|--------|
| 代码分析 | 3-5 分钟 ⭐ | 10-15 分钟 | 8-12 分钟 | 9-12 分钟 | 不适用 |
| 技术选型 | 不适用 | 5-8 分钟 | 不适用 | 不适用 | 8-10 分钟 ⭐ |
| 数据处理 | 不适用 | 8-12 分钟 | 6-8 分钟 ⭐ | 不适用 | 不适用 |
| 模块分析 | 3-5 分钟 ⭐ | 12-18 分钟 | 不适用 | 9-12 分钟 | 不适用 |
| 方案对比 | 不适用 | 不适用 | 不适用 | 不适用 | 8-10 分钟 ⭐ |

---

## 最佳实践总结

### 优先级排序
1. **parallel** - 首选，最快，适用范围广
2. **debate** - 需要多角度评估时使用
3. **pipeline** - 数据处理流程时使用
4. **sequential** - 有明确依赖时使用
5. **hierarchical** - 谨慎使用，通常不推荐

### 通用建议
1. **优先考虑 parallel**：如果任务可以拆分为独立子任务
2. **限制成员数量**：3-5 个最佳，太多会增加协调成本
3. **设置合理超时**：单个成员 2-3 分钟，团队总计 5-10 分钟
4. **明确任务边界**：每个成员的任务要清晰、独立
5. **准备降级方案**：如果超时，降级到单个 task

### 避免的错误
- ❌ 使用 sequential 处理独立任务（应该用 parallel）
- ❌ 使用 parallel 处理有依赖的任务（应该用 sequential/pipeline）
- ❌ 成员数量过多（> 5 个）
- ❌ 超时设置过长（> 10 分钟）
- ❌ 任务边界不清晰（导致重复工作）

---

## 实战建议

### 代码分析任务
**推荐**: parallel
**配置**: 4 个成员（结构/安全/质量/架构）
**耗时**: 3-5 分钟

### 技术选型任务
**推荐**: debate
**配置**: 2 个辩论者 + 1 个评审
**耗时**: 8-10 分钟

### 数据处理任务
**推荐**: pipeline
**配置**: 3 个阶段（提取/转换/加载）
**耗时**: 6-8 分钟

### 逐步分析任务
**推荐**: sequential
**配置**: 3 个步骤（探索/分析/报告）
**耗时**: 6-10 分钟

### 动态任务分配
**推荐**: hierarchical（谨慎使用）
**配置**: 1 个协调者 + 2-3 个工作者
**耗时**: 9-12 分钟
iority: 2,  // 工作者
      timeout: 180000,
      system_prompt: "你是工作者，执行协调者分配的任务"
    },
    {
      id: "worker2",
      role: "coder",
      priority: 2,
      timeout: 180000,
      system_prompt: "你是工作者，执行协调者分配的任务"
    }
  ]
}
```

### 标准模板：主从协作

```typescript
{
  team_name: "hierarchical-analysis",
  goal: "协调者分配任务，工作者执行",
  strategy: "hierarchical",
  timeout: 600000,
  members: [
    {
      id: "coordinator",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你是项目分析协调者：
1. 分析项目结构，识别需要深入分析的模块
2. 将任务分配给 2 个工作者：
   - worker1: 分析前端相关模块
   - worker2: 分析后端相关模块
3. 收集工作者的分析结果
4. 生成综合报告

限时 3 分钟。`
    },
    {
      id: "worker1",
      role: "coder",
      priority: 2,
      timeout: 180000,
      system_prompt: `你是工作者 1：
1. 接收协调者分配的任务
2. 分析指定的前端模块
3. 报告发现的问题
4. 输出分析结果（不超过 500 字）

限时 3 分钟。`
    },
    {
      id: "worker2",
      role: "coder",
      priority: 2,
      timeout: 180000,
      system_prompt: `你是工作者 2：
1. 接收协调者分配的任务
2. 分析指定的后端模块
3. 报告发现的问题
4. 输出分析结果（不超过 500 字）

限时 3 分钟。`
    }
  ]
}
```

### 使用建议
1. **成员数量**: 1 个协调者 + 2-3 个工作者
2. **优先级**: 协调者 priority: 1，工作者 priority: 2
3. **超时设置**: 协调者和工作者各 3 分钟
4. **任务分配**: 协调者需要明确指定每个工作者的任务

### 性能预期
- **1 协调者 + 2 工作者**: 约 6-9 分钟
- **1 协调者 + 3 工作者**: 约 9-12 分钟

### 何时使用
- 任务需要动态分配
- 有明确的主从关系
- 需要协调者统筹全局

### ⚠️ 注意事项
- 这是最复杂的策略，通常不推荐使用
- 如果任务已经明确，直接用 parallel 更快
- 协调者的决策质量直接影响整体效果

---

## 策略 5: debate（辩论模式）⭐⭐⭐⭐

### 适用场景
- ✅ 需要多个角度评估同一问题
- ✅ 技术方案对比（方案A vs 方案B）
- ✅ 需要辩论和反驳
- ✅ 最终需要做出决策

### 不适用场景
- ❌ 任务已经有明确答案
- ❌ 不需要多角度评估
- ❌ 对速度要求高（会有多轮迭代）

### 执行特点
- **总耗时**: 多轮迭代（3-5 轮）
- **资源占用**: 中等
- **结果汇总**: 评审者做出最终决策
- **失败处理**: 可以提前终止辩论

### 配置要点
```typescript
{
  strategy: "debate",
  timeout: 480000,  // 8 分钟
  max_rounds: 3,    // 最多 3 轮辩论
  members: [
    {
      id: "advocate",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: "你支持方案 A，列出优势和理由"
    },
    {
      id: "opponent",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: "你支持方案 B，列出优势和理由"
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: "你是评审者，基于双方论述做出最终决策"
    }
  ]
}
```

### 标准模板：技术选型辩论

```typescript
{
  team_name: "tech-decision-debate",
  goal: "评估技术方案 A vs B",
  strategy: "debate",
  timeout: 480000,
  max_rounds: 3,
  members: [
    {
      id: "advocate_a",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持方案 A（使用 TypeScript + React）：
1. 列出 3 个核心优势
2. 分析适用场景
3. 评估实施成本
4. 反驳方案 B 的缺点
输出不超过 400 字。`
    },
    {
      id: "advocate_b",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `你支持方案 B（使用 Vue + Composition API）：
1. 列出 3 个核心优势
2. 分析适用场景
3. 评估实施成本
4. 反驳方案 A 的缺点
输出不超过 400 字。`
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: `你是技术评审者：
1. 对比两个方案的优劣
2. 考虑项目实际情况
3. 给出推荐方案和理由
4. 列出实施建议
输出不超过 500 字。`
    }
  ]
}
```

### 使用建议
1. **成员数量**: 2 个辩论者 + 1 个评审者
2. **轮次设置**: max_rounds: 2-3（太多会超时）
3. **超时设置**: 单个成员 3 分钟，团队总计 8 分钟
4. **评审标准**: 评审者需要明确的评估标准

### 性能预期
- **2 轮辩论**: 约 6-8 分钟
- **3 轮辩论**: 约 8-12 分钟

### 何时使用
- 技术选型决策
- 架构方案对比
- 需要多角度评估的问题

### 辩论流程
1. **第 1 轮**: 双方陈述各自方案的优势
2. **第 2 轮**: 双方反驳对方的缺点
3. **第 3 轮**: 评审者综合评估，做出决策

---

## 策略选择决策树

```
任务是否可以拆分为 3+ 个独立子任务？
├─ 否 → 使用单个 agent (task 工具)
└─ 是 → 继续判断

子任务是否完全独立？
├─ 是 → strategy: "parallel" ⭐ 最快
└─ 否 → 继续判断

是否需要多角度评估同一问题？
├─ 是 → strategy: "debate" ⭐ 适合技术选型
└─ 否 → 继续判断

是否需要数据流转（前一步输出 → 后一步输入）？
├─ 是 → strategy: "pipeline" ⭐ 适合 ETL
└─ 否 → 继续判断

是否有明确的主从关系？
├─ 是 → strategy: "hierarchical"
└─ 否 → strategy: "sequential"
```

---

## 性能对比

### 场景：分析 4 个模块

| 策略 | 执行方式 | 总耗时 | 推荐度 |
|------|---------|--------|--------|
| parallel | 4 个 agent 同时分析 | 3 分钟 | ⭐⭐⭐⭐⭐ |
| sequential | 4 个 agent 依次分析 | 12 分钟 | ⭐ |
| pipeline | 4 个阶段流水线 | 12 分钟 | ⭐⭐⭐ |
| hierarchical | 1 协调 + 3 工作者 | 9 分钟 | ⭐⭐ |
| debate | 不适用此场景 | - | - |

### 场景：技术选型

| 策略 | 执行方式 | 总耗时 | 推荐度 |
|------|---------|--------|--------|
| debate | 2 辩论 + 1 评审 | 8 分钟 | ⭐⭐⭐⭐⭐ |
| parallel | 2 方案并行分析 | 3 分钟 | ⭐⭐⭐ |
| sequential | 2 方案依次分析 | 6 分钟 | ⭐⭐ |

---

## 常见错误

### 错误 1: 用 sequential 处理独立任务
❌ **错误**:
```typescript
strategy: "sequential",  // 12 分钟
members: [
  { system_prompt: "分析模块 A" },
  { system_prompt: "分析模块 B" },
  { system_prompt: "分析模块 C" },
  { system_prompt: "分析模块 D" }
]
```

✅ **正确**:
```typescript
strategy: "parallel",  // 3 分钟
members: [
  { system_prompt: "分析模块 A" },
  { system_prompt: "分析模块 B" },
  { system_prompt: "分析模块 C" },
  { system_prompt: "分析模块 D" }
]
```

### 错误 2: 用 parallel 处理有依赖的任务
❌ **错误**:
```typescript
strategy: "parallel",
members: [
  { system_prompt: "收集项目信息" },
  { system_prompt: "基于项目信息分析架构" }  // 依赖第一步
]
```

✅ **正确**:
```typescript
strategy: "pipeline",
members: [
  { system_prompt: "收集项目信息，输出 JSON" },
  { system_prompt: "读取 JSON，分析架构" }
]
```

### 错误 3: 用 debate 处理非评估类任务
❌ **错误**:
```typescript
strategy: "debate",
members: [
  { system_prompt: "分析代码质量" },
  { system_prompt: "分析架构设计" }
]
```

✅ **正确**:
```typescript
strategy: "parallel",
members: [
  { system_prompt: "分析代码质量" },
  { system_prompt: "分析架构设计" }
]
```

---

## 总结

### 推荐优先级
1. **parallel** ⭐⭐⭐⭐⭐ - 最快，适用范围最广
2. **debate** ⭐⭐⭐⭐ - 技术选型、方案对比
3. **pipeline** ⭐⭐⭐⭐ - 数据处理、ETL 流程
4. **sequential** ⭐⭐⭐ - 有依赖关系的任务
5. **hierarchical** ⭐⭐ - 复杂度高，不推荐

### 快速选择指南
- **独立任务** → parallel
- **技术选型** → debate
- **数据流转** → pipeline
- **有依赖** → sequential
- **主从关系** → hierarchical

### 性能优化建议
1. 优先使用 parallel（最快）
2. 限制成员数量（3-5 个）
3. 设置合理超时（单个 2-3 分钟）
4. 避免重复工作
5. 使用快速工具（grep/glob）
