# Agent Team 超时分配算法设计

> **版本**: 2.0  
> **作者**: 璇玑 AI 助手  
> **日期**: 2026-04-15  
> **基于**: xuanji v0.9.0 实测数据

---

## 📐 设计原则

### 1. 核心目标
- **安全性**: 防止无限制执行，保障系统资源
- **合理性**: 根据策略特点分配，避免不必要的超时
- **灵活性**: 支持用户自定义，提供智能推荐
- **可预测性**: 让用户能准确估算任务耗时

### 2. 约束条件
- **团队总超时 (T_total)**: 整个 team 的最大执行时间
- **成员数 (N)**: team 中 agent 数量
- **轮次数 (R)**: debate 模式的最大辩论轮数
- **最小超时 (T_min)**: 单个成员至少 30s（避免任务无法完成）

### 3. 设计维度
```
┌─────────────────────────────────────────────────┐
│  超时分配算法                                    │
│  ├─ 团队总超时 (T_total)                         │
│  ├─ 成员超时 (T_member)                         │
│  ├─ 缓冲系数 (Buffer Factor)                    │
│  └─ 优先级权重 (Priority Weight)                │
└─────────────────────────────────────────────────┘
```

---

## 🎯 五种策略超时算法

### 1. Parallel（并行执行）

#### 执行特征
```
Member 1 ━━━━━━━━━━━━━━━━━━━━━━━━→ (独立任务 A)
Member 2 ━━━━━━━━━━━━━━━━━━━━━━━━→ (独立任务 B)
Member 3 ━━━━━━━━━━━━━━━━━━━━━━━━→ (独立任务 C)
         ↑                        ↑
         开始                     T_total
实际耗时 = max(T1, T2, T3)
```

#### 分配算法
```typescript
// 每个成员独享全部时间预算
T_member = T_total

// 理由：并行执行，不相互阻塞，团队超时 = 最慢成员超时
```

#### 推荐团队超时
```typescript
// 基础公式
T_total = max(估算单任务最大耗时) + 缓冲时间(20%)

// 示例场景
场景A: 2个成员统计代码 + 搜索TODO
  - 估算: 每个成员 60s
  - T_total = 60s × 1.2 = 72s
  - T_member = 72s (每个成员)

场景B: 5个成员并行分析不同模块
  - 估算: 最慢的模块分析需 180s
  - T_total = 180s × 1.2 = 216s
  - T_member = 216s (每个成员)
```

#### 实测数据验证
```yaml
测试案例: Parallel Analysis (2成员)
  成员耗时: 27.1s, 36.4s
  团队总耗时: 36.4s (= max)
  配置: T_total = 300s, T_member = 300s
  余量: 263.6s (88.1% 未用) → 建议降低到 60s
```

---

### 2. Sequential（顺序执行）

#### 执行特征
```
Member 1 ━━━━━━→ (输出 → 输入) Member 2 ━━━━━━→ (输出 → 输入) Member 3 ━━━━━━→
         T1                     T2                              T3
实际耗时 = T1 + T2 + T3
```

#### 分配算法（当前实现）
```typescript
// 当前算法：每个成员 60% 的团队超时
T_member = T_total × 0.6

// 理由：
// 1. 如果前面成员提前完成，后续成员可用剩余时间
// 2. 避免过于紧张的时间预算
// 3. 团队总超时仍然生效（硬限制）
```

#### 问题分析
```
假设 T_total = 300s, N = 5
  T_member = 300 × 0.6 = 180s (每个成员)
  
理论最大耗时 = 180s × 5 = 900s
但团队超时只有 300s！
→ 如果前 2 个成员都用满 180s = 360s → 团队超时
→ 后 3 个成员永远没机会执行
```

