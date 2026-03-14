# 智能任务路由系统设计

## 设计目标

让 Xuanji 能够智能判断任务复杂度，自动选择最合适的执行模式：
- **简单任务**：直接执行（ChatSession + AgentLoop）
- **复杂任务**：启用 Multi-Agent 系统（Orchestrator + Worker Agents）

---

## 核心理念

### 1. 用户无感知
- 用户只需描述任务，无需关心底层如何执行
- 系统自动判断并选择最优执行路径
- 透明切换，体验一致

### 2. 渐进式增强
- 默认简单模式（快速响应）
- 检测到复杂性时自动升级
- 可随时手动切换

### 3. 性能优先
- 简单任务避免 Multi-Agent 开销
- 复杂任务充分利用专业化能力
- 减少不必要的 token 消耗

---

## 执行模式对比

| 维度 | 直接执行模式 | Multi-Agent 模式 |
|------|-------------|-----------------|
| **适用场景** | 单一、简单任务 | 复杂、多步骤任务 |
| **响应速度** | 快（单轮对话） | 慢（任务分解 + 调度） |
| **Token 消耗** | 低 | 高（Orchestrator + Workers） |
| **专业化能力** | 通用 | 强（专属 Skills/Knowledge） |
| **并行能力** | 无 | 有（多 Agent 并发） |
| **示例** | "今天天气如何" | "审查代码并生成测试报告" |

---

## 智能路由规则

### 优先级（从高到低）

#### 1. 配置强制模式（最高优先级）
```json5
{
  multiAgent: {
    enabled: false,  // 强制禁用 Multi-Agent
    mode: "auto",    // auto | always | never
  }
}
```

- `mode: "never"` → 强制直接执行
- `mode: "always"` → 强制 Multi-Agent
- `mode: "auto"` → 智能判断（默认）

#### 2. 显式触发词
用户输入包含以下关键词时，自动启用 Multi-Agent：

**命令触发**：
- `/orchestrate` - 明确启用 Orchestrator
- `/plan` - 任务规划模式
- `/multi-agent` - Multi-Agent 模式

**自然语言触发**：
- "帮我规划..."
- "安排多个任务..."
- "分别完成..."
- "请代码审查专家..."
- "需要数据分析助手..."

#### 3. 任务特征检测（LLM 辅助）

使用轻量级 LLM 调用（Haiku）快速分析：

**检测维度**：
```typescript
interface TaskComplexity {
  isMultiStep: boolean;       // 是否包含多个步骤
  requiresSpecialist: boolean; // 是否需要专业 Agent
  estimatedSteps: number;     // 预估步骤数
  domains: string[];          // 涉及的领域
  parallelizable: boolean;    // 是否可并行
  complexity: 'simple' | 'medium' | 'complex';
}
```

**复杂任务信号**：
- 包含多个独立子任务（"并且"、"然后"、"接着"）
- 提及特定领域（"代码审查"、"数据分析"、"文档生成"）
- 需要多轮交互（"先...再..."）
- 预估步骤 ≥ 5
- 可并行执行（"分别"、"同时"）

**示例判断**：

| 用户输入 | 判断结果 | 原因 |
|---------|---------|------|
| "今天天气如何？" | 简单 | 单一问题 |
| "帮我写一个函数" | 简单 | 单一任务 |
| "审查这段代码并给出优化建议" | 中等 → **Multi-Agent** | 需要专业能力 |
| "分析项目结构，生成文档，并审查代码质量" | 复杂 → **Multi-Agent** | 多步骤 + 可并行 |
| "帮我规划一个完整的 CI/CD 流程" | 复杂 → **Multi-Agent** | 明确规划需求 |

#### 4. 运行时动态升级
直接执行过程中，如果检测到：
- AgentLoop 步骤数 > 10
- 单轮 token 消耗 > 8000
- 需要调用未注册的专业工具

主动建议用户切换到 Multi-Agent：
```
⚠️  检测到复杂任务，建议启用 Multi-Agent 模式以获得更好的体验。
是否切换？[Y/n]
```

#### 5. 默认行为
- 如果以上规则都不满足 → **直接执行**

---

## 实现架构

### 核心组件

```
┌─────────────────────────────────────────────────┐
│              ChatSession (入口)                  │
│                                                 │
│  ┌───────────────────────────────────────┐     │
│  │    TaskRouter (任务路由器)             │     │
│  │                                       │     │
│  │  1. 检查配置强制模式                   │     │
│  │  2. 检测显式触发词                     │     │
│  │  3. LLM 复杂度评估 (Haiku)            │     │
│  │  4. 路由决策                          │     │
│  └───────────────────────────────────────┘     │
│           │                      │              │
│           ▼                      ▼              │
│  ┌─────────────┐       ┌──────────────────┐    │
│  │  AgentLoop  │       │ OrchestratorAgent│    │
│  │  (直接执行)  │       │  (Multi-Agent)   │    │
│  └─────────────┘       └──────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 文件结构

```
src/core/routing/
├── TaskRouter.ts              # 任务路由器
├── ComplexityAnalyzer.ts      # 复杂度分析器
├── TriggerDetector.ts         # 触发词检测
└── types.ts                   # 路由相关类型

