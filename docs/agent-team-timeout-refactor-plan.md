# Agent Team 超时管理重构方案

## 问题分析

### 当前架构的问题

#### 1. 概念混淆
```typescript
// TeamTool.execute() 接收的参数
const timeout = input.timeout as number | undefined;  // 用户以为是"团队总超时"

// 但实际被映射为
const teamConfig: TeamConfig = {
  memberTimeoutMs: timeout,  // ❌ 变成了"统一成员超时"
};
```

**结果**：
- 用户设置 `timeout: 300000` (5分钟)
- 期望：团队总共 5 分钟
- 实际：每个成员都有 5 分钟（parallel 策略下总共可能 5 分钟，但 sequential 可能 15 分钟）

#### 2. 优先级混乱

`calculateMemberTimeout()` 的优先级：
```typescript
1. member.timeout (显式设置) → 直接返回
2. config.memberTimeoutMs (统一超时) → 直接返回  ← ❌ 这里就返回了
3. 基于 defaultMemberTimeout 和策略权重计算  ← ❌ 永远不会执行
```

**问题**：
- 只要用户传了 `timeout` 参数，策略权重计算就失效
- parallel/sequential/hierarchical 的差异化超时分配完全无效

#### 3. 缺少团队级总超时

当前没有真正的"团队总超时"机制：
- parallel: 成员并发，实际总超时 = max(成员超时)
- sequential: 成员串行，实际总超时 = sum(成员超时)
- 用户无法精确控制团队的总执行时间上限

## 重构方案

### 方案 A：双层超时控制（推荐）

#### 架构设计

```typescript
interface TeamConfig {
  // 🆕 团队级总超时（硬限制）
  teamTotalTimeout?: number;  // 默认 600000 (10分钟)
  
  // 成员级超时配置
  defaultMemberTimeout?: number;  // 基准超时，用于策略计算
  memberTimeoutMs?: number;       // 统一成员超时（覆盖策略计算）
  
  // 策略权重配置
  hierarchicalLeaderRatio?: number;
  debateFirstRoundRatio?: number;
  // ...
}

interface TeamMember {
  timeout?: number;  // 成员显式超时（最高优先级）
}
```

#### 超时优先级（修正后）

```typescript
// 成员超时计算优先级
1. member.timeout (显式设置) → 直接返回
2. 基于 defaultMemberTimeout 和策略权重计算  ← 🆕 提升优先级
3. config.memberTimeoutMs (统一超时) → 作为兜底  ← 🆕 降低优先级

// 团队总超时控制
TeamManager.execute() {
  const teamTimeout = config.teamTotalTimeout ?? 600000;
  const teamAbortController = new AbortController();
  
  const teamTimer = setTimeout(() => {
    teamAbortController.abort();
    log.warn(`Team "${config.name}" exceeded total timeout ${teamTimeout}ms`);
  }, teamTimeout);
  
  try {
    // 执行策略...
  } finally {
    clearTimeout(teamTimer);
  }
}
```

#### TeamTool 参数映射

```typescript
// 用户传入
agent_team({
  timeout: 600000,  // 10 分钟
  members: [...]
})

// 映射为
const teamConfig: TeamConfig = {
  teamTotalTimeout: timeout,           // 🆕 团队总超时
  defaultMemberTimeout: timeout / 2,   // 🆕 成员基准超时（策略会调整）
  // memberTimeoutMs 不设置，让策略计算生效
};
```

#### 策略超时分配示例

**Parallel (3 成员，团队总超时 600s)**
```
teamTotalTimeout: 600s
defaultMemberTimeout: 300s (600s / 2)

成员超时计算：
- member1: 300s (基准)
- member2: 300s (基准)
- member3: 300s (基准)

实际总超时: max(300, 300, 300) = 300s < 600s ✅
```

**Sequential (3 成员，团队总超时 600s)**
```
teamTotalTimeout: 600s
defaultMemberTimeout: 200s (600s / 3)

成员超时计算（前松后紧）：
- member1: 200s × 1.2 = 240s
- member2: 200s × 1.0 = 200s
- member3: 200s × 0.8 = 160s

实际总超时: 240 + 200 + 160 = 600s ≈ 600s ✅
```

**Hierarchical (1 leader + 3 workers，团队总超时 600s)**
```
teamTotalTimeout: 600s
defaultMemberTimeout: 200s (600s / 3)

成员超时计算：
- leader: 200s × 1.5 = 300s
- worker1: 200s
- worker2: 200s
- worker3: 200s

实际总超时: 300 + max(200, 200, 200) = 500s < 600s ✅
```