#### 优化算法 v2.0（推荐）
```typescript
/**
 * Sequential 超时分配算法 v2.0
 * 
 * 策略：前松后紧，渐进式压缩
 * - 前期成员：给予充足时间，保障质量
 * - 后期成员：根据已消耗时间动态调整
 */

// 1️⃣ 预分配阶段（启动前）
function calculateSequentialTimeout(
  T_total: number,
  N: number,
  memberIndex: number // 0-based
): number {
  // 方案A: 均摊 + 缓冲系数
  const avgTime = T_total / N;
  const bufferFactor = 1.5 - (memberIndex / N) * 0.5;
  // 第1个成员: 1.5x, 最后成员: 1.0x
  
  return Math.floor(avgTime * bufferFactor);
}

// 2️⃣ 动态调整阶段（运行时）
function adjustTimeoutDynamically(
  T_total: number,
  T_used: number, // 已消耗时间
  remainingMembers: number
): number {
  const T_remaining = T_total - T_used - 30_000; // 保留 30s 缓冲
  if (T_remaining <= 0) return 30_000; // 最小保障
  
  return Math.floor(T_remaining / remainingMembers);
}

// 示例（T_total = 300s, N = 5）
成员 1: 300/5 × 1.5 = 90s  (前期充足)
成员 2: 300/5 × 1.4 = 84s
成员 3: 300/5 × 1.3 = 78s
成员 4: 300/5 × 1.2 = 72s
成员 5: 300/5 × 1.0 = 60s
理论总和: 384s > 300s (靠动态调整)

实际执行（假设每个成员用 50s）:
成员 1: 实际 50s, 剩余 250s
成员 2: 调整为 (250-30)/4 = 55s, 实际 50s, 剩余 200s
成员 3: 调整为 (200-30)/3 = 56s, 实际 50s, 剩余 150s
成员 4: 调整为 (150-30)/2 = 60s, 实际 50s, 剩余 100s
成员 5: 调整为 (100-30)/1 = 70s, 实际 50s
总耗时: 250s < 300s ✅
```

#### 推荐团队超时
```typescript
// 基础公式
T_total = Σ(估算单成员耗时) × 1.2

// 示例场景
场景A: 3步代码审查 (读取 → 分析 → 建议)
  - 估算: 30s + 60s + 45s = 135s
  - T_total = 135 × 1.2 = 162s
  - T_member(动态): [81s, 76s, 70s]

场景B: 5步数据处理流水线
  - 估算: 每步 60s = 300s
  - T_total = 300 × 1.2 = 360s
  - T_member(动态): [108s, 101s, 94s, 86s, 72s]
```

#### 实测数据验证
```yaml
测试案例: Sequential Code Review (2成员)
  成员耗时: 23.6s, 28.4s
  团队总耗时: 52.0s (= sum)
  配置: T_total = 300s, T_member = 180s (每个)
  余量: 248s (82.7% 未用) → 建议降低到 80s
```

---

### 3. Hierarchical（层级执行）

#### 执行特征
```
Leader (priority=10) ━━━━━━━━━━━━━━━→ (规划 + 汇总)
                     ↓ 分配任务
         ┌───────────┴───────────┬───────────┐
Worker 1 ━━━━━━→   Worker 2 ━━━━━━→   Worker 3 ━━━━━━→
(并行)            (并行)              (并行)

实际耗时 = T_leader + max(T_worker1, T_worker2, T_worker3)
```

#### 分配算法（当前实现 v1.0）
```typescript
// 当前算法：均摊
T_member = T_total / N

// 问题：Leader 和 Workers 任务复杂度不同，均摊不合理
```

#### 优化算法 v2.0（强烈推荐）
```typescript
/**
 * Hierarchical 超时分配算法 v2.0
 * 
 * 策略：Leader 主导，Workers 均摊剩余
 */

function calculateHierarchicalTimeout(
  T_total: number,
  N: number,
  member: TeamMember
): number {
  const isLeader = member.priority && member.priority >= 8;
  
  if (isLeader) {
    // Leader 占 40%-50% 预算（根据复杂度调整）
    return Math.floor(T_total * 0.5);
  } else {
    // Workers 均摊剩余 50%
    const workerCount = N - 1; // 假设只有 1 个 Leader
    return Math.floor((T_total * 0.5) / workerCount);
  }
}

// 示例（T_total = 1200s, N = 5: 1 Leader + 4 Workers）
Leader:    1200 × 0.5 = 600s
Worker 1:  1200 × 0.5 / 4 = 150s
Worker 2:  150s (并行)
Worker 3:  150s (并行)
Worker 4:  150s (并行)

理论耗时 = 600s (Leader) + 150s (Workers并行) = 750s < 1200s ✅
```