src/session/ChatSession.ts     # 修改：集成路由逻辑
```

---

## 实现细节

### 1. TaskRouter（任务路由器）

```typescript
export class TaskRouter {
  constructor(
    private config: RoutingConfig,
    private complexityAnalyzer: ComplexityAnalyzer,
    private triggerDetector: TriggerDetector,
  ) {}

  /**
   * 决定任务执行模式
   */
  async route(userInput: string, context: SessionContext): Promise<RoutingDecision> {
    // 1. 检查配置强制模式
    if (this.config.mode === 'never') {
      return { mode: 'direct', reason: 'config-forced' };
    }
    if (this.config.mode === 'always') {
      return { mode: 'multi-agent', reason: 'config-forced' };
    }

    // 2. 检测显式触发词
    const trigger = this.triggerDetector.detect(userInput);
    if (trigger) {
      return { mode: 'multi-agent', reason: 'explicit-trigger', trigger };
    }

    // 3. LLM 复杂度评估
    const complexity = await this.complexityAnalyzer.analyze(userInput, context);
    if (complexity.complexity === 'complex' || complexity.requiresSpecialist) {
      return { mode: 'multi-agent', reason: 'complexity', complexity };
    }

    // 4. 默认：直接执行
    return { mode: 'direct', reason: 'default' };
  }
}
```

### 2. ComplexityAnalyzer（复杂度分析器）

```typescript
export class ComplexityAnalyzer {
  constructor(private provider: ILLMProvider) {}

  async analyze(userInput: string, context: SessionContext): Promise<TaskComplexity> {
    const prompt = `分析以下任务的复杂度：

任务：${userInput}

请以 JSON 格式回答：
{
  "isMultiStep": boolean,        // 是否多步骤
  "requiresSpecialist": boolean, // 是否需要专业 Agent
  "estimatedSteps": number,      // 预估步骤数（1-20）
  "domains": string[],           // 涉及领域（如 ["coding", "review"]）
  "parallelizable": boolean,     // 是否可并行
  "complexity": "simple" | "medium" | "complex"
}`;

    // 使用 Haiku 快速评估（低成本）
    const response = await this.provider.complete([
      { role: 'user', content: prompt }
    ], [], {
      model: 'claude-3-5-haiku-20241022',
      maxTokens: 200,
    });

    return JSON.parse(response);
  }
}
```

### 3. TriggerDetector（触发词检测）

```typescript
export class TriggerDetector {
  private readonly COMMAND_TRIGGERS = [
    '/orchestrate',
    '/plan',
    '/multi-agent',
  ];

  private readonly NLP_TRIGGERS = [
    /帮我规划/,
    /安排.*任务/,
    /分别.*完成/,
    /代码审查专家/,
    /数据分析助手/,
    /需要.*专家/,
  ];

  detect(userInput: string): TriggerMatch | null {
    // 检测命令触发
    for (const cmd of this.COMMAND_TRIGGERS) {
      if (userInput.startsWith(cmd)) {
        return { type: 'command', trigger: cmd };
      }
    }

    // 检测自然语言触发
    for (const pattern of this.NLP_TRIGGERS) {
      if (pattern.test(userInput)) {
        return { type: 'nlp', trigger: pattern.source };
      }
    }

    return null;
  }
}
```

### 4. ChatSession 集成

```typescript
export class ChatSession {
  private taskRouter: TaskRouter;
  private orchestrator: OrchestratorAgent | null = null;

