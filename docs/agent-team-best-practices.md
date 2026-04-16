# Agent Team 配置最佳实践

## 超时配置 (Timeout Configuration)

### ❌ 常见错误

```json
{
  "timeout": 120000,  // 团队总超时 2 分钟
  "strategy": "parallel",
  "members": [
    {
      "id": "analyst",
      "timeout": 60000  // ❌ 显式设置，覆盖自动分配
    }
  ]
}
```

**问题**: 
- Parallel 策略下，每个成员应该独享 120s
- 显式设置 `member.timeout: 60000` 会覆盖自动分配
- 导致成员只有 60s，可能提前超时

---

### ✅ 正确做法

```json
{
  "timeout": 300000,  // 5 分钟（parallel 建议至少 5min）
  "strategy": "parallel",
  "members": [
    {
      "id": "analyst",
      // ⚠️ 不设置 timeout，让系统根据策略自动分配
      "capabilities": ["数据分析"]
    }
  ]
}
```

**效果**:
- 系统自动分配：每个成员获得 300s
- 日志显示: `analyst: 300000ms (300s) [auto]`

---

## 超时分配规则

### Parallel 策略
```
每个成员超时 = 团队总超时
```
**原因**: 并行执行，时间不叠加

### Sequential 策略
```
成员 1 超时 = 团队超时 / 成员数 × 1.5  (预留缓冲)
成员 2 超时 = 团队超时 / 成员数 × 1.25
成员 N 超时 = 团队超时 / 成员数 × 1.0
```
**原因**: 前面的成员需要更多时间理解问题

### Hierarchical 策略
```
Leader 超时 = 团队超时 × 50%
Workers 超时 = 团队超时 × 50% / Worker 数量
```

### Debate 策略
```
首轮成员超时 = 团队超时 × 40% / 成员数
后续轮次超时 = 团队超时 × 60% / (max_rounds - 1) / 成员数
```

---

## System Prompt 最佳实践

### ❌ 错误示例

```json
{
  "system_prompt": "你是依赖分析专家。分析以下 package.json：\n\n```json\n{\n  \"name\": \"xuanji\",\n  \"version\": \"1.0.0\",\n  ... (完整 120 行)\n}\n```\n\n请详细分析：\n1. 核心依赖及其用途\n2. 版本策略\n3. 潜在风险\n4. 优化建议"
}
```

**问题**:
- 嵌入完整文件内容 (~4000 tokens)
- 每次工具调用都携带，拖慢推理
- 首次响应延迟 +3~5s

---

### ✅ 正确示例

```json
{
  "goal": "阅读 /path/to/package.json 并从依赖管理、版本策略、风险评估三个维度给出 3-5 条关键发现",
  "members": [
    {
      "id": "dependency_analyst",
      "system_prompt": "你是 Node.js 依赖分析专家。阅读项目的 package.json 文件，给出 3-5 条依赖相关的关键发现和优化建议。输出要简洁、可执行。",
      "capabilities": ["依赖分析", "版本检查"]
    }
  ]
}
```

**改进**:
1. **Goal 包含文件路径** — 成员知道读取哪个文件
2. **System Prompt 精简** — 只有角色定义和输出要求
3. **让成员自己获取数据** — 调用 `read_file("package.json")`
4. **明确输出格式** — "3-5 条" 避免过长响应

---

## 任务描述 (Goal) 原则

### ✅ 自包含 (Self-Contained)

Goal 必须包含所有必要的上下文信息：

```json
{
  "goal": "分析 /Users/kevin/project/package.json，从依赖、脚本、配置三个方面给出优化建议（每方面 3-5 条）",
  "strategy": "parallel"
}
```

**子代理能获得的信息**:
- 目标文件: `/Users/kevin/project/package.json`
- 分析维度: 依赖、脚本、配置
- 输出格式: 每方面 3-5 条

---

### ❌ 依赖外部上下文

```json
{
  "goal": "分析这个 package.json，给出优化建议"
}
```

**问题**: 子代理不知道：
- 哪个文件？（路径缺失）
- 分析重点？（维度不明）
- 输出格式？（可能过长）

---

## 成员数量建议

| 策略 | 建议成员数 | 原因 |
|------|-----------|------|
| parallel | 2-5 | 太多会导致结果难以整合 |
| sequential | 3-6 | 太多会超时风险大 |
| hierarchical | 3-8 | Leader + Workers，可以更多 |
| debate | 2-4 | 太多会导致讨论混乱 |
| pipeline | 3-5 | 每个阶段 1 人，太多降低效率 |

---

## 超时预算建议

| 策略 | 成员数 | 最小团队超时 | 推荐超时 |
|------|--------|-------------|---------|
| parallel | 3 | 180s (3min) | 300s (5min) |
| sequential | 4 | 240s (4min) | 600s (10min) |
| hierarchical | 5 | 300s (5min) | 480s (8min) |
| debate | 3, max_rounds=3 | 360s (6min) | 600s (10min) |
| pipeline | 4 | 300s (5min) | 600s (10min) |

**计算公式**:
```
最小超时 = 成员数 × 60s × 策略系数

