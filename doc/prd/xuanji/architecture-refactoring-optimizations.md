# 架构重构后续优化 - 实施记录

## 优化计划

基于架构重构完成后的 TODO 列表，计划实施以下优化：

1. ✅ **计划确认 UI**（Plan Confirmation UI）
2. ⏳ **执行进度显示**（Execution Progress Display）
3. ⏳ **性能优化**（Performance Optimization - Complexity Analysis Caching）
4. ⏳ **监控日志**（Monitoring Logs）

---

## 优化 1：计划确认 UI ✅

**实施时间**: 2026-03-14
**提交**: 1c79b03

### 功能描述

当任务被 TaskRouter 路由到 decompose 模式时，在执行前向用户显示执行计划，等待用户确认。

### 实现细节

#### 1. 类型定义 (ChatSession.ts)

```typescript
export type PlanConfirmHandler = (
  plan: import('@/core/routing/types').ExecutionPlan
) => Promise<boolean>;
```

#### 2. ChatSession 集成

- 新增私有字段：`private onPlanConfirm: PlanConfirmHandler | null = null`
- 新增 setter：`setPlanConfirmHandler(handler: PlanConfirmHandler)`
- 修改 `runWithPlanner()` 方法：

```typescript
// 2. 如果配置要求确认计划，调用 UI 回调
if (this.config?.planner?.requireConfirmation && this.onPlanConfirm) {
  log.info('⏸️  Waiting for user confirmation...');
  const confirmed = await this.onPlanConfirm(plan);
  if (!confirmed) {
    log.info('❌ Plan rejected by user');
    // 将拒绝消息添加到历史
    if (this.agentLoop) {
      this.agentLoop.getMessageManager().addAssistantMessage([
        { type: 'text', text: '已取消任务执行。' },
      ]);
    }
    return;
  }
  log.info('✅ Plan confirmed by user');
}
```

#### 3. App.tsx UI 集成

**接口扩展**:
```typescript
export interface AppProps {
  // ...
  onPlanConfirmSetup?: (handler: (plan: import('@/core/routing/types').ExecutionPlan) => Promise<boolean>) => void;
}
```

**状态管理**:
```typescript
const [pendingPlanConfirm, setPendingPlanConfirm] = useState<{
  plan: import('@/core/routing/types').ExecutionPlan;
  resolve: (confirmed: boolean) => void;
} | null>(null);
```

**处理器注册**:
```typescript
useEffect(() => {
  if (!onPlanConfirmSetup) return;
  const handler = async (plan: import('@/core/routing/types').ExecutionPlan): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPendingPlanConfirm({ plan, resolve });

      // 超时自动拒绝（120 秒）
      const timeoutId = setTimeout(() => {
        setPendingPlanConfirm(null);
        resolve(false);
      }, 120_000);
      (resolve as any).__timeoutId = timeoutId;
    });
  };
  onPlanConfirmSetup(handler);
}, [onPlanConfirmSetup]);
```

#### 4. PlanConfirm 组件

**文件**: `src/adapters/cli/PlanConfirm.tsx`

**功能**:
- 显示任务描述
- 显示计划步骤列表（序号、描述、Agent ID、依赖关系）
- 显示需要的 Agent 列表
- 显示预估耗时和 token 消耗
- 交互式确认输入（y/n）

**UI 布局**:
```
┌─ 📋 执行计划确认 ─────────────────────┐
│ 任务: [task description]             │
│                                        │
│ 计划步骤 (3 步):                       │
│   1. [step 1] [agent-id] (依赖: ...)  │
│   2. [step 2] [agent-id]              │
│   3. [step 3] [agent-id] (依赖: 1)    │
│                                        │
│ 需要的 Agent:                          │
│   • Main - 主代理                      │
│   • Worker - 工作代理                  │
│                                        │
│ 预估耗时: ~30秒 | 预估消耗: ~5000 tokens│
│                                        │
│ 是否执行此计划? (y/n): _               │
│                                        │
│ 提示: 输入 y 确认 / n 取消，按 Enter 提交│
└────────────────────────────────────────┘
```

#### 5. index.ts 连接

```typescript
return React.createElement(App, {
  // ...
  onPlanConfirmSetup: (handler: any) => session.setPlanConfirmHandler(handler),
  // ...
});
```

### 配置

**配置项**: `planner.requireConfirmation`
**默认值**: `true`
**类型**: `boolean`

```typescript
// defaults.ts
planner: {
  model: 'claude-3-5-sonnet-20241022',
  maxSteps: 10,
  timeout: 30000,
  requireConfirmation: true, // 默认需要用户确认
}
```

### 用户体验

1. **触发时机**: 任务被 TaskRouter 路由到 decompose 模式
2. **显示内容**: 黄色边框对话框，显示完整执行计划
3. **交互方式**:
   - 输入 `y` / `yes` / `confirm` → 确认执行
   - 输入 `n` / `no` / `cancel` → 取消执行
   - 120 秒无操作 → 自动拒绝
4. **确认后**: 开始执行计划，显示子任务进度
5. **取消后**: 终止执行，显示 "已取消任务执行。"

### 测试

**手动测试步骤**:
1. 启动应用
2. 输入复杂任务（触发 decompose 模式）
3. 确认显示计划确认对话框
4. 测试确认（y）和取消（n）两种路径
5. 验证超时自动拒绝（等待 120 秒）

### 已知问题

无

### 副作用修复

在实施过程中修复了以下类型错误：

1. **App.tsx onSessionSave 类型错误**:
   - 问题: `role: string` 与 `HistoryMessage` 的 `role: 'user' | 'assistant' | 'system'` 不兼容
   - 修复: 修改 AppProps 中的类型定义，并过滤掉工具消息（tool/tool_group）