### 方案 B：简化方案（保守）

如果不想大改，可以只修复优先级：

```typescript
private calculateMemberTimeout(member: TeamMember, memberIndex?: number): number {
  const config = this.context!.config;

  // 优先级 1: 成员显式设置的超时
  if (member.timeout) {
    return member.timeout;
  }

  // 🆕 优先级 2: 基于策略和权重的自动计算（提升优先级）
  const baseTimeout = config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout;
  const strategy = config.strategy;
  const memberCount = config.members.length;
  
  let perMemberTimeout: number;
  
  switch (strategy) {
    case 'parallel':
      perMemberTimeout = baseTimeout;
      break;
    // ... 其他策略
  }
  
  // 🆕 优先级 3: 团队级统一超时（降级为兜底）
  if (config.memberTimeoutMs) {
    // 如果设置了统一超时，取两者较小值（避免超出预算）
    perMemberTimeout = Math.min(perMemberTimeout, config.memberTimeoutMs);
  }
  
  const MIN_TIMEOUT = config.minMemberTimeout ?? DEFAULT_TEAM_CONFIG.minMemberTimeout;
  return Math.max(perMemberTimeout, MIN_TIMEOUT);
}
```

**优点**：
- 改动最小
- 策略权重计算生效
- 向后兼容

**缺点**：
- 仍然没有团队级总超时控制
- 用户传入的 `timeout` 语义仍然不清晰

## 推荐实施步骤

### Phase 1: 修复优先级（立即）

1. 修改 `calculateMemberTimeout()` 优先级顺序
2. 更新 TeamTool description，明确 `timeout` 的实际含义
3. 添加日志警告，当检测到配置冲突时提示用户

```typescript
// TeamTool.ts
timeout: {
  type: 'number',
  description: [
    'Member base timeout in milliseconds (default: 600000 = 10 minutes).',
    '',
    '⚠️ IMPORTANT: This is the BASE timeout for strategy calculation.',
    'Actual member timeouts are auto-calculated based on strategy:',
    '  - parallel: each member gets this full timeout',
    '  - sequential: members share this timeout with progressive allocation',
    '  - hierarchical: leader gets 1.5x, workers get 1.0x',
    '',
    'To override strategy calculation, set member.timeout explicitly.',
  ].join('\n'),
}
```

### Phase 2: 添加团队总超时（下一版本）

1. 添加 `teamTotalTimeout` 配置项
2. 在 `TeamManager.execute()` 中实现团队级超时控制
3. 调整 `defaultMemberTimeout` 的默认计算逻辑
4. 更新文档和示例

### Phase 3: 优化用户体验（后续）

1. 添加超时预算验证
```typescript
// 在 createTeam() 中验证
const estimatedTotal = this.estimateTotalTimeout(config);
if (config.teamTotalTimeout && estimatedTotal > config.teamTotalTimeout) {
  log.warn(
    `Estimated total timeout (${estimatedTotal}ms) exceeds team timeout (${config.teamTotalTimeout}ms). ` +
    `Consider increasing team timeout or reducing member count.`
  );
}
```

2. 提供超时计算器工具
```typescript
// 帮助用户预估合理的超时配置
function calculateRecommendedTimeout(
  strategy: TeamStrategy,
  memberCount: number,
  avgTaskComplexity: 'simple' | 'medium' | 'complex'
): { teamTimeout: number; memberTimeout: number } {
  // ...
}
```

## 配置示例对比

### 当前配置（有问题）

```typescript
agent_team({
  timeout: 300000,  // 用户以为是团队总超时
  strategy: 'parallel',
  members: [
    { id: 'm1', capabilities: ['...'] },
    { id: 'm2', capabilities: ['...'] },
    { id: 'm3', capabilities: ['...'] },
  ]
})

// 实际效果：
// - 每个成员都有 300s
// - 策略权重计算失效
// - parallel 下总超时 = 300s（符合预期，但是巧合）
// - sequential 下总超时 = 900s（超出预期 3 倍！）
```

### Phase 1 修复后