#### 进阶算法 v3.0（动态权重）
```typescript
/**
 * 根据 Leader 复杂度动态分配
 */

function calculateHierarchicalTimeoutV3(
  T_total: number,
  N: number,
  member: TeamMember,
  leaderComplexity: 'simple' | 'medium' | 'complex' = 'medium'
): number {
  const isLeader = member.priority && member.priority >= 8;
  
  // Leader 占比根据复杂度调整
  const leaderRatio = {
    simple: 0.3,   // 简单规划任务
    medium: 0.5,   // 中等复杂度
    complex: 0.7   // 深度分析任务
  }[leaderComplexity];
  
  if (isLeader) {
    return Math.floor(T_total * leaderRatio);
  } else {
    const workerCount = N - 1;
    return Math.floor((T_total * (1 - leaderRatio)) / workerCount);
  }
}

// 示例（T_total = 1200s, N = 5, complexity = 'complex'）
Leader:    1200 × 0.7 = 840s  (深度分析)
Worker 1:  1200 × 0.3 / 4 = 90s
Worker 2:  90s (并行)
Worker 3:  90s (并行)
Worker 4:  90s (并行)

理论耗时 = 840s + 90s = 930s < 1200s ✅
```

#### 推荐团队超时
```typescript
// 基础公式
T_total = T_leader_estimated + max(T_workers_estimated) + 缓冲(20%)

// 示例场景
场景A: 简单任务分配 (Leader 只做规划)
  - Leader: 60s (规划)
  - Workers: 120s (执行)
  - T_total = (60 + 120) × 1.2 = 216s
  - 分配: Leader 90s, Workers 60s each

场景B: 复杂项目分析 (Leader 深度分析)
  - Leader: 600s (分析整体架构)
  - Workers: 180s (分析各模块)
  - T_total = (600 + 180) × 1.2 = 936s
  - 分配: Leader 600s, Workers 150s each

场景C: 超大规模诊断 (本次失败案例)
  - Leader: 900s (全代码扫描)
  - Workers: 300s (专项分析)
  - T_total = (900 + 300) × 1.2 = 1440s
  - 分配: Leader 900s, Workers 300s each
```

#### 实测数据验证
```yaml
测试案例: Hierarchical Test Assessment (3成员: 1 Leader + 2 Workers)
  成员耗时: 
    - Leader: 43.5s
    - Worker1: 51.0s
    - Worker2: 127.8s
  团队总耗时: 171.3s (= T_leader + max(T_workers))
  配置: T_total = 300s, T_member = 100s (均摊)
  问题: Worker2 超时风险高 (127.8s / 100s = 128%)
  
失败案例: xuanji-project-analysis (5成员)
  配置: T_total = 1200s, T_member = 240s (均摊)
  Leader 耗时: 239.8s → 接近超时
  原因: Leader 执行复杂分析，240s 不足
  建议: T_total = 2400s, Leader = 1200s, Workers = 300s
```

---

### 4. Debate（辩论模式）

#### 执行特征
```
Round 1: Member 1 ━→ Member 2 ━→ Member 3 ━→ (同时发言)
Round 2: Member 1 ━→ Member 2 ━→ Member 3 ━→ (引用 Round 1)
Round 3: Member 1 ━→ Member 2 ━→ Member 3 ━→ (深入辩论)
...
实际耗时 = Σ(每轮所有成员发言时间)
```

#### 分配算法（当前实现）
```typescript
// 当前算法：每轮每成员至少 60s
T_member_per_round = max(T_total / (N × R), 60s)

// 问题：后续轮次可能更耗时（需要引用历史）
```

#### 优化算法 v2.0（渐进式）
```typescript
/**
 * Debate 超时分配算法 v2.0
 * 
 * 策略：首轮充足，后续递减
 * - 第 1 轮：成员需要理解问题 + 初步观点（较慢）
 * - 第 2+ 轮：基于已有观点反驳（较快）
 */

function calculateDebateTimeout(
  T_total: number,
  N: number,
  R: number,
  currentRound: number // 1-based
): number {
  const MIN_TIMEOUT = 60_000; // 60s
  
  // 方案A: 首轮占 40%，后续均摊剩余
  if (currentRound === 1) {
    const firstRoundTotal = T_total * 0.4;
    return Math.max(Math.floor(firstRoundTotal / N), MIN_TIMEOUT);
  } else {
    const remainingRounds = R - 1;
    const remainingTime = T_total * 0.6;
    const perRoundTime = remainingTime / remainingRounds;
    return Math.max(Math.floor(perRoundTime / N), MIN_TIMEOUT);
  }
}

// 示例（T_total = 600s, N = 3, R = 4）
Round 1: 600 × 0.4 / 3 = 80s per member
Round 2: 600 × 0.6 / 3 / 3 = 40s → 60s (取最小值)
Round 3: 60s
Round 4: 60s

理论总耗时 = 80×3 + 60×3×3 = 240 + 540 = 780s > 600s
→ 需要动态调整（基于实际已消耗时间）
```

