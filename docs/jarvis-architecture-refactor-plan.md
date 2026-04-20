# 贾维斯架构改造方案 - 复用xuanji现有功能

> 基于xuanji现有的意图识别系统，最小化改造成本

## 📋 现有可复用功能分析

### 1. 意图识别系统（完全可复用）

xuanji已有完整的意图识别系统，位于 `src/core/intent/`：

| 模块 | 功能 | 状态 | 复用方式 |
|------|------|------|---------|
| **IntentRouter** | 意图路由器 | ✅ 完善 | 直接复用 |
| **VectorIntentMatcher** | 向量匹配 | ✅ 完善 | 直接复用 |
| **LLMIntentClassifier** | LLM分类 | ✅ 完善 | 直接复用 |
| **IntentLearner** | 自动学习 | ✅ 完善 | 直接复用 |
| **IntentRegistry** | 意图注册表 | ✅ 完善 | 直接复用 |
| **UniversalIntentScanner** | 模块扫描 | ✅ 完善 | 直接复用 |

**核心优势：**
- ✅ 支持向量匹配（快速，语义理解）
- ✅ 支持LLM分类（精确分析）
- ✅ 支持自动学习（持续优化）
- ✅ 支持多种领域（coding/life/finance/learning/health/general）

### 2. 场景分析器（需要扩展）

xuanji已有 `IntentAnalyzer`，位于 `src/core/prompt/IntentAnalyzer.ts`：

| 功能 | 状态 | 改造需求 |
|------|------|---------|
| 场景匹配（规则+Embedding） | ✅ 完善 | 扩展场景类型 |
| 复杂度判断 | ✅ 完善 | 直接复用 |
| 场景防抖 | ✅ 完善 | 直接复用 |

**需要扩展的场景：**
- 当前支持：coding（默认）
- 需要添加：debug/review/test/refactor/explain/explore/plan

### 3. Prompt系统（需要扩展）

xuanji已有 `LayeredPromptBuilder`，位于 `src/core/prompt/LayeredPromptBuilder.ts`：

| 功能 | 状态 | 改造需求 |
|------|------|---------|
| 分层Prompt构建 | ✅ 完善 | 添加场景Prompt |
| 动态组装 | ✅ 完善 | 直接复用 |

---

## 🎯 改造方案

### 方案概述

**核心思路：** 不重新实现IntentParser，而是扩展现有的IntentRouter和IntentAnalyzer

```
用户输入
  ↓
IntentRouter（复用xuanji）
  ├─ VectorIntentMatcher（向量匹配）
  ├─ LLMIntentClassifier（LLM分类）
  └─ IntentLearner（自动学习）
  ↓
IntentAnalyzer（扩展xuanji）
  ├─ 场景匹配（添加8种编程场景）
  ├─ 复杂度判断（直接复用）
  └─ 场景防抖（直接复用）
  ↓
MainAgent（新增）
  ├─ TaskPlanner（新增）
  ├─ PromptStore（扩展LayeredPromptBuilder）
  └─ ResultAggregator（新增）
  ↓
TeamManager（复用xuanji）
  └─ AgentLoop（复用xuanji）
```

---

## 📦 具体改造步骤

### Step 1: 扩展IntentAnalyzer（1天）

**文件：** `src/core/prompt/IntentAnalyzer.ts`

**改造内容：**

```typescript
// 1. 扩展场景类型
export type SceneType = 
  | 'coding'      // 通用编程（保留）
  | 'write_code'  // 写代码（新增）
  | 'debug'       // 调试（新增）
  | 'review'      // 审查（新增）
  | 'test'        // 测试（新增）
  | 'refactor'    // 重构（新增）
  | 'explain'     // 讲解（新增）
  | 'explore'     // 探索（新增）
  | 'plan';       // 规划（新增）

// 2. 添加场景匹配规则
const SCENE_RULES: Record<SceneType, RegExp> = {
  'write_code': /^(写|实现|创建|添加|新增).*(代码|功能|接口|组件|模块)/i,
  'debug': /^(修复|解决|排查|调试|找出).*(bug|问题|错误|异常)/i,
  'review': /^(审查|检查|优化|改进|评估).*(代码|实现|质量)/i,
  'test': /^(写|添加|补充|完善).*(测试|单元测试|集成测试)/i,
  'refactor': /^(重构|改造|优化|重写).*(代码|架构|结构)/i,
  'explain': /^(讲解|解释|说明|介绍|阐述).*(原理|实现|代码)/i,
  'explore': /^(探索|分析|理解|查看|研究).*(代码库|项目|架构)/i,
  'plan': /^(规划|设计|制定|构思).*(方案|计划|架构)/i,
  'coding': /.*/i, // 默认
};

// 3. 注册场景配置
export function registerCodingScenes(analyzer: IntentAnalyzer): void {
  analyzer.registerScene('write_code', {
    description: '编写代码、实现功能',
    keywords: SCENE_RULES['write_code'],
  });
  
  analyzer.registerScene('debug', {
    description: '排查问题、修复bug',
    keywords: SCENE_RULES['debug'],
  });
  
  // ... 其他场景
}
```

