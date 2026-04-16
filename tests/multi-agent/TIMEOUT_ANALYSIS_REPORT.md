# Agent Team 超时机制分析报告

## 📊 执行超时原因总结

**本次执行**: hierarchical 策略，239.8s 超时  
**问题**: Leader (architect) 执行超时，未能完成分析任务

---

## 🔍 超时机制详解

### 1. 默认超时配置

#### Team 层级（`src/core/agent/team/types.ts`）
```typescript
export const DEFAULT_TEAM_CONFIG = {
  maxRounds: 10,
  timeout: 1_200_000, // 20 分钟 (1200s)
  enableSharedKnowledge: true,
  recordHistory: true,
}
```

#### SubAgent 层级（`src/core/agent/SubAgentContext.ts`）
```typescript
export const DEFAULT_TIMEOUT = 300_000; // 5 分钟 (300s)
export const DEFAULT_MAX_ITERATIONS = 30;
```

---

### 2. Hierarchical 策略超时分配逻辑

**源码位置**: `src/core/agent/team/TeamManager.ts:645-688`

```typescript
private calculateMemberTimeout(member: TeamMember): number {
  const teamTimeout = this.context!.config.timeout!; // 默认 1200s
  const strategy = this.context!.config.strategy;
  const memberCount = this.context!.config.members.length;
  const MIN_TIMEOUT = 30_000; // 30s

  let perMemberTimeout: number;
  switch (strategy) {
    case 'hierarchical': {
      // leader 和 workers 均摊整体预算
      perMemberTimeout = Math.floor(teamTimeout / memberCount);
      break;
    }
    // ...
  }

  const result = Math.max(perMemberTimeout, MIN_TIMEOUT);
  return result;
}
```

**本次执行计算**:
- Team 超时: 默认 1200s (未显式指定)
- 成员数: 5 (architect + 4 专家)
- **每个成员超时**: `1200s / 5 = 240s`

---

### 3. 实际超时时间链路

```
┌─────────────────────────────────────────────────┐
│  Agent Team (hierarchical)                      │
│  总超时: 1200s (DEFAULT_TEAM_CONFIG.timeout)    │
│  ┌───────────────────────────────────────────┐  │
│  │  Leader (architect)                       │  │
│  │  分配超时: 1200s / 5 = 240s               │  │
│  │  实际执行: 239.8s (超时退出)              │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  SubAgent (coder)                   │  │  │
│  │  │  继承超时: 240s                      │  │  │
│  │  │  执行任务: 分析项目架构              │  │  │
│  │  │  可能调用: bash/read_file/grep 等   │  │  │
│  │  │  → 超时触发 (239.8s ≈ 240s)         │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  Workers (4个专家) - 未执行                      │
│  ❌ parallel: code_quality, dependency_auditor  │
│  ❌ parallel: test_analyst, performance_expert  │
└─────────────────────────────────────────────────┘
```

**超时触发点**: `src/core/agent/team/TeamManager.ts:174-182`
```typescript
const teamTimeoutPromise = new Promise<never>((_, reject) => {
  timeoutHandle = setTimeout(() => {
    this.running = false;
    reject(new Error(
      `Team "${this.context!.config.name}" timed out after ${(teamTimeout / 1000).toFixed(0)}s`
    ));
  }, teamTimeout);
});
```

---

## 🚨 问题根因

### 核心问题
**Hierarchical 策略的时间分配过于均摊**，未考虑 leader + workers 的执行顺序：

1. **Leader 独占 240s**（1/5 预算）
2. **Workers 并行执行，理论也需 240s**
3. **总需时间**: `240s (leader) + 240s (workers并行) = 480s`
4. **实际预算**: `1200s` ✅

但问题是：
- Leader 执行了复杂的项目分析任务（读文件、分析结构、生成规划）
- Leader 使用 `coder` 角色，默认有 30 次迭代上限
- Leader 可能尝试调用子任务（task tool），但受限于超时
- **240s 对于深度分析任务不足**

---

## 📈 各策略超时分配对比

| 策略          | 成员超时计算公式                                    | 5成员示例 (teamTimeout=1200s) | 说明                     |
|--------------|--------------------------------------------------|------------------------------|------------------------|
| **parallel**     | `teamTimeout`                                    | 每个 1200s                   | 并行执行，不叠加          |
| **sequential**   | `teamTimeout * 0.6`                              | 每个 720s                    | 串行，前面提前完成可留余额 |
| **hierarchical** | `teamTimeout / memberCount`                      | 每个 240s ⚠️                 | **均摊，leader 受限**     |
| **debate**       | `max(teamTimeout/(members×rounds), 60s)`         | 每轮每人 24s → 60s (取max)    | 多轮辩论，单轮时间短      |
| **pipeline**     | `teamTimeout * 0.6`                              | 每个 720s                    | 串行传递，同 sequential  |

---

## 💡 解决方案

### 方案 1: 增加 Team 总超时（推荐用于复杂任务）
```typescript
agent_team({
  team_name: "xuanji-analysis",
  goal: "...",
  strategy: "hierarchical",
  timeout: 3_600_000, // 60 分钟（原 20 分钟）
  members: [/* 5 个成员 */]
})
```
**效果**: 每个成员分配 `3600s / 5 = 720s` (12分钟)

---

### 方案 2: 优化 Hierarchical 分配算法（修改源码）

**建议改进**: Leader 占 50% 预算，Workers 均摊剩余 50%

