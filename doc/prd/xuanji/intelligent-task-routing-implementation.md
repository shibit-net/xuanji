# 智能任务路由系统 - 实施完成

## 实施时间
2026-03-14

---

## 系统概述

智能任务路由系统能够自动判断任务复杂度，选择最合适的执行模式：
- **简单任务** → 直接执行（AgentLoop，快速响应）
- **复杂任务** → Multi-Agent 系统（Orchestrator + Worker Agents，专业化能力）

---

## 核心组件

### 1. TaskRouter（任务路由器）
**路径**: `src/core/routing/TaskRouter.ts`

**职责**:
- 根据配置、触发词、复杂度分析决定执行模式
- 支持运行时升级（direct → multi-agent）
- 提供配置管理

**API**:
```typescript
const router = new TaskRouter(config, provider);

// 路由决策
const decision = await router.route(userInput, context);
// decision.mode: 'direct' | 'multi-agent'

// 检查是否需要升级
const needUpgrade = router.shouldUpgrade(currentSteps, currentTokens);
```

### 2. ComplexityAnalyzer（复杂度分析器）
**路径**: `src/core/routing/ComplexityAnalyzer.ts`

**职责**:
- 使用 LLM（Haiku）快速分析任务复杂度
- 缓存分析结果（5 分钟 TTL）
- 降级处理（分析失败时返回默认简单任务）

**分析维度**:
- `isMultiStep`: 是否多步骤
- `requiresSpecialist`: 是否需要专业 Agent
- `estimatedSteps`: 预估步骤数（1-20）
- `domains`: 涉及领域
- `parallelizable`: 是否可并行
- `complexity`: simple | medium | complex
- `recommendedAgents`: 推荐的 Agent IDs

**示例**:
```typescript
const analyzer = new ComplexityAnalyzer(provider);
const complexity = await analyzer.analyze(
  "审查代码并生成测试用例",
  context
);
// complexity.complexity === 'complex'
// complexity.estimatedSteps === 6
```

### 3. TriggerDetector（触发词检测）
**路径**: `src/core/routing/TriggerDetector.ts`

**职责**:
- 检测命令触发词（`/orchestrate`, `/plan`, `/multi-agent`）
- 检测自然语言触发模式（"帮我规划"、"代码审查专家"）
- 检测 Agent 提及
- 检测并行意图

**示例**:
```typescript
const detector = new TriggerDetector();

// 命令触发
detector.detect('/orchestrate 规划任务');
// { type: 'command', trigger: '/orchestrate' }

// NLP 触发
detector.detect('帮我规划一个完整的流程');
// { type: 'nlp', trigger: '/帮我?规划/' }
```

### 4. ExecutionPlanner（执行计划生成器）
**路径**: `src/core/agent/ExecutionPlanner.ts`

**职责**:
- 使用 LLM（Sonnet）生成详细执行计划
- 任务分解、Agent 分配、依赖分析
- 计划验证（Agent 存在性、依赖合法性）

**执行计划结构**:
```typescript
interface ExecutionPlan {
  taskId: string;
  taskDescription: string;
  steps: ExecutionStep[];
  requiredAgents: { id, name, role }[];
  estimatedTotalDuration: number;
  createdAt: string;
}

interface ExecutionStep {
  order: number;
  description: string;
  agentId?: string;
  estimatedDuration?: number;
  parallelWith?: number[];
  dependsOn?: number[];
}
```

**示例**:
```typescript
const planner = new ExecutionPlanner(provider, agentRegistry);
const plan = await planner.generatePlan(
  "审查代码并生成测试用例",
  complexity
);

// plan.steps:
// 1. 读取文件
// 2. 代码审查 (code-reviewer)
// 3. 生成测试 (test-generator)
// 4. 汇总结果
```

### 5. OrchestratorAgent 增强
**路径**: `src/core/agent/OrchestratorAgent.ts`