```typescript
agent_team({
  timeout: 600000,  // 成员基准超时
  strategy: 'sequential',
  members: [
    { id: 'm1', capabilities: ['...'] },
    { id: 'm2', capabilities: ['...'] },
    { id: 'm3', capabilities: ['...'] },
  ]
})

// 实际效果：
// - m1: 600s × 1.2 = 720s
// - m2: 600s × 1.0 = 600s
// - m3: 600s × 0.8 = 480s
// - 总超时: 720 + 600 + 480 = 1800s
// ⚠️ 仍然没有团队级硬限制
```

### Phase 2 完整方案

```typescript
agent_team({
  timeout: 600000,  // 团队总超时 10 分钟
  strategy: 'sequential',
  members: [
    { id: 'm1', capabilities: ['...'] },
    { id: 'm2', capabilities: ['...'] },
    { id: 'm3', capabilities: ['...'] },
  ]
})

// 映射为：
{
  teamTotalTimeout: 600000,        // 团队硬限制
  defaultMemberTimeout: 200000,    // 600s / 3 = 200s 基准
  strategy: 'sequential'
}

// 实际效果：
// - m1: 200s × 1.2 = 240s
// - m2: 200s × 1.0 = 200s
// - m3: 200s × 0.8 = 160s
// - 预估总超时: 600s
// - 团队硬限制: 600s ✅
```

## 测试用例

```typescript
describe('TeamManager timeout allocation', () => {
  it('should respect strategy weights over memberTimeoutMs', () => {
    const config: TeamConfig = {
      strategy: 'sequential',
      defaultMemberTimeout: 600000,
      memberTimeoutMs: 300000,  // 应该被忽略或作为上限
      members: [
        { id: 'm1', capabilities: ['...'] },
        { id: 'm2', capabilities: ['...'] },
        { id: 'm3', capabilities: ['...'] },
      ]
    };
    
    const manager = new TeamManager(...);
    await manager.createTeam(config);
    
    // 验证策略权重生效
    const m1Timeout = manager['calculateMemberTimeout'](config.members[0], 0);
    const m2Timeout = manager['calculateMemberTimeout'](config.members[1], 1);
    const m3Timeout = manager['calculateMemberTimeout'](config.members[2], 2);
    
    expect(m1Timeout).toBeGreaterThan(m2Timeout);  // 前松
    expect(m2Timeout).toBeGreaterThan(m3Timeout);  // 后紧
  });
  
  it('should enforce team total timeout', async () => {
    const config: TeamConfig = {
      strategy: 'parallel',
      teamTotalTimeout: 60000,  // 1 分钟硬限制
      defaultMemberTimeout: 300000,  // 每个成员基准 5 分钟
      members: [
        { id: 'm1', capabilities: ['...'] },
        { id: 'm2', capabilities: ['...'] },
      ]
    };
    
    const manager = new TeamManager(...);
    await manager.createTeam(config);
    
    const startTime = Date.now();
    const result = await manager.execute('test goal');
    const duration = Date.now() - startTime;
    
    // 即使成员超时是 5 分钟，团队应该在 1 分钟时终止
    expect(duration).toBeLessThan(70000);  // 1 分钟 + 10s 缓冲
    expect(result.timedOut).toBe(true);
  });
});
```

## 向后兼容性

### Breaking Changes（Phase 2）

1. `timeout` 参数语义变化
   - 旧：成员统一超时
   - 新：团队总超时（成员超时自动计算）

### 迁移指南

```typescript
// 旧配置
agent_team({
  timeout: 300000,  // 每个成员 5 分钟
  strategy: 'parallel',
  members: [...]
})

// 新配置（等效）
agent_team({
  timeout: 300000,  // 团队总超时 5 分钟
  strategy: 'parallel',
  members: [...]
})
// 自动计算：defaultMemberTimeout = 300000 / 2 = 150000
// parallel 策略：每个成员 150s

// 如果想保持旧行为（每个成员 300s）
agent_team({
  timeout: 600000,  // 团队总超时 10 分钟
  strategy: 'parallel',
  members: [...]
})
// 自动计算：defaultMemberTimeout = 600000 / 2 = 300000
// parallel 策略：每个成员 300s
```

## 总结

**核心问题**：
1. 超时概念混淆（团队 vs 成员）
2. 优先级错误（统一超时覆盖策略计算）
3. 缺少团队级硬限制

**推荐方案**：
- Phase 1: 修复优先级（立即，无 breaking change）
- Phase 2: 添加团队总超时（下一版本，有 breaking change）
- Phase 3: 优化用户体验（后续迭代）

**预期效果**：
- 策略权重计算生效
- 用户可精确控制团队总执行时间
- 配置语义清晰，符合直觉