**改造工作量：** ~100行代码

---

### Step 2: 扩展IntentRouter（1天）

**文件：** `src/core/intent/IntentRouter.ts`

**改造内容：**

```typescript
// 1. 添加编程意图类型
export const CODING_INTENT_TYPES = {
  CODE_GENERATION: 'coding.code-generation',
  DEBUGGING: 'coding.debugging',
  CODE_REVIEW: 'coding.code-review',
  TESTING: 'coding.testing',
  REFACTORING: 'coding.refactoring',
  EXPLANATION: 'coding.explanation',
  EXPLORATION: 'coding.exploration',
  PLANNING: 'coding.planning',
} as const;

// 2. 注册编程意图
export function registerCodingIntents(router: IntentRouter): void {
  const codingIntents: IntentMetadata[] = [
    {
      type: CODING_INTENT_TYPES.CODE_GENERATION,
      domain: 'coding',
      trainingExamples: [
        '写一个用户登录接口',
        '实现文件上传功能',
        '创建一个React组件',
        '添加数据验证逻辑',
        '新增API端点',
      ],
      description: '编写代码、实现功能',
      priority: 80,
    },
    {
      type: CODING_INTENT_TYPES.DEBUGGING,
      domain: 'coding',
      trainingExamples: [
        '修复登录bug',
        '解决内存泄漏问题',
        '排查接口报错',
        '调试性能问题',
        '找出崩溃原因',
      ],
      description: '排查问题、修复bug',
      priority: 90,
    },
    // ... 其他意图
  ];

  for (const intent of codingIntents) {
    router.registry.register(intent, {
      id: intent.type,
      moduleType: 'agent',
      intentMeta: intent,
    });
  }
}
```

**改造工作量：** ~200行代码

---

### Step 3: 创建PromptStore（扩展LayeredPromptBuilder）（2天）

**文件：** `src/core/agent/jarvis/PromptStore.ts`

**改造内容：**

```typescript
import { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import type { SceneType } from '@/core/prompt/types';

/**
 * PromptStore - 场景Prompt库（基于LayeredPromptBuilder）
 */
export class PromptStore {
  private promptBuilder: LayeredPromptBuilder;
  private scenePrompts: Map<SceneType, string>;

  constructor(promptBuilder: LayeredPromptBuilder) {
    this.promptBuilder = promptBuilder;
    this.scenePrompts = new Map();
    this.initScenePrompts();
  }

  /**
   * 初始化场景Prompt
   */
  private initScenePrompts(): void {
    // 写代码场景
    this.scenePrompts.set('write_code', `你是专业编程工程师，严谨、简洁，输出代码可直接运行。

核心原则：
- 代码质量：可直接运行，无语法错误
- 简洁明了：附带1-2句核心解释
- 最佳实践：遵循语言规范和设计模式
- 安全优先：避免SQL注入、XSS等安全漏洞`);

    // 调试场景
    this.scenePrompts.set('debug', `你是资深调试工程师，耐心、细致，步骤清晰。

核心原则：
- 先分析：理解报错信息，定位问题根源
- 再修复：给出具体修改方案，步骤清晰
- 验证：说明如何验证修复是否成功`);

    // ... 其他场景
  }

  /**
   * 获取场景Prompt（集成到LayeredPromptBuilder）
   */
  getPromptForScene(scene: SceneType): string {
    const scenePrompt = this.scenePrompts.get(scene);
    if (!scenePrompt) {
      return this.scenePrompts.get('coding')!;
    }

    // 使用LayeredPromptBuilder构建完整Prompt
    return this.promptBuilder.buildScenePrompt(scene, scenePrompt);
  }
}
```

**改造工作量：** ~300行代码

---

### Step 4: 创建MainAgent（集成现有模块）（3天）

**文件：** `src/core/agent/jarvis/MainAgent.ts`

**改造内容：**

