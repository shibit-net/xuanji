# Agent Team 超时管理重构实施报告

## 实施日期
2026-04-16

## 问题回顾

### 核心问题
1. **概念混淆**：用户传入 `timeout` 以为是团队总超时，实际被当作成员统一超时
2. **优先级错误**：`memberTimeoutMs` 优先级过高，导致策略权重计算失效
3. **缺少团队级总超时**：没有硬性的团队执行时间上限
4. **超时不足**：默认 10 分钟对大型分析任务不够

## 解决方案（Phase 2 完整重构）

### 1. 类型定义修改 (types.ts)

#### 新增字段
```typescript
interface TeamConfig {
  // 🆕 团队级超时控制
  teamTotalTimeout?: number;  // 团队总超时（硬限制）
  
  // 调整语义
  defaultMemberTimeout?: number;  // 成员基准超时（用于策略计算）
  memberTimeoutMs?: number;       // 统一成员超时（降级为兜底）
}
```

#### 默认值调整
```typescript
DEFAULT_TEAM_CONFIG = {
  teamTotalTimeout: 1_200_000,     // 20 分钟（原 10 分钟）
  defaultMemberTimeout: 600_000,   // 10 分钟（原 5 分钟）
  minMemberTimeout: 30_000,        // 30 秒
}
```

### 2. TeamManager 核心修改

#### 2.1 添加团队级超时控制

```typescript
async execute(goal: string): Promise<TeamExecutionResult> {
  // 🆕 团队级超时控制
  const teamTimeout = this.context.config.teamTotalTimeout ?? DEFAULT_TEAM_CONFIG.teamTotalTimeout;
  const teamAbortController = new AbortController();
  
  const teamTimer = setTimeout(() => {
    teamAbortController.abort();
    timedOut = true;
    log.warn(`Team exceeded total timeout ${teamTimeout}ms`);
  }, teamTimeout);

  try {
    // 执行策略，传递 signal
    const results = await this.executeStrategy(goal, teamAbortController.signal);
    // ...
  } finally {
    clearTimeout(teamTimer);
  }
}
```

#### 2.2 修复 calculateMemberTimeout 优先级

**修改前**：
```typescript
1. member.timeout (显式)
2. config.memberTimeoutMs (统一) ← 这里就返回了
3. 策略权重计算 ← 永远不会执行
```

**修改后**：
```typescript
1. member.timeout (显式)
2. 策略权重计算 ← 提升优先级
3. config.memberTimeoutMs (兜底) ← 降低优先级，取 min
```

#### 2.3 所有策略方法添加 signal 参数

```typescript
private async executeSequential(goal: string, signal?: AbortSignal)
private async executeParallel(goal: string, signal?: AbortSignal)
private async executeHierarchical(goal: string, signal?: AbortSignal)
private async executeDebate(goal: string, signal?: AbortSignal)
private async executePipeline(goal: string, signal?: AbortSignal)
private async executeMemberTask(..., signal?: AbortSignal)
```

#### 2.4 增强日志输出

```typescript
private logTimeoutAllocation(): void {
  log.info(`Team Total Timeout: ${teamTotalTimeout}ms`);
  log.info(`Default Member Timeout: ${defaultMemberTimeout}ms`);
  
  // 显示每个成员的超时
  members.forEach((member, index) => {
    const timeout = this.calculateMemberTimeout(member, index);
    log.info(`  - ${member.id}: ${timeout}ms [auto]`);
  });
  
  // 🆕 显示预估总超时
  log.info(`Estimated Total: ${estimatedTotal}ms`);
}
```

### 3. TeamTool 参数映射修改

#### 3.1 智能计算 defaultMemberTimeout