**新增方法**:
```typescript
// 生成执行计划
async generatePlan(
  userTask: string,
  complexity?: TaskComplexity
): Promise<ExecutionPlan>

// 执行计划
async executePlan(
  plan: ExecutionPlan,
  onStepComplete?: (step, result) => void
): Promise<string>
```

---

## 路由决策流程

```
用户输入
    ↓
TaskRouter.route()
    ↓
┌─────────────────────────────────────┐
│ 1. 检查配置强制模式                 │
│    mode: 'never' → direct           │
│    mode: 'always' → multi-agent     │
│    mode: 'auto' → 继续判断          │
├─────────────────────────────────────┤
│ 2. 检测显式触发词                   │
│    /orchestrate, /plan, /multi-agent│
│    "帮我规划", "代码审查专家"        │
│    ↓ 匹配 → multi-agent             │
├─────────────────────────────────────┤
│ 3. LLM 复杂度分析                   │
│    使用 Haiku 快速评估              │
│    - isMultiStep                    │
│    - requiresSpecialist             │
│    - estimatedSteps ≥ 5             │
│    - complexity === 'complex'       │
│    ↓ 复杂 → multi-agent             │
├─────────────────────────────────────┤
│ 4. 默认行为                         │
│    → direct                         │
└─────────────────────────────────────┘
```

---

## Multi-Agent 执行流程

```
复杂任务
    ↓
Orchestrator.generatePlan()
    ↓
生成执行计划（LLM Sonnet）
    ↓
展示计划给用户
    ↓
等待用户确认
    ↓
Orchestrator.executePlan()
    ↓
按步骤执行
    ├─ 步骤 1: 准备工作
    ├─ 步骤 2: Agent A 执行
    ├─ 步骤 3: Agent B 执行（可并行）
    └─ 步骤 4: 汇总结果
    ↓
返回最终结果
```

---

## 配置示例

### 默认配置（智能模式）
```typescript
const config: RoutingConfig = {
  mode: 'auto', // 智能判断

  complexity: {
    minStepsForMultiAgent: 5,
    tokenThreshold: 8000,
    useAnalyzer: true, // 启用 LLM 分析
    analyzerModel: 'claude-3-5-haiku-20241022',
    cacheTTL: 300, // 5 分钟缓存
  },

  runtimeUpgrade: {
    enabled: true,
    autoConfirm: false, // 需要用户确认
    thresholds: {
      maxSteps: 10,
      maxTokens: 8000,
    },
  },

  executionPlan: {
    enabled: true,
    requireConfirmation: true, // 复杂任务需要确认
    planTimeout: 60,
  },
};
```

### 强制直接执行
```typescript
const config: RoutingConfig = {
  mode: 'never', // 强制禁用 Multi-Agent
  // ...
};
```

### 强制 Multi-Agent
```typescript
const config: RoutingConfig = {
  mode: 'always', // 强制启用 Multi-Agent
  // ...
};
```

---

## 使用示例

### 示例 1：ChatSession 集成（简化版）

```typescript
import { TaskRouter, DEFAULT_ROUTING_CONFIG } from '@/core/routing';
import { OrchestratorAgent } from '@/core/agent/OrchestratorAgent';

export class ChatSession {
  private taskRouter: TaskRouter;
  private orchestrator: OrchestratorAgent | null = null;

  async init() {
    // 初始化路由器
    this.taskRouter = new TaskRouter(
      DEFAULT_ROUTING_CONFIG,
      this.provider
    );

    // 初始化 Orchestrator
    this.orchestrator = new OrchestratorAgent(
      this.provider,
      this.agentRegistry,
      this.memoryManager,
      this.skillRegistry,
      this.toolRegistry
    );
  }

  async run(userMessage: string): Promise<void> {
    // 1. 路由决策
    const decision = await this.taskRouter.route(userMessage, {
      sessionId: this.sessionId,
      messageCount: this.messages.length,
      usedAgents: [],
    });

    if (decision.mode === 'multi-agent') {
      // 2a. Multi-Agent 模式
      this.ui.showInfo(`🔀 启用 Multi-Agent 模式（${decision.reason}）`);

      // 生成执行计划
      const plan = await this.orchestrator.generatePlan(
        userMessage,
        decision.complexity
      );

      // 展示计划
      this.ui.showPlan(plan);

      // 等待用户确认
      const confirmed = await this.ui.confirmPlan(plan);
      if (!confirmed) {
        this.ui.showInfo('❌ 已取消执行');
        return;
      }

      // 执行计划
      await this.orchestrator.executePlan(plan, (step, result) => {
        this.ui.showStepComplete(step, result);
      });
    } else {
      // 2b. 直接执行模式
      await this.agentLoop.run(userMessage);
    }
  }
}
```