#### 进阶算法 v3.0（动态调整）
```typescript
/**
 * 运行时动态调整（推荐）
 */

function adjustDebateTimeoutDynamically(
  T_total: number,
  T_used: number,
  remainingRounds: number,
  N: number
): number {
  const T_remaining = T_total - T_used - 60_000; // 保留 60s 缓冲
  if (T_remaining <= 0) return 60_000;
  
  const perMemberTime = T_remaining / (remainingRounds * N);
  return Math.max(Math.floor(perMemberTime), 60_000);
}

// 实际执行示例（T_total = 600s, N = 3, R = 4）
Round 1 预分配: 80s, 实际用 70s × 3 = 210s, 剩余 390s
Round 2 调整: (390-60)/(3×3) = 36s → 60s (取最小)
        实际用 60s × 3 = 180s, 剩余 210s
Round 3 调整: (210-60)/(2×3) = 25s → 60s
        实际用 50s × 3 = 150s, 剩余 60s
Round 4 调整: (60-60)/(1×3) = 0s → 60s (最小保障)
        实际用 40s × 3 = 120s
总耗时: 210 + 180 + 150 + 120 = 660s

→ 超过预算 60s，但在可接受范围（10%）
```

#### 推荐团队超时
```typescript
// 基础公式
T_total = N × R × T_avg_per_speech × 安全系数(1.5)

// 示例场景
场景A: 2人辩论 2 轮技术方案
  - 估算: 每次发言 60s
  - T_total = 2 × 2 × 60 × 1.5 = 360s
  - 分配: Round1 90s, Round2 60s (每人)

场景B: 3人辩论 4 轮架构设计
  - 估算: 每次发言 90s
  - T_total = 3 × 4 × 90 × 1.5 = 1620s (27分钟)
  - 分配: Round1 162s, Round2-4 108s (每人)

场景C: 5人辩论 3 轮超时策略
  - 估算: 每次发言 45s
  - T_total = 5 × 3 × 45 × 1.5 = 1012s (17分钟)
  - 分配: Round1 101s, Round2-3 67s (每人)
```

#### 实测数据验证
```yaml
测试案例: Timeout Strategy Debate (2成员, 2轮)
  Round 1: 36.8s, 16.3s
  Round 2: 11.6s, 147.7s
  团队总耗时: 212.4s
  配置: T_total = 300s, T_member_per_round = 60s
  问题: Round 2 某成员用时 147.7s (远超 60s)
  原因: 当前算法未严格限制单次发言时长
  建议: 增加单次发言硬限制（120s）
```

---

### 5. Pipeline（流水线）

#### 执行特征
```
Stage 1 ━━━━━━→ (输出) → Stage 2 ━━━━━━→ (输出) → Stage 3 ━━━━━━→
        T1                      T2                      T3
实际耗时 = T1 + T2 + T3 (严格串行，无重叠)
```

#### 分配算法（当前实现）
```typescript
// 当前算法：同 Sequential（每个成员 60% 的团队超时）
T_member = T_total × 0.6
```