```typescript
// src/core/agent/team/TeamManager.ts:666-670
case 'hierarchical': {
  // 改进：leader 占 50%，workers 均摊剩余 50%
  const isLeader = member.priority && member.priority > 0;
  perMemberTimeout = isLeader
    ? Math.floor(teamTimeout * 0.5)          // Leader: 50%
    : Math.floor(teamTimeout * 0.5 / (memberCount - 1)); // Workers: 均摊剩余
  break;
}
```

**效果** (5成员, 1200s):
- Leader: 600s
- 4 Workers: 150s each (并行，总耗 150s)
- **总预算**: 600s + 150s = 750s ✅

---

### 方案 3: 精简 Leader 任务复杂度（应用层优化）

**当前问题**: Leader (architect) 的任务描述过于庞大：
```
全面分析 xuanji 项目的代码架构、质量、依赖、测试覆盖和潜在改进点，
输出结构化的诊断报告

你的任务是：
1. 理解项目整体结构和分层设计
2. 识别核心模块和关键依赖关系
3. 将分析任务拆解并分配给各专家
4. 汇总所有分析结果，输出结构化报告
```

**优化方向**:
- Leader 只做规划，不做具体分析
- 缩短初始 goal 描述
- 避免 Leader 调用大量 read_file/bash 工具

---

### 方案 4: 使用显式成员超时（最灵活）

```typescript
members: [
  {
    id: "architect",
    role: "coder",
    timeout: 600_000, // Leader 单独给 10 分钟
    capabilities: ["任务规划", "结果汇总"],
    priority: 10
  },
  {
    id: "code_quality",
    role: "coder",
    timeout: 180_000, // Worker 3 分钟
    capabilities: ["代码审查"],
    priority: 5
  },
  // ...
]
```

---

## 📌 最佳实践建议

### 使用 Hierarchical 策略时
1. **明确 leader 职责**: 规划 + 汇总，不做具体执行
2. **设置合理超时**:
   - 简单任务 (goal < 100字): 默认 1200s 够用
   - 复杂任务 (goal > 200字): 2400s ~ 3600s
   - 深度分析 (涉及代码扫描): 3600s+
3. **控制成员数量**: 3-5 个最佳（过多会稀释单个成员超时）
4. **显式指定 leader timeout**: 给 leader 更多时间

### 调试技巧
```bash
# 查看实际分配的超时时间（日志）
grep "calculated timeout" ~/.xuanji/logs/*.log

# 示例输出
[architect] calculated timeout: 240000ms (strategy=hierarchical, teamTimeout=1200000ms, members=5)
```

---

## 🔧 本次失败的修复方案

**推荐**: 方案 1 + 方案 3

```typescript
agent_team({
  team_name: "xuanji-analysis",
  goal: "分析 xuanji 项目架构并规划任务分配",  // 精简 goal
  strategy: "hierarchical",
  timeout: 2_400_000, // 40 分钟（原 20 分钟）
  members: [
    {
      id: "architect",
      role: "coder",
      timeout: 900_000, // Leader 15 分钟
      capabilities: ["任务规划", "结果汇总"],
      priority: 10,
      system_prompt: "你负责规划任务并汇总结果，不需要执行具体分析。"
    },
    // Workers 保持默认（2400s / 5 = 480s）
    {
      id: "code_quality",
      role: "coder",
      capabilities: ["代码审查"],
      priority: 5,
      system_prompt: "..."
    },
    // ...
  ]
})
```

---

## 📊 超时日志示例

**失败场景**:
```
[Team "xuanji-project-analysis" - Strategy: hierarchical]
Duration: 239.8s | Rounds: 0 | Members: 1 | Tokens: 108125 in / 3637 out | ❌ Failed

[Member Execution Summary]
❌ architect: 239.8s, 111762 tokens
```

**成功场景** (如果超时足够):
```
[Team "xuanji-project-analysis" - Strategy: hierarchical]
Duration: 178.3s | Rounds: 1 | Members: 5 | Tokens: 245320 in / 12458 out | ✅ Success

[Member Execution Summary]
✅ architect: 82.1s, 55234 tokens
✅ code_quality: 45.2s, 32145 tokens
✅ dependency_auditor: 36.8s, 28934 tokens
✅ test_analyst: 38.5s, 30122 tokens
✅ performance_expert: 51.7s, 42821 tokens
```

---

## 🎯 总结

### 核心问题
- **Hierarchical 策略均摊超时**，未考虑 leader 和 workers 的串行-并行混合执行模式
- **默认 1200s / 5 成员 = 240s**，对复杂任务不足

### 解决方向
1. **增加总超时** (应用层，立即生效)
2. **优化分配算法** (源码层，长期优化)
3. **精简任务描述** (应用层，降低复杂度)
4. **显式成员超时** (应用层，最灵活)

### 推荐配置
```typescript
// 复杂分析任务的最佳实践
{
  timeout: 2_400_000,      // 40 分钟
  members: [
    { id: "leader", timeout: 900_000, priority: 10 },  // 15 分钟
    { id: "worker1", timeout: 480_000, priority: 5 },  // 8 分钟
    { id: "worker2", timeout: 480_000, priority: 5 },
    // ...
  ]
}
```

---

**报告生成时间**: 2026-04-15  
**分析版本**: xuanji v0.9.0  
**相关文件**:
- `src/core/agent/team/TeamManager.ts`
- `src/core/agent/team/types.ts`
- `src/core/agent/SubAgentContext.ts`