```typescript
const teamTotalTimeout = timeout ?? 1_200_000; // 默认 20 分钟
let defaultMemberTimeout: number;

switch (strategy) {
  case 'parallel':
    // 每个成员可用接近全部时间（留 10% 缓冲）
    defaultMemberTimeout = Math.floor(teamTotalTimeout * 0.9);
    break;
    
  case 'sequential':
    // 平均分配
    defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
    break;
    
  case 'hierarchical':
    // leader 1.5x, workers 1.0x
    defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length + 0.5));
    break;
    
  case 'debate':
    // 多轮，每轮所有成员
    const rounds = maxRounds ?? 10;
    defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length * rounds * 0.7));
    break;
    
  case 'pipeline':
    // 串行，各阶段权重不同
    defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
    break;
}
```

#### 3.2 配置映射

```typescript
const teamConfig: TeamConfig = {
  name: teamName,
  members,
  strategy,
  goal,
  maxRounds,
  teamTotalTimeout,           // 🆕 团队总超时
  defaultMemberTimeout,       // 🆕 成员基准超时
  // memberTimeoutMs 不设置，让策略计算生效
};
```

#### 3.3 更新 description

```typescript
timeout: {
  type: 'number',
  description: [
    '🆕 Team total timeout in milliseconds (default: 1200000 = 20 minutes).',
    '',
    '⚡ This is a HARD LIMIT for the entire team execution.',
    '',
    '📊 Recommended timeouts by complexity:',
    'Simple (2-3 members): 600000ms (10 min)',
    'Medium (3-4 members): 1200000ms (20 min) — default',
    'Complex/Large analysis (4-5 members): 2400000-3600000ms (40-60 min)',
    '',
    '🎯 Dynamic adjustment: Analyze task before setting timeout.',
    '- 10+ files → add 10-20 min',
    '- Large codebase → add 20-30 min',
    '- Deep analysis → add 30-40 min',
    '',
    '**Rule: When in doubt, double the estimated time.**',
  ].join('\n'),
}
```

### 4. Prompt 组件更新 (l2-team-coordination.ts)

#### 4.1 超时配置指导

```markdown
### Timeout Configuration

**How timeout allocation works**:

1. Team Total Timeout (default: 1200000ms = 20 min)
   - Hard limit for entire team execution

2. Default Member Timeout (auto-calculated)
   - System calculates base timeout per member

3. Strategy Weight Adjustment
   - Final member timeout = base × weight

**Recommended timeouts by complexity**:
- Simple: 10-15 min
- Medium: 20-30 min (default)
- Complex/Large: 40-60 min

**Dynamic Timeout Adjustment**:
Analyze task before setting timeout:
- 10+ files → add 10-20 min
- Large codebase → add 20-30 min
- Deep analysis → add 30-40 min

Example:
  Task: "Analyze 50 files for security"
  → 50 files × 30s = 25 min
  → Add 50% buffer = 37.5 min
  → Set timeout: 2400000ms (40 min)

**Rule: When in doubt, double the estimated time.**
```

## 实施效果

### 超时分配示例

#### Parallel (3 成员，团队总超时 20 分钟)
```
Team Total: 1200s (20 min)
Default Member: 1080s (18 min, 90% of total)

成员超时：
- member1: 1080s [auto]
- member2: 1080s [auto]
- member3: 1080s [auto]

实际总超时: max(1080, 1080, 1080) = 1080s < 1200s ✅
```

#### Sequential (4 成员，团队总超时 30 分钟)
```
Team Total: 1800s (30 min)
Default Member: 450s (7.5 min, total / 4)

成员超时（前松后紧）：
- member1: 450s × 1.2 = 540s [auto]
- member2: 450s × 1.0 = 450s [auto]
- member3: 450s × 0.9 = 405s [auto]
- member4: 450s × 0.8 = 360s [auto]

实际总超时: 540 + 450 + 405 + 360 = 1755s < 1800s ✅
```

#### Hierarchical (1 leader + 3 workers，团队总超时 30 分钟)
```
Team Total: 1800s (30 min)
Default Member: 400s (1800 / 4.5)

成员超时：
- leader: 400s × 1.5 = 600s [auto]
- worker1: 400s [auto]
- worker2: 400s [auto]
- worker3: 400s [auto]

实际总超时: 600 + max(400, 400, 400) = 1000s < 1800s ✅
```