#### 优化算法 v2.0（基于角色）
```typescript
/**
 * Pipeline 超时分配算法 v2.0
 * 
 * 策略：根据流水线阶段特点分配
 * - 输入阶段（Extractor/Reader）：可能较慢（I/O密集）
 * - 处理阶段（Transformer/Analyzer）：中等
 * - 输出阶段（Formatter/Writer）：较快
 */

function calculatePipelineTimeout(
  T_total: number,
  N: number,
  stageIndex: number, // 0-based
  stageType: 'input' | 'process' | 'output' = 'process'
): number {
  const avgTime = T_total / N;
  
  // 根据阶段类型调整权重
  const weights = {
    input: 1.3,    // 输入阶段慢 30%
    process: 1.0,  // 处理阶段基准
    output: 0.7    // 输出阶段快 30%
  };
  
  const weight = weights[stageType];
  return Math.floor(avgTime * weight);
}

// 示例（T_total = 300s, N = 3: Extractor → Transformer → Formatter）
Stage 1 (input):   300/3 × 1.3 = 130s
Stage 2 (process): 300/3 × 1.0 = 100s
Stage 3 (output):  300/3 × 0.7 = 70s
理论总和: 300s ✅
```

#### 进阶算法 v3.0（自适应）
```typescript
/**
 * 基于历史统计的自适应分配
 */

function calculatePipelineTimeoutAdaptive(
  T_total: number,
  stages: Array<{
    id: string;
    avgHistoricalTime?: number; // 历史平均耗时
  }>
): number[] {
  const N = stages.length;
  
  // 如果有历史数据，按比例分配
  const hasHistory = stages.every(s => s.avgHistoricalTime);
  if (hasHistory) {
    const totalHistorical = stages.reduce((sum, s) => sum + s.avgHistoricalTime!, 0);
    return stages.map(s => {
      const ratio = s.avgHistoricalTime! / totalHistorical;
      return Math.floor(T_total * ratio * 1.2); // 加 20% 缓冲
    });
  }
  
  // 无历史数据，均摊
  const avgTime = T_total / N;
  return stages.map(() => Math.floor(avgTime));
}

// 示例（有历史数据：60s, 120s, 30s, 总预算 300s）
历史总和: 210s
分配比例: [60/210, 120/210, 30/210] = [0.286, 0.571, 0.143]
分配超时: [300×0.286×1.2, 300×0.571×1.2, 300×0.143×1.2]
        = [103s, 206s, 51s]
理论总和: 360s > 300s (靠团队超时硬限制)
```

#### 推荐团队超时
```typescript
// 基础公式
T_total = Σ(估算各阶段耗时) × 1.15

// 示例场景
场景A: 3阶段数据处理 (提取 → 转换 → 输出)
  - 估算: 80s + 60s + 30s = 170s
  - T_total = 170 × 1.15 = 195s
  - 分配: [92s, 69s, 34s]

场景B: 5阶段复杂分析 (读取 → 解析 → 分析 → 汇总 → 输出)
  - 估算: 60s + 90s + 120s + 90s + 40s = 400s
  - T_total = 400 × 1.15 = 460s
  - 分配: [69s, 103s, 138s, 103s, 46s]
```

#### 实测数据验证
```yaml
测试案例: Pipeline Module Analysis (3阶段)
  阶段耗时: 94.7s, 8.0s, 78.7s
  团队总耗时: 181.4s
  配置: T_total = 300s, T_member = 180s (每个)
  问题: Stage 2 只用 8s，浪费 172s 预算
  建议: 使用自适应分配 [110s, 30s, 90s]
```

---

## 📊 综合对比表

| 策略 | 成员超时计算 | 团队超时推荐 | 缓冲系数 | 适用场景 |
|------|------------|-------------|---------|---------|
| **parallel** | `T_total` | `max(单任务耗时) × 1.2` | 1.2 | 独立并发任务 |
| **sequential** | 动态（前松后紧） | `Σ(单任务耗时) × 1.2` | 1.2 | 多步审查/处理 |
| **hierarchical** | Leader 50%, Workers 均摊 | `(T_leader + max(T_workers)) × 1.2` | 1.2 | 分工协作 |
| **debate** | 首轮 40%, 后续均摊 | `N × R × T_avg × 1.5` | 1.5 | 方案辩论 |
| **pipeline** | 按阶段特点调整 | `Σ(阶段耗时) × 1.15` | 1.15 | 数据流水线 |

---

## 🛠️ 实现建议

### 1. 配置优先级
```typescript
// 优先级：用户显式配置 > 智能推荐 > 默认值
TeamMember.timeout (显式)
  ↓ 未设置
calculateMemberTimeout(strategy, ...) (智能)
  ↓ 异常情况
DEFAULT_TIMEOUT (30s)
```