```typescript
// 修复前
onSessionSave?: (name?: string, historyMessages?: Array<{ role: string; content: string; timestamp: number }>) => Promise<string>;

// 修复后
onSessionSave?: (name?: string, historyMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>) => Promise<string>;

// 实现中过滤掉工具消息
const historyMessages = messages
  .filter(msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
  .map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    timestamp: msg.timestamp,
  }));
```

---

## 优化 2：执行进度显示 ⏳

**计划时间**: TBD

### 功能描述

在执行分解任务时，实时显示执行进度，包括：
- 当前执行的子任务
- 已完成的子任务数 / 总子任务数
- 子任务状态（成功 ✅ / 失败 ❌ / 跳过 ⏭️）

### 技术方案

#### 1. Executor 回调扩展

```typescript
// 已有回调（在 runWithPlanner 中使用）
onSubTaskStart?: (order: number, description: string) => void;
onSubTaskComplete?: (result: SubTaskResult) => void;
onProgress?: (current: number, total: number) => void;
```

#### 2. App.tsx 集成

需要实现：
- 新增状态：`executionProgress`
- 在 onSubTaskStart/onSubTaskComplete 回调中更新进度
- 新增 `ExecutionProgress` 组件显示进度

#### 3. UI 设计

```
┌─ 执行进度 ─────────────────────────────┐
│ ✅ 1. 分析用户需求                     │
│ 🔄 2. 搜索相关文档 (进行中...)         │
│ ⏳ 3. 生成代码                         │
│ ⏳ 4. 运行测试                         │
│                                        │
│ 进度: 2/4 (50%)                       │
└────────────────────────────────────────┘
```

### 实施步骤

1. [ ] 在 App.tsx 中添加进度状态
2. [ ] 在 index.ts 中注册进度回调
3. [ ] 创建 ExecutionProgress 组件
4. [ ] 在 runWithPlanner 回调中调用进度更新
5. [ ] 测试进度显示

---

## 优化 3：性能优化 - 复杂度分析缓存 ⏳

**计划时间**: TBD

### 功能描述

缓存任务复杂度分析结果，避免对相似任务重复调用 LLM 分析。

### 技术方案

#### 1. 缓存策略

- **缓存键**: 用户输入的前 200 字符（去除空格后）
- **缓存时间**: 可配置（默认 3600 秒）
- **缓存存储**: 内存（Map）
- **缓存淘汰**: LRU（最多 100 条）

#### 2. 代码实现

```typescript
// TaskRouter.ts
private complexityCache = new Map<string, {
  result: TaskComplexity;
  timestamp: number;
}>();

private getCacheKey(userInput: string): string {
  return userInput.replace(/\s+/g, '').slice(0, 200);
}

async analyzeComplexity(userInput: string): Promise<TaskComplexity> {
  const cacheKey = this.getCacheKey(userInput);
  const cached = this.complexityCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < this.config.complexity.cacheTTL * 1000) {
    log.debug('Complexity analysis cache hit');
    return cached.result;
  }

  const result = await this.llmAnalyze(userInput);
  this.complexityCache.set(cacheKey, { result, timestamp: Date.now() });

  // LRU 淘汰
  if (this.complexityCache.size > 100) {
    const firstKey = this.complexityCache.keys().next().value;
    this.complexityCache.delete(firstKey);
  }

  return result;
}
```

### 实施步骤

1. [ ] 在 TaskRouter 中添加缓存 Map
2. [ ] 实现 getCacheKey() 方法
3. [ ] 修改 analyzeComplexity() 添加缓存逻辑
4. [ ] 实现 LRU 淘汰策略
5. [ ] 测试缓存命中率

---

## 优化 4：监控日志 ⏳

**计划时间**: TBD

### 功能描述

为路由决策、计划生成、任务执行添加详细的性能指标日志，便于后续优化和故障排查。

### 监控指标

#### 1. 路由决策

- 决策耗时
- 复杂度分析耗时
- 缓存命中率
- 路由模式分布（direct vs decompose）

#### 2. 计划生成

- 规划耗时
- 生成的步骤数
- 需要的 Agent 数
- 预估 token 消耗

#### 3. 任务执行

- 总执行时间
- 各子任务执行时间
- 并行度统计
- 成功率 / 失败率

### 日志格式

```typescript
{
  "timestamp": "2026-03-14T10:30:00.000Z",
  "module": "TaskRouter",
  "action": "route",
  "input": "帮我实现一个用户认证系统",
  "decision": "decompose",
  "reason": "complexity",
  "complexity": {
    "isMultiStep": true,
    "estimatedSteps": 5,
    "complexity": "complex"
  },
  "duration_ms": 234,
  "cache_hit": false
}
```

### 实施步骤

1. [ ] 定义监控指标接口
2. [ ] 在 TaskRouter 中添加性能日志
3. [ ] 在 Planner 中添加性能日志
4. [ ] 在 Executor 中添加性能日志
5. [ ] 实现日志聚合和查询

---

## 总结

### 已完成

- ✅ 优化 1：计划确认 UI

### 待完成

- ⏳ 优化 2：执行进度显示
- ⏳ 优化 3：性能优化 - 复杂度分析缓存
- ⏳ 优化 4：监控日志

### 优先级

1. **高优先级**: 执行进度显示（提升用户体验）
2. **中优先级**: 复杂度分析缓存（提升性能）
3. **低优先级**: 监控日志（可观测性）

### 下一步

建议按优先级顺序实施：
1. 实施优化 2（执行进度显示）
2. 实施优化 3（性能优化）
3. 实施优化 4（监控日志）