```typescript
import { IntentRouter } from '@/core/intent/IntentRouter';
import { IntentAnalyzer } from '@/core/prompt/IntentAnalyzer';
import { TeamManager } from '../team/TeamManager';
import { PromptStore } from './PromptStore';
import { TaskPlanner } from './TaskPlanner';
import { ResultAggregator } from './ResultAggregator';

/**
 * MainAgent - 主调度Agent（集成xuanji现有模块）
 */
export class MainAgent {
  private intentRouter: IntentRouter;      // 复用xuanji
  private intentAnalyzer: IntentAnalyzer;  // 扩展xuanji
  private teamManager: TeamManager;        // 复用xuanji
  private promptStore: PromptStore;        // 新增（基于LayeredPromptBuilder）
  private taskPlanner: TaskPlanner;        // 新增
  private resultAggregator: ResultAggregator; // 新增

  constructor(
    intentRouter: IntentRouter,
    intentAnalyzer: IntentAnalyzer,
    teamManager: TeamManager,
    promptStore: PromptStore,
    // ...
  ) {
    this.intentRouter = intentRouter;
    this.intentAnalyzer = intentAnalyzer;
    this.teamManager = teamManager;
    this.promptStore = promptStore;
    this.taskPlanner = new TaskPlanner(provider);
    this.resultAggregator = new ResultAggregator(provider);
  }

  /**
   * 执行用户请求
   */
  async execute(userInput: string, signal?: AbortSignal): Promise<string> {
    // 1. 意图识别（复用IntentRouter）
    const intents = await this.intentRouter.route(userInput, availableModules);
    const topIntent = intents[0];

    // 2. 场景分析（复用IntentAnalyzer）
    const analysis = await this.intentAnalyzer.analyze(userInput);
    const scene = analysis.scene;
    const complexity = analysis.complexity;

    // 3. 任务规划
    const plan = await this.taskPlanner.plan(topIntent, complexity, userInput);

    // 4. 执行任务（复用TeamManager）
    const result = await this.executeWithTeamManager(plan, scene, signal);

    // 5. 结果汇总
    return this.resultAggregator.aggregate(result, userInput);
  }

  /**
   * 使用TeamManager执行任务
   */
  private async executeWithTeamManager(
    plan: TaskPlan,
    scene: SceneType,
    signal?: AbortSignal
  ): Promise<TeamExecutionResult> {
    // 构建TeamConfig
    const teamConfig: TeamConfig = {
      name: 'jarvis-task',
      strategy: plan.strategy,
      members: plan.tasks.map(task => ({
        id: task.id,
        agentId: task.agentId,
        systemPrompt: this.promptStore.getPromptForScene(task.scene),
        capabilities: [task.scene],
        priority: task.priority,
      })),
    };

    await this.teamManager.createTeam(teamConfig);
    return this.teamManager.execute(plan.goal, signal);
  }
}
```

**改造工作量：** ~500行代码

---

### Step 5: 集成到ChatSession（1天）

**文件：** `src/core/chat/ChatSession.ts`

**改造内容：**

```typescript
import { MainAgent } from '@/core/agent/jarvis/MainAgent';
import { registerCodingIntents } from '@/core/intent/IntentRouter';
import { registerCodingScenes } from '@/core/prompt/IntentAnalyzer';

export class ChatSession {
  private mainAgent: MainAgent | null = null;
  private useJarvisMode = false; // 🆕 贾维斯模式开关

  async init(): Promise<void> {
    // ... 现有初始化逻辑

    // 🆕 初始化贾维斯模式
    if (this.useJarvisMode) {
      await this.initJarvisMode();
    }
  }

  /**
   * 🆕 初始化贾维斯模式
   */
  private async initJarvisMode(): Promise<void> {
    // 1. 注册编程意图
    registerCodingIntents(this.intentRouter);

    // 2. 注册编程场景
    registerCodingScenes(this.intentAnalyzer);

    // 3. 创建MainAgent
    this.mainAgent = new MainAgent(
      this.intentRouter,
      this.intentAnalyzer,
      this.teamManager,
      this.promptStore,
      // ...
    );

    log.info('Jarvis mode initialized');
  }

  /**
   * 发送消息（支持贾维斯模式）
   */
  async sendMessage(message: string): Promise<void> {
    if (this.useJarvisMode && this.mainAgent) {
      // 🆕 使用贾维斯模式
      const result = await this.mainAgent.execute(message);
      this.callbacks.onText?.(result);
    } else {
      // 原有逻辑
      await this.agentLoop.run(message);
    }
  }
}
```

**改造工作量：** ~100行代码

---

## 📊 改造工作量总结

| 步骤 | 文件 | 工作量 | 优先级 |
|------|------|--------|--------|
| Step 1 | IntentAnalyzer扩展 | 1天 | P0 |
| Step 2 | IntentRouter扩展 | 1天 | P0 |
| Step 3 | PromptStore创建 | 2天 | P0 |
| Step 4 | MainAgent创建 | 3天 | P0 |
| Step 5 | ChatSession集成 | 1天 | P0 |
| **总计** | **5个文件** | **8天** | - |