### 示例 2：仅分析复杂度

```typescript
import { ComplexityAnalyzer } from '@/core/routing';

const analyzer = new ComplexityAnalyzer(provider);

const complexity = await analyzer.analyze(
  "帮我审查代码并生成测试用例"
);

console.log(complexity);
// {
//   isMultiStep: true,
//   requiresSpecialist: true,
//   estimatedSteps: 6,
//   domains: ['coding', 'review', 'testing'],
//   parallelizable: true,
//   complexity: 'complex',
//   recommendedAgents: ['code-reviewer', 'test-generator'],
//   reasoning: '需要代码审查和测试生成两个专业领域的能力'
// }
```

### 示例 3：手动生成和执行计划

```typescript
import { ExecutionPlanner } from '@/core/agent/ExecutionPlanner';
import { OrchestratorAgent } from '@/core/agent/OrchestratorAgent';

const planner = new ExecutionPlanner(provider, agentRegistry);
const orchestrator = new OrchestratorAgent(/* ... */);

// 生成计划
const plan = await planner.generatePlan(
  "审查 src/auth.ts 并生成测试用例"
);

// 验证计划
const validation = planner.validatePlan(plan);
if (!validation.valid) {
  console.error('计划无效:', validation.errors);
  return;
}

// 执行计划
const result = await orchestrator.executePlan(plan, (step, result) => {
  console.log(`步骤 ${step} 完成:`, result);
});

console.log('最终结果:', result);
```

---

## 用户体验示例

### 场景 1：简单任务（自动直接执行）
```
用户: 今天天气如何？

系统: [直接执行，快速响应]
      今天北京晴，15-25℃...
```

### 场景 2：复杂任务（自动 Multi-Agent + 计划确认）
```
用户: 请审查 src/auth.ts 的代码质量，并生成测试用例

系统: 🔀 检测到复杂任务，启用 Multi-Agent 模式

      📋 执行计划

      任务: 审查 src/auth.ts 的代码质量，并生成测试用例
      步骤数: 4
      预估时间: 2 分钟

      步骤:
      1. 读取 src/auth.ts 文件内容（5秒）
      2. [code-reviewer] 分析代码质量、识别问题（1分钟）
      3. [test-generator] 基于代码生成测试用例（45秒）
      4. 汇总审查报告和测试用例（10秒）

      需要的 Agent:
      - code-reviewer（代码审查专家）
      - test-generator（测试生成器）

      是否执行此计划？[Y/n]

用户: y

系统: ▶️  开始执行...

      ✓ 步骤 1 完成
      ✓ 步骤 2 完成（code-reviewer）
      ✓ 步骤 3 完成（test-generator）
      ✓ 步骤 4 完成

      ✅ 执行计划完成

      # 执行结果

      ## 代码审查报告
      ...

      ## 生成的测试用例
      ...
```

### 场景 3：显式触发
```
用户: /orchestrate 帮我规划一个完整的前端项目结构

系统: 🔀 启用 Multi-Agent 模式（用户命令）

      📋 正在生成执行计划...
```