### 2. 代码结构
```typescript
// src/core/agent/team/TeamManager.ts

private calculateMemberTimeout(member: TeamMember): number {
  // 1. 用户显式配置优先
  if (member.timeout) {
    return member.timeout;
  }
  
  // 2. 根据策略智能计算
  const strategy = this.context!.config.strategy;
  switch (strategy) {
    case 'parallel':
      return this.calculateParallelTimeout(member);
    case 'sequential':
      return this.calculateSequentialTimeout(member);
    case 'hierarchical':
      return this.calculateHierarchicalTimeout(member);
    case 'debate':
      return this.calculateDebateTimeout(member);
    case 'pipeline':
      return this.calculatePipelineTimeout(member);
  }
}

private calculateHierarchicalTimeout(member: TeamMember): number {
  const T_total = this.context!.config.timeout!;
  const N = this.context!.config.members.length;
  const isLeader = member.priority && member.priority >= 8;
  
  if (isLeader) {
    // Leader 占 50%（可配置）
    const leaderRatio = this.context!.config.hierarchicalLeaderRatio ?? 0.5;
    return Math.floor(T_total * leaderRatio);
  } else {
    const workerCount = this.context!.config.members.filter(
      m => !m.priority || m.priority < 8
    ).length;
    return Math.floor((T_total * 0.5) / workerCount);
  }
}
```

### 3. 配置扩展
```typescript
// src/core/agent/team/types.ts

export interface TeamConfig {
  // ... 现有字段
  
  // 🆕 策略特定配置
  hierarchicalLeaderRatio?: number; // hierarchical: Leader 占比 (默认 0.5)
  debateFirstRoundRatio?: number;   // debate: 首轮占比 (默认 0.4)
  pipelineStageWeights?: number[];  // pipeline: 各阶段权重 (默认均匀)
  
  // 🆕 超时配置
  enableDynamicTimeout?: boolean;   // 是否启用动态调整 (默认 true)
  minMemberTimeout?: number;        // 最小成员超时 (默认 30s)
  bufferFactor?: number;            // 缓冲系数 (默认根据策略)
}
```

### 4. 日志增强
```typescript
// 启动时输出超时分配方案
log.info(`[Team "${teamName}"] Timeout Allocation:`);
log.info(`  Total: ${T_total}ms (${(T_total/1000).toFixed(0)}s)`);
log.info(`  Strategy: ${strategy}`);
members.forEach(m => {
  const timeout = calculateMemberTimeout(m);
  log.info(`  - ${m.id}: ${timeout}ms (${(timeout/1000).toFixed(0)}s)`);
});
```

---

## 📈 推荐默认值

### 当前默认值（xuanji v0.9.0）
```typescript
export const DEFAULT_TEAM_CONFIG = {
  maxRounds: 10,
  timeout: 1_200_000, // 20 分钟
  enableSharedKnowledge: true,
  recordHistory: true,
}
```

### 优化建议（v2.0）
```typescript
export const DEFAULT_TEAM_CONFIG = {
  maxRounds: 10,
  timeout: 1_800_000, // 🔄 调整为 30 分钟（更宽裕）
  enableSharedKnowledge: true,
  recordHistory: true,
  
  // 🆕 策略特定默认值
  hierarchicalLeaderRatio: 0.5,
  debateFirstRoundRatio: 0.4,
  enableDynamicTimeout: true,
  minMemberTimeout: 30_000,
  
  // 🆕 根据策略推荐的缓冲系数
  bufferFactors: {
    parallel: 1.2,
    sequential: 1.2,
    hierarchical: 1.2,
    debate: 1.5,
    pipeline: 1.15,
  }
}
```

---

## 🎯 用户指南

### 快速决策树
```
我的任务是...

├─ 多个独立任务并发执行？
│  → parallel (T_total = 最慢任务 × 1.2)
│
├─ 多步骤顺序处理？
│  ├─ 每步简单快速 → sequential (T_total = Σ步骤 × 1.2)
│  └─ 有数据流转换 → pipeline (T_total = Σ步骤 × 1.15)
│
├─ 有明确的 Leader + Workers 分工？
│  → hierarchical (T_total = (T_leader + max(T_workers)) × 1.2)
│
└─ 需要多轮讨论评估？
   → debate (T_total = N × R × 平均发言时长 × 1.5)
```