策略系数:
- parallel: 1.0 (并行不叠加)
- sequential: 1.0 (串行需缓冲)
- hierarchical: 1.2 (Leader 需更多时间)
- debate: max_rounds × 1.2 (多轮讨论)
- pipeline: 1.5 (有依赖，需预留)
```

---

## 监控和调试

### 查看超时分配

启动团队时，日志会显示：

```
[TeamManager] Team timeout allocation:
  Total timeout: 300000ms (300s)
  Strategy: parallel
  Members (3):
    - dependency_analyst: 300000ms (300s) [auto]
    - script_analyzer: 60000ms (60s) [explicit] ⚠️
    - config_reviewer: 300000ms (300s) [auto]
```

**关键标记**:
- `[auto]` — 自动分配（推荐）
- `[explicit]` — 用户显式设置
- `⚠️` — 显式设置小于自动分配（可能过短）

---

### 超时警告

运行时如果检测到配置问题，会输出警告：

```
⚠️  [script_analyzer] explicit timeout (60000ms) is shorter than calculated (300000ms). 
    This may cause premature termination. Consider removing member.timeout to use auto-allocation.
```

**解决方法**: 删除 `member.timeout` 字段

---

## 快速检查清单

使用 `agent_team` 工具前，检查：

- [ ] `timeout` >= 300000 (5 分钟) for parallel
- [ ] `timeout` >= 600000 (10 分钟) for sequential/debate
- [ ] **没有**设置 `member.timeout`（除非有特殊需求）
- [ ] `system_prompt` < 500 tokens（精简，不嵌入大量数据）
- [ ] `goal` 包含必要的文件路径和输出格式
- [ ] 成员数 <= 5（parallel 建议）
- [ ] 每个成员的 `capabilities` 精准、互斥

---

## 常见问题 (FAQ)

### Q1: 为什么 parallel 策略还会超时？

**A**: 检查是否显式设置了 `member.timeout`。即使团队超时是 300s，如果成员设置了 `timeout: 60000`，仍然只有 60s。

**解决**: 删除所有 `member.timeout` 字段。

---

### Q2: 如何让某个成员有更多时间？

**A**: 使用 `hierarchical` 策略 + `priority` 字段：

```json
{
  "strategy": "hierarchical",
  "members": [
    {
      "id": "leader",
      "priority": 10  // >= 8 自动成为 Leader，获得 50% 时间
    },
    { "id": "worker1" },
    { "id": "worker2" }
  ]
}
```

---

### Q3: 子代理读取文件太慢，如何优化？

**A**: 
1. **不要在 system_prompt 中嵌入文件内容** — 让成员自己 read_file
2. **Goal 明确输出格式** — "3-5 条关键发现"，避免过度分析
3. **降低 general-purpose 的 maxIterations** — 已优化到 15 次

---

### Q4: 如何判断超时是配置问题还是任务太复杂？

**A**: 查看日志：

```
[dependency_analyst] Tool calls: 12 iterations in 58s  ← 接近超时，可能任务复杂
[script_analyzer] Tool calls: 3 iterations in 62s     ← 超时但调用少，可能配置问题
```

**策略**:
- 如果迭代次数接近 `maxIterations` → 任务太复杂，简化 Goal
- 如果迭代次数少但超时 → 检查是否 `member.timeout` 设置过短

---

## 示例：完整的团队配置

```json
{
  "team_name": "package-health-check",
  "goal": "分析 /path/to/package.json 的健康状况，给出可执行的优化建议",
  "strategy": "parallel",
  "timeout": 300000,
  "max_rounds": 1,
  
  "members": [
    {
      "id": "dependency",
      "name": "依赖分析师",
      "capabilities": ["依赖审查", "版本检查", "安全扫描"],
      "system_prompt": "你是 Node.js 依赖专家。阅读 package.json 并从依赖质量、版本策略、安全风险三个角度给出 3-5 条关键发现和优化建议。"
    },
    {
      "id": "scripts",
      "name": "脚本分析师",
      "capabilities": ["脚本审查", "工作流优化"],
      "system_prompt": "你是构建脚本专家。分析 package.json 的 scripts 字段，给出 3-5 条工作流优化建议。"
    },
    {
      "id": "metadata",
      "name": "元数据审查员",
      "capabilities": ["配置审查", "发布优化"],
      "system_prompt": "你是 npm 发布专家。检查 package.json 的元数据（name, version, license, exports 等），给出 3-5 条改进建议。"
    }
  ]
}
```

**预期效果**:
- 每个成员获得 300s 超时（自动分配）
- 并行执行，总耗时约 60-120s
- System Prompt ~100 tokens/成员
- 成功率 > 95%

