# 真实执行任务：agent_team 全场景覆盖测试（V5）

## 任务目标
用**真实 `agent_team` 工具调用**完成一次全场景覆盖验证，不走测试脚本，覆盖策略执行、成员配置、运行控制与失败路径，输出可审计结果。

## 覆盖范围
本任务要求覆盖以下场景：

1. 协作策略（5/5）
   - `sequential`
   - `parallel`
   - `hierarchical`
   - `debate`
   - `pipeline`
2. 成员配置
   - 使用预置角色（通过 `match_agent` 匹配）
   - 使用临时成员（不填 `role`，走 `general-purpose` 回退）
   - 自定义 `system_prompt`
   - 自定义 `tools`
3. 运行控制
   - `max_rounds`（用于 debate）
   - `timeout`
   - 输出元数据：`strategy`、`duration`、`rounds`、`memberCount`、`totalTokens`、`success`、`timedOut`
4. 失败路径
   - `members=[]`（应报错）
   - `members.length > 10`（应报错）

---

## 执行约束（硬性）
- 必须直接调用 `agent_team` 工具执行，不通过 `npm test` 或任何测试脚本替代。
- 每个场景都要记录：入参摘要、关键输出、是否符合预期。
- 每个成功场景都要保留 TeamTool 标准输出头部信息：
  - `Team "..." - Strategy: ...`
  - `Duration`
  - `Rounds`
  - `Members`
  - `Tokens`
  - `Success/Failed`

---

## 执行步骤

### Step 0：成员匹配预热（保证真实角色分工）
先调用 `match_agent` 为以下职责匹配可用预置 agent（匹配不到就回退 `general-purpose`）：
- 架构审查
- 安全审查
- 性能审查
- 研究分析
- 报告整理

记录匹配结果（agent id + score）。

### Step 1：五种策略真实执行

#### 1) Sequential（顺序审查）
目标：审查 `src/core/tools/TeamTool.ts` 的架构/安全/性能。

#### 2) Parallel（并行调研）
目标：并行调研“多 Agent 编排在 CLI 工程中的最佳实践”，三个成员独立产出。

#### 3) Hierarchical（层级分工）
目标：由 Tech Lead 先拆解“agent_team 可观测性增强”方案，再分派给实现/验证成员。

#### 4) Debate（多轮辩论）
目标：讨论“默认应使用预置 agent 还是临时 agent”，至少 2 轮，`max_rounds=3`。

#### 5) Pipeline（流水线）
目标：`package.json` 依赖数据流转：提取 → 分类 → 风险分析 → 报告。

### Step 2：失败路径执行

#### 6) 空成员
`members: []`，预期错误：`Team must have at least one member`。

#### 7) 超过上限
构造 11 个成员，预期错误：`Maximum team size is 10 members`。

### Step 3：输出最终报告
把每个场景的结果汇总到：
- `tests/multi-agent/REAL_TASK_V5_REPORT.md`

报告必须包含：
- 场景清单与通过率
- 每个场景关键输出摘要
- 失败场景是否命中预期错误
- 结论：`agent_team` 是否达到可用基线

---

## 场景验收标准

### 必须通过
- 五种策略全部执行成功，并且 `strategy` 与场景一致。
- 五种策略输出均含成员摘要与 team 输出。
- Debate 场景 `rounds` 在 `1..max_rounds` 范围内。
- Pipeline 场景输出包含清晰阶段性结果（提取/清洗/分析/报告）。
- 两个失败路径都返回预期报错文本。

### 判定为覆盖完成的条件
- 场景总数 7 个全部执行。
- 通过数 >= 7（含失败路径“按预期失败”）。
- 最终报告文件已生成且可复核。

---

## 建议直接调用模板（示例）

```text
agent_team({
  team_name: "AT-V5-Sequential",
  goal: "审查 src/core/tools/TeamTool.ts，从架构、安全、性能三个维度给出可落地改进建议，每个维度至少2条",
  strategy: "sequential",
  members: [
    { id: "arch", role: "general-purpose", capabilities: ["architecture-review"] },
    { id: "sec", role: "general-purpose", capabilities: ["security-review"] },
    { id: "perf", capabilities: ["performance-review"], system_prompt: "只输出性能瓶颈和优化建议" }
  ],
  timeout: 120000
})
```

```text
agent_team({
  team_name: "AT-V5-Parallel",
  goal: "并行调研多 Agent 编排最佳实践，分别产出文档视角、实现视角、工程落地视角",
  strategy: "parallel",
  members: [
    { id: "doc", capabilities: ["documentation-research"] },
    { id: "impl", capabilities: ["implementation-analysis"] },
    { id: "eng", capabilities: ["engineering-practice"] }
  ],
  timeout: 120000
})
```

```text
agent_team({
  team_name: "AT-V5-Hierarchical",
  goal: "设计 agent_team 可观测性增强方案，先由 leader 拆解任务，再由成员执行并回收结果",
  strategy: "hierarchical",
  members: [
    { id: "lead", role: "general-purpose", capabilities: ["planning", "task-decomposition"], priority: 10 },
    { id: "impl", capabilities: ["implementation"], priority: 6, tools: ["read_file", "edit_file"] },
    { id: "qa", capabilities: ["verification", "risk-audit"], priority: 5 }
  ],
  timeout: 120000
})
```

```text
agent_team({
  team_name: "AT-V5-Debate",
  goal: "辩论：默认优先预置 agent 还是临时 agent。要求展示分歧、论据、折中方案和最终共识",
  strategy: "debate",
  members: [
    { id: "preset", capabilities: ["stability-first", "governance"] },
    { id: "temporary", capabilities: ["flexibility-first", "iteration-speed"] },
    { id: "moderator", capabilities: ["tradeoff-analysis", "consensus-building"] }
  ],
  max_rounds: 3,
  timeout: 120000
})
```

```text
agent_team({
  team_name: "AT-V5-Pipeline",
  goal: "处理 package.json 依赖：提取依赖 -> 按 prod/dev 分类 -> 识别风险依赖 -> 生成整改建议报告",
  strategy: "pipeline",
  members: [
    { id: "extract", capabilities: ["dependency-extraction"], priority: 4 },
    { id: "clean", capabilities: ["data-classification"], priority: 3 },
    { id: "analyze", capabilities: ["risk-analysis"], priority: 2 },
    { id: "report", capabilities: ["report-generation"], priority: 1 }
  ],
  timeout: 120000
})
```

---

## 输出记录模板

```markdown
## 场景 X - [名称]
- 输入摘要：
- 执行结果：成功 / 失败（按预期）
- 输出关键字段：strategy=, rounds=, memberCount=, success=, timedOut=
- 关键结论：
- 验收判定：✅ / ❌
```