---

## ✅ 改造优势

### 1. 最小化改造成本

- ✅ **复用IntentRouter**：完整的意图识别系统（向量匹配+LLM分类+自动学习）
- ✅ **复用IntentAnalyzer**：场景匹配+复杂度判断+场景防抖
- ✅ **复用TeamManager**：5种协调策略
- ✅ **复用AgentLoop**：高效执行引擎
- ✅ **复用LayeredPromptBuilder**：分层Prompt构建

### 2. 保留xuanji优势

- ✅ **向量匹配**：快速、语义理解
- ✅ **自动学习**：持续优化
- ✅ **场景防抖**：避免频繁切换
- ✅ **多策略协调**：sequential/parallel/hierarchical/debate/pipeline
- ✅ **完整工具生态**：Read/Write/Edit/Bash/Grep/Glob等

### 3. 融合贾维斯优势

- ✅ **主Agent调度**：职责清晰
- ✅ **动态Prompt**：场景感知
- ✅ **8种编程场景**：专业细分
- ✅ **统一口吻包装**：体验一致

### 4. 性能优化

| 场景 | 原贾维斯方案 | 本方案 | 优化 |
|------|-------------|--------|------|
| 简单任务 | 4次LLM调用 | 1次（向量匹配0ms） | ✅ 75%减少 |
| 复杂任务 | 6次LLM调用 | 3次（向量匹配+拆分+汇总） | ✅ 50%减少 |

---

## 🚀 实施计划

### Week 1: 核心扩展（Step 1-2）
- Day 1-2: 扩展IntentAnalyzer（添加8种场景）
- Day 3-4: 扩展IntentRouter（注册编程意图）
- Day 5: 测试意图识别和场景匹配

### Week 2: 模块创建（Step 3-4）
- Day 1-2: 创建PromptStore（基于LayeredPromptBuilder）
- Day 3-5: 创建MainAgent（集成现有模块）

### Week 3: 集成测试（Step 5）
- Day 1: 集成到ChatSession
- Day 2-3: 端到端测试
- Day 4-5: 性能优化和文档

---

## 📝 配置示例

### 启用贾维斯模式

```typescript
// .xuanji/config.json5
{
  agent: {
    mode: 'jarvis', // 'standard' | 'jarvis'
    jarvis: {
      enableSceneDetection: true,
      enableAutoLearning: true,
      enableVectorMatch: true,
      enableLLMClassify: true,
      sceneThreshold: 0.7,
    }
  }
}
```

### 自定义场景Prompt

```typescript
// .xuanji/prompts/scenes/custom-scene.ts
export const customScenePrompt = {
  scene: 'custom-scene',
  prompt: '你是...',
  temperature: 0.3,
  tools: ['read', 'write'],
};
```

---

## ❓ FAQ

### Q1: 为什么不重新实现IntentParser？

**A:** xuanji已有完善的IntentRouter，支持向量匹配、LLM分类、自动学习，功能远超贾维斯方案的简单规则引擎。直接复用可以：
- 减少80%的开发工作量
- 获得更强大的意图识别能力
- 保持代码一致性

### Q2: 如何保证性能？

**A:** 
- 向量匹配：<10ms（比规则引擎稍慢，但语义理解更准确）
- 自动学习：异步执行，不阻塞主流程
- 场景防抖：避免频繁切换，减少LLM调用

### Q3: 如何扩展新场景？

**A:**
```typescript
// 1. 在IntentAnalyzer中注册场景
analyzer.registerScene('new-scene', {
  description: '新场景描述',
  keywords: /新场景关键词/i,
});

// 2. 在PromptStore中添加Prompt
promptStore.setScenePrompt('new-scene', '你是...');

// 3. 在IntentRouter中注册意图
router.registry.register({
  type: 'coding.new-scene',
  domain: 'coding',
  trainingExamples: ['示例1', '示例2'],
});
```

### Q4: 贾维斯模式和标准模式如何切换？

**A:** 通过配置文件切换，无需修改代码：

```typescript
// 标准模式（原xuanji）
agent.mode = 'standard';

// 贾维斯模式（新架构）
agent.mode = 'jarvis';
```

---

## 🎉 总结

本改造方案成功实现了：

1. **最小化改造成本**：仅需8天，5个文件
2. **完全复用xuanji优势**：IntentRouter + IntentAnalyzer + TeamManager + AgentLoop
3. **融合贾维斯优势**：主Agent调度 + 动态Prompt + 8种场景
4. **性能优化**：向量匹配替代规则引擎，减少50-75%的LLM调用
5. **易于扩展**：支持自定义场景和意图

**下一步：** 开始实施Week 1，扩展IntentAnalyzer和IntentRouter！