### 典型超时配置示例
```typescript
// 1. 快速并发检查 (parallel, 2成员, 每个 60s)
{
  timeout: 90_000, // 90s
  members: [
    { id: "checker1", timeout: 90_000 },
    { id: "checker2", timeout: 90_000 }
  ]
}

// 2. 中等复杂审查 (sequential, 3成员, 60s+90s+60s)
{
  timeout: 270_000, // 270s (210s × 1.3)
  members: [
    { id: "reader" },   // 动态分配 ~108s
    { id: "analyzer" }, // 动态分配 ~100s
    { id: "advisor" }   // 动态分配 ~90s
  ]
}

// 3. 大型项目分析 (hierarchical, 5成员, Leader 10min + Workers 5min)
{
  timeout: 1_080_000, // 18min (15min × 1.2)
  members: [
    { id: "architect", priority: 10, timeout: 600_000 }, // 10min
    { id: "code_reviewer", priority: 5 },    // 自动 120s
    { id: "test_analyst", priority: 5 },     // 自动 120s
    { id: "perf_expert", priority: 5 },      // 自动 120s
    { id: "doc_writer", priority: 5 }        // 自动 120s
  ]
}

// 4. 技术方案辩论 (debate, 3成员, 4轮, 每次 60s)
{
  timeout: 1_080_000, // 18min (3×4×60s×1.5)
  maxRounds: 4,
  members: [
    { id: "conservative" },
    { id: "aggressive" },
    { id: "moderate" }
  ]
}

// 5. 数据处理流水线 (pipeline, 4阶段, 各 2min)
{
  timeout: 600_000, // 10min (8min × 1.25)
  members: [
    { id: "extractor" },  // 自动 150s
    { id: "parser" },     // 自动 150s
    { id: "analyzer" },   // 自动 150s
    { id: "reporter" }    // 自动 150s
  ]
}
```

---

## ✅ 总结

### 关键要点
1. **Parallel**: 每个成员独享总时间（并行不叠加）
2. **Sequential**: 动态分配，前松后紧（防止后期成员时间不足）
3. **Hierarchical**: Leader 占 50%，Workers 均摊剩余（避免均摊导致 Leader 超时）✅ **已实现**
4. **Debate**: 首轮占 40%，后续均摊（首轮需更多时间理解问题）✅ **已实现**
5. **Pipeline**: 根据阶段特点分配（I/O 阶段给更多时间）✅ **已实现**

### 实现状态
- **✅ P0**: 修复 Hierarchical 算法（当前最严重问题）— **已完成**
- **✅ P1**: 实现 Sequential/Pipeline 动态调整 — **已完成**
- **✅ P2**: 优化 Debate 首轮分配 — **已完成**
- **✅ P3**: 添加配置项 (hierarchicalLeaderRatio 等) — **已完成**
- **✅ P4**: 添加启动时超时分配日志 — **已完成**

### 代码改动总结
1. **types.ts**: 扩展 `TeamConfig` 新增 4 个配置字段，更新 `DEFAULT_TEAM_CONFIG`
2. **TeamManager.ts**: 
   - 重写 `calculateMemberTimeout()` 实现 5 种策略优化算法
   - 更新 `executeMemberTask()` 签名添加 `memberIndex` 参数
   - 更新所有策略执行方法传入成员索引
   - 新增 `logTimeoutAllocation()` 日志方法
3. **CHANGELOG.md**: 记录本次优化内容
4. **verify-timeout-optimization.mjs**: 验证脚本

### 推荐行动
1. ✅ 立即修复 `TeamManager.ts` Hierarchical 算法 — **已完成**
2. ✅ 更新 `DEFAULT_TEAM_CONFIG.timeout` 为 1800s (30分钟) — **已完成**
3. ✅ 在文档中提供超时配置决策树 — **已完成**
4. ✅ 添加启动时的超时分配日志 — **已完成**

---

**文档版本**: 2.1  
**最后更新**: 2026-04-15  
**实现状态**: ✅ 全部完成
**相关文件**:
- `src/core/agent/team/TeamManager.ts` (已优化)
- `src/core/agent/team/types.ts` (已扩展)
- `CHANGELOG.md` (已更新)
- `tests/multi-agent/verify-timeout-optimization.mjs` (验证通过)