### 配置对比

#### 修改前（有问题）
```typescript
agent_team({
  timeout: 300000,  // 用户以为是团队总超时
  strategy: 'sequential',
  members: [
    { id: 'm1' },
    { id: 'm2' },
    { id: 'm3' },
  ]
})

// 实际效果：
// - 每个成员都有 300s（memberTimeoutMs）
// - 策略权重计算失效
// - sequential 下总超时 = 900s（超出预期 3 倍！）
```

#### 修改后（正确）
```typescript
agent_team({
  timeout: 1800000,  // 团队总超时 30 分钟
  strategy: 'sequential',
  members: [
    { id: 'm1' },
    { id: 'm2' },
    { id: 'm3' },
  ]
})

// 实际效果：
// - 团队总超时：1800s（硬限制）
// - defaultMemberTimeout: 600s (1800 / 3)
// - 策略权重生效：
//   - m1: 720s (600 × 1.2)
//   - m2: 600s (600 × 1.0)
//   - m3: 480s (600 × 0.8)
// - 实际总超时：1800s ✅
```

## 向后兼容性

### 兼容性保证
1. 如果用户显式设置 `member.timeout`，仍然优先使用
2. 如果用户设置 `memberTimeoutMs`，作为兜底上限
3. 默认值从 10 分钟提升到 20 分钟，更宽松

### 迁移指南
无需迁移，现有代码自动受益：
- 策略权重计算自动生效
- 团队级超时自动保护
- 超时更充足，减少超时失败

## 测试验证

### 单元测试
- ✅ 默认值验证
- ✅ 策略超时计算验证
- ✅ 优先级验证

### 集成测试
建议添加：
1. 团队级超时触发测试
2. 策略权重分配测试
3. 大型任务超时测试

## 相关文件

### 修改的文件
1. `src/core/agent/team/types.ts` - 类型定义和默认值
2. `src/core/agent/team/TeamManager.ts` - 核心逻辑
3. `src/core/tools/TeamTool.ts` - 参数映射
4. `src/core/prompt/components/l2-team-coordination.ts` - Prompt 指导

### 新增的文件
1. `test/core/agent/team/timeout-refactor.test.ts` - 单元测试
2. `docs/agent-team-timeout-refactor-plan.md` - 重构方案
3. `docs/agent-team-prompt-improvement.md` - Prompt 改进

## 后续优化建议

### 1. 添加超时预算验证
```typescript
private validateTimeoutBudget(config: TeamConfig): void {
  const estimated = this.estimateTotalTimeout(config);
  if (config.teamTotalTimeout && estimated > config.teamTotalTimeout * 1.1) {
    log.warn(
      `Estimated total (${estimated}ms) exceeds team timeout (${config.teamTotalTimeout}ms) by >10%. ` +
      `Consider increasing team timeout or reducing member count.`
    );
  }
}
```

### 2. 提供超时计算器
```typescript
function calculateRecommendedTimeout(
  strategy: TeamStrategy,
  memberCount: number,
  taskComplexity: 'simple' | 'medium' | 'complex',
  fileCount?: number,
): { teamTimeout: number; memberTimeout: number } {
  // 基于任务特征智能推荐超时
}
```

### 3. 收集超时统计
- 成功率 by 超时配置
- 平均执行时间 by 策略
- 超时失败的常见原因

## 总结

通过 Phase 2 完整重构，我们实现了：

1. ✅ **清晰的超时语义**：`timeout` = 团队总超时（硬限制）
2. ✅ **正确的优先级**：策略权重计算优先于统一超时
3. ✅ **团队级超时控制**：AbortController 强制终止
4. ✅ **充足的默认超时**：20 分钟默认，支持 40-60 分钟大型任务
5. ✅ **动态调整指导**：Prompt 教导如何根据任务规模调整超时
6. ✅ **智能超时分配**：根据策略和成员数自动计算

这将显著提高 agent_team 的成功率和用户体验，特别是对于大型分析任务。