  async run(userMessage: string): Promise<void> {
    // 智能路由
    const decision = await this.taskRouter.route(userMessage, this.getContext());

    if (decision.mode === 'multi-agent') {
      // 显示路由信息
      this.ui.showInfo(`🔀 启用 Multi-Agent 模式（${decision.reason}）`);

      // 初始化 Orchestrator（如果需要）
      if (!this.orchestrator) {
        this.orchestrator = new OrchestratorAgent(
          this.agentRegistry,
          this.provider,
          this.skillRegistry,
          this.toolRegistry,
        );
        await this.orchestrator.init();
      }

      // 执行任务
      await this.orchestrator.run(userMessage);
    } else {
      // 直接执行（现有逻辑）
      await this.agentLoop.run(userMessage);
    }
  }
}
```

---

## 配置示例

### 默认配置（智能模式）
```json5
{
  multiAgent: {
    enabled: true,
    mode: "auto",  // 智能判断

    // 复杂度评估配置
    complexity: {
      minStepsForMultiAgent: 5,      // 步骤数阈值
      tokenThreshold: 8000,          // Token 消耗阈值
      useAnalyzer: true,             // 启用 LLM 分析器
      analyzerModel: "claude-3-5-haiku-20241022",
    },

    // 运行时升级
    runtimeUpgrade: {
      enabled: true,
      autoConfirm: false,  // 需要用户确认
      thresholds: {
        maxSteps: 10,
        maxTokens: 8000,
      },
    },
  },
}
```

### 强制直接执行（适合简单场景）
```json5
{
  multiAgent: {
    enabled: false,
    mode: "never",
  },
}
```

### 强制 Multi-Agent（适合复杂项目）
```json5
{
  multiAgent: {
    enabled: true,
    mode: "always",
  },
}
```

---

## 用户体验示例

### 场景 1：简单任务（自动直接执行）
```
用户: 今天天气如何？
系统: [直接执行]
      今天北京晴，气温 15-25℃...
```

### 场景 2：复杂任务（自动 Multi-Agent）
```
用户: 请审查 src/auth.ts 的代码质量，并生成测试用例
系统: 🔀 检测到复杂任务，启用 Multi-Agent 模式

      📋 任务分解：
      1. [code-reviewer] 代码质量审查
      2. [test-generator] 生成测试用例

      ▶️  开始执行...
```

### 场景 3：显式触发
```
用户: /orchestrate 帮我规划一个完整的前端项目结构
系统: 🔀 启用 Multi-Agent 模式（用户命令）

      📋 Orchestrator 正在规划...
```

### 场景 4：运行时升级
```
用户: 帮我重构这个模块
系统: [直接执行中...]
      [检测到步骤数 > 10]

      ⚠️  任务比预期复杂，建议启用 Multi-Agent 模式。
      是否切换？[Y/n]

用户: y
系统: 🔀 切换到 Multi-Agent 模式...
```

---

## 实现计划

### Phase 1：基础路由（1-2 天）
- [ ] 实现 TaskRouter 基本框架
- [ ] 实现 TriggerDetector（命令 + NLP）
- [ ] ChatSession 集成路由逻辑
- [ ] 配置系统支持

### Phase 2：复杂度分析（2-3 天）
- [ ] 实现 ComplexityAnalyzer
- [ ] 设计 LLM 评估 prompt
- [ ] 阈值调优
- [ ] 缓存机制（避免重复分析）

### Phase 3：运行时升级（1 天）
- [ ] AgentLoop 监控钩子
- [ ] 升级建议 UI
- [ ] 状态迁移（Direct → Multi-Agent）

### Phase 4：优化和测试（2 天）
- [ ] 性能优化（分析器缓存）
- [ ] 边界场景测试
- [ ] 文档和示例

**总计**：6-8 天

---

## 性能优化

### 1. 分析器缓存
```typescript
// 相似任务复用分析结果
const cacheKey = hash(userInput);
if (this.cache.has(cacheKey)) {
  return this.cache.get(cacheKey);
}
```

### 2. 快速路径
```typescript
// 显式触发直接返回，跳过 LLM 分析
if (trigger) {
  return { mode: 'multi-agent', reason: 'explicit-trigger' };
}
```

### 3. 异步预分析
```typescript
// 用户输入时后台启动分析
onUserTyping(input) {
  if (input.length > 20) {
    this.complexityAnalyzer.analyzeAsync(input);
  }
}
```

---

## 监控指标

### 关键指标
- 路由决策准确率（用户是否手动切换？）
- 直接执行成功率
- Multi-Agent 利用率
- 平均任务完成时间
- Token 消耗对比

### 日志示例
```json
{
  "timestamp": "2026-03-14T10:00:00Z",
  "taskId": "task-123",
  "userInput": "审查代码并生成测试",
  "routingDecision": {
    "mode": "multi-agent",
    "reason": "complexity",
    "complexity": {
      "isMultiStep": true,
      "requiresSpecialist": true,
      "estimatedSteps": 6
    }
  },
  "executionTime": 45000,
  "tokenUsed": 12500
}
```

---

## 总结

### 优势
- ✅ 用户无感知，智能自适应
- ✅ 简单任务快速响应
- ✅ 复杂任务充分利用专业能力
- ✅ 灵活配置，满足不同场景
- ✅ 运行时动态调整

### 权衡
- ⚠️  需要额外的复杂度分析（LLM 调用）
- ⚠️  增加系统复杂度
- ⚠️  需要调优阈值参数

### 适用场景
- 通用 AI 助手（日常对话 + 专业任务）
- 编程助手（简单问答 + 代码审查）
- 企业工作流（任务自动化 + 专业分析）