### 场景 4：运行时升级
```
用户: 帮我重构这个模块

系统: [直接执行中...]
      [工具调用 1/10]
      [工具调用 2/10]
      ...
      [工具调用 11/10]

      ⚠️  任务比预期复杂，建议启用 Multi-Agent 模式。
      是否切换？[Y/n]

用户: y

系统: 🔀 切换到 Multi-Agent 模式...
      📋 正在生成执行计划...
```

---

## 性能优化

### 1. 分析器缓存
- 相同/相似任务复用分析结果
- 缓存 TTL: 5 分钟（可配置）
- 缓存键：标准化的用户输入

### 2. 快速路径
- 显式触发直接返回，跳过 LLM 分析
- 配置强制模式跳过所有分析

### 3. 模型选择
- 复杂度分析：Haiku（低成本，快速）
- 计划生成：Sonnet（高质量）

### 4. 并行优化
- 计划执行时识别可并行步骤
- 未来可支持真正的并行执行（TODO）

---

## 监控和日志

### 关键指标
- 路由决策准确率
- Multi-Agent 利用率
- 平均任务完成时间
- Token 消耗对比
- 缓存命中率

### 日志级别
```
debug: 详细的路由决策过程
info: 关键路由决策和计划生成
warn: 分析失败、计划验证失败
error: 路由错误、执行错误
```

### 日志示例
```json
{
  "level": "info",
  "module": "task-router",
  "message": "Routing to multi-agent mode (complexity)",
  "decision": {
    "mode": "multi-agent",
    "reason": "complexity",
    "complexity": {
      "complexity": "complex",
      "estimatedSteps": 6,
      "requiresSpecialist": true
    }
  }
}
```

---

## 测试计划

### 单元测试
- [ ] `TriggerDetector` 触发词检测
- [ ] `ComplexityAnalyzer` LLM 分析和缓存
- [ ] `TaskRouter` 路由决策逻辑
- [ ] `ExecutionPlanner` 计划生成和验证

### 集成测试
- [ ] ChatSession + TaskRouter 集成
- [ ] Orchestrator + ExecutionPlanner 集成
- [ ] 端到端路由流程

### 场景测试
- [ ] 简单任务（天气、问答）
- [ ] 中等任务（代码生成）
- [ ] 复杂任务（代码审查 + 测试生成）
- [ ] 运行时升级
- [ ] 显式触发

---

## 下一步计划

### Phase 1：ChatSession 集成（2 天）
- [ ] 在 ChatSession 中集成 TaskRouter
- [ ] 实现计划展示 UI（CLI/GUI）
- [ ] 实现用户确认流程
- [ ] 测试基本路由功能

### Phase 2：UI 优化（1 天）
- [ ] 计划预览界面美化
- [ ] 步骤执行进度展示
- [ ] 错误处理和重试 UI

### Phase 3：优化和测试（2 天）
- [ ] 性能测试和优化
- [ ] 边界场景测试
- [ ] 文档补充

---

## 技术债务

### 已知限制
1. 并行执行未实现（计划中标记 parallelWith 但实际串行）
2. 运行时升级的状态迁移未实现
3. 计划修改功能未实现（用户只能接受或拒绝）

### 待优化
1. 复杂度分析的 prompt 可能需要根据实际使用调优
2. 计划生成的 prompt 需要根据 Agent 能力动态调整
3. 缓存策略可以更智能（语义相似度匹配）

---

## 总结

✅ **核心组件已完成**
- TaskRouter: 智能路由决策
- ComplexityAnalyzer: LLM 复杂度分析
- TriggerDetector: 触发词检测
- ExecutionPlanner: 计划生成
- OrchestratorAgent: 计划执行

✅ **设计目标达成**
- ✅ LLM 自动分析任务复杂度
- ✅ 复杂任务生成执行计划
- ✅ 用户确认后执行
- ✅ 简单任务快速响应

⏳ **待完成**
- ChatSession 集成
- UI 实现（计划展示、用户确认）
- 完整测试

**预计总工时**: 8-10 天
**当前完成**: 核心组件（4 天工作量）
**剩余工作**: 集成和测试（4-6 天）
