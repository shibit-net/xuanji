# Xuanji 智能意图路由架构

## 设计理念

> **用户无感知，助手自适应**

就像钢铁侠的 Jarvis：
- 用户只说需求，不需要切换模式
- 助手自动识别意图，动态组装能力
- 一句话可能跨多个领域，助手智能处理

## 问题分析

### 错误的设计（手动切换）

```bash
# 用户需要手动切换
/profile switch life-assistant
> 提醒我明天 9 点开会

/profile switch coding
> 提交今天的代码
```

**问题**：
- ❌ 用户需要知道什么场景用什么 Profile
- ❌ 频繁切换，体验割裂
- ❌ 无法处理跨场景任务："提醒我开会，然后提交代码"

### 正确的设计（智能路由）

```bash
# 用户直接说需求
> 提醒我明天 9 点开会，然后提交今天的代码

# Xuanji 自动识别两个意图：
# 1. schedule.reminder (生活场景)
# 2. coding.git-commit (编程场景)

# Xuanji 自动组装能力：
# - System Prompt: life + coding
# - Skills: reminder-set + git-commit
# - Tools: Read, Write, Bash

# 用户完全无感知
```

## 新架构设计

### 整体流程

```
用户输入
    ↓
┌─────────────────────────────────────┐
│  IntentRouter (意图路由器)           │
│  ├── 意图识别                        │
│  ├── 领域分类                        │
│  └── 优先级排序                      │
└─────────────────────────────────────┘
    ↓ 输出：Intent[]
┌─────────────────────────────────────┐
│  CapabilityAssembler (能力组装器)    │
│  ├── System Prompt 组装              │
│  ├── Skills 筛选                     │
│  ├── Tools 筛选                      │
│  └── Memory Scope 合并               │
└─────────────────────────────────────┘
    ↓ 输出：ExecutionPlan
┌─────────────────────────────────────┐
│  AgentLoop (执行器)                  │
│  └── 执行计划                        │
└─────────────────────────────────────┘
    ↓
返回结果
```

## 核心组件

### 1. IntentRouter（意图路由器）

```typescript
// src/core/intent/IntentRouter.ts

/**
 * 意图定义
 */
interface Intent {
  /** 意图 ID */
  id: string;

  /** 意图类型 */
  type: string; // e.g., 'schedule.reminder', 'coding.git-commit'

  /** 所属领域 */
  domain: 'coding' | 'life' | 'finance' | 'learning' | 'health' | 'general';

  /** 置信度 */
  confidence: number; // 0-1

  /** 提取的参数 */
  params?: Record<string, any>;

  /** 原始文本片段 */
  text?: string;
}

/**
 * 意图路由器
 */
export class IntentRouter {
  private intentPatterns = new Map<string, IntentPattern[]>();
  private vectorMatcher: VectorIntentMatcher;

  /**
   * 识别用户输入中的所有意图
   */
  async route(userInput: string): Promise<Intent[]> {
    const intents: Intent[] = [];

    // 1. 基于规则的快速匹配（关键词、正则）
    const ruleBasedIntents = this.matchByRules(userInput);
    intents.push(...ruleBasedIntents);

    // 2. 基于向量的语义匹配
    const semanticIntents = await this.matchBySemantic(userInput);
    intents.push(...semanticIntents);

    // 3. 基于 LLM 的精确识别（备用，慢但准确）
    if (intents.length === 0 || this.needsLLMClassification(userInput)) {
      const llmIntents = await this.matchByLLM(userInput);
      intents.push(...llmIntents);
    }

    // 4. 去重、排序（按置信度）
    return this.deduplicate(intents).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 基于规则匹配（快速）
   */
  private matchByRules(userInput: string): Intent[] {
    const intents: Intent[] = [];
    const lowerInput = userInput.toLowerCase();

    // 日程提醒
    if (/提醒|reminder|remind|闹钟/.test(lowerInput)) {
      intents.push({
        id: 'intent-schedule-reminder',
        type: 'schedule.reminder',
        domain: 'life',
        confidence: 0.9,
        text: userInput,
      });
    }

    // Git 提交
    if (/提交|commit|git/.test(lowerInput) && /代码|code/.test(lowerInput)) {
      intents.push({
        id: 'intent-git-commit',
        type: 'coding.git-commit',
        domain: 'coding',
        confidence: 0.95,
        text: userInput,
      });
    }

    // 记账
    if (/记账|支出|花费|消费|expense/.test(lowerInput)) {
      intents.push({
        id: 'intent-expense-record',
        type: 'finance.expense-record',
        domain: 'finance',
        confidence: 0.9,
        text: userInput,
      });
    }

    // 代码审查
    if (/review|审查|检查/.test(lowerInput) && /(pr|pull request|代码)/.test(lowerInput)) {
      intents.push({
        id: 'intent-code-review',
        type: 'coding.review-pr',
        domain: 'coding',
        confidence: 0.9,
        text: userInput,
      });
    }

    return intents;
  }

  /**
   * 基于向量语义匹配
   */
  private async matchBySemantic(userInput: string): Promise<Intent[]> {
    // 使用 VectorIntentMatcher（类似 VectorSkillMatcher）
    return await this.vectorMatcher.match(userInput);
  }

  /**
   * 基于 LLM 精确分类（备用）
   */
  private async matchByLLM(userInput: string): Promise<Intent[]> {
    const prompt = `分析以下用户输入，识别所有意图。

用户输入：${userInput}

可能的意图类型：
- schedule.reminder：日程提醒
- schedule.event：日程安排
- coding.git-commit：提交代码
- coding.review-pr：代码审查
- finance.expense-record：记账
- finance.stock-query：查询股票
- learning.flashcard：创建学习卡片
- general.question：一般问题

请以 JSON 格式返回：
[
  {
    "type": "schedule.reminder",
    "domain": "life",
    "confidence": 0.95,
    "params": { "time": "明天 9 点", "content": "开会" }
  }
]`;

    const response = await this.llm.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    return JSON.parse(response);
  }

  /**
   * 是否需要 LLM 分类
   */
  private needsLLMClassification(userInput: string): boolean {
    // 如果输入很长、复杂、或包含多个子句，使用 LLM
    return userInput.length > 100 || userInput.split(/[,，。；;]/).length > 2;
  }

  /**
   * 去重
   */
  private deduplicate(intents: Intent[]): Intent[] {
    const seen = new Set<string>();
    return intents.filter((intent) => {
      if (seen.has(intent.type)) return false;
      seen.add(intent.type);
      return true;
    });
  }
}
```

### 2. CapabilityAssembler（能力组装器）

```typescript
// src/core/intent/CapabilityAssembler.ts

/**
 * 执行计划
 */
interface ExecutionPlan {
  /** System Prompt 组件 */
  systemPromptComponents: PromptComponent[];

  /** 激活的 Skills */
  activeSkills: Skill[];

  /** 可用的 Tools */
  availableTools: Tool[];

  /** Memory Scope */
  memoryScopes: string[];

  /** Model 配置 */
  modelConfig: ModelConfig;

  /** 元数据 */
  metadata: {
    intents: Intent[];
    domains: string[];
    estimatedComplexity: 'simple' | 'medium' | 'complex';
  };
}

/**
 * 领域能力配置
 */
interface DomainCapability {
  domain: string;
  systemPromptComponents: string[]; // 组件 ID
  skills: string[]; // Skill ID
  tools: string[]; // Tool 名称
  memoryScope: string;
  modelPreference?: {
    name?: string;
    temperature?: number;
  };
}

/**
 * 能力组装器
 */
export class CapabilityAssembler {
  private domainCapabilities: Map<string, DomainCapability>;
  private systemPromptBuilder: SystemPromptBuilder;
  private skillRegistry: SkillRegistry;
  private toolRegistry: ToolRegistry;

  constructor() {
    this.initDomainCapabilities();
  }

  /**
   * 根据意图组装执行计划
   */
  async assemble(intents: Intent[]): Promise<ExecutionPlan> {
    // 1. 提取所有涉及的领域
    const domains = [...new Set(intents.map((i) => i.domain))];

    // 2. 组装 System Prompt（核心 + 领域特定）
    const systemPromptComponents = this.assembleSystemPrompt(domains);

    // 3. 筛选 Skills（只加载需要的）
    const activeSkills = this.assembleSkills(intents, domains);

    // 4. 筛选 Tools（根据领域权限）
    const availableTools = this.assembleTools(domains);

    // 5. 合并 Memory Scopes（跨领域查询）
    const memoryScopes = this.assembleMemoryScopes(domains);

    // 6. 选择 Model（根据复杂度和领域）
    const modelConfig = this.selectModel(intents, domains);

    return {
      systemPromptComponents,
      activeSkills,
      availableTools,
      memoryScopes,
      modelConfig,
      metadata: {
        intents,
        domains,
        estimatedComplexity: this.estimateComplexity(intents),
      },
    };
  }

  /**
   * 组装 System Prompt
   */
  private assembleSystemPrompt(domains: string[]): PromptComponent[] {
    const components: PromptComponent[] = [];

    // 1. 始终加载核心组件
    components.push(
      this.systemPromptBuilder.get('core-identity')!,
      this.systemPromptBuilder.get('project-rules')!,
      this.systemPromptBuilder.get('memory-context')!,
      this.systemPromptBuilder.get('tool-guidance')!
    );

    // 2. 加载领域特定组件
    for (const domain of domains) {
      const capability = this.domainCapabilities.get(domain);
      if (!capability) continue;

      for (const componentId of capability.systemPromptComponents) {
        const component = this.systemPromptBuilder.get(componentId);
        if (component && !components.includes(component)) {
          components.push(component);
        }
      }
    }

    // 3. 按优先级排序
    return components.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 组装 Skills
   */
  private assembleSkills(intents: Intent[], domains: string[]): Skill[] {
    const skills: Skill[] = [];

    // 1. 根据意图精确匹配 Skill
    for (const intent of intents) {
      // 意图类型 → Skill ID 映射
      const skillId = this.intentTypeToSkillId(intent.type);
      if (skillId) {
        const skill = this.skillRegistry.get(skillId);
        if (skill) {
          skills.push(skill);
        }
      }
    }

    // 2. 加载领域相关的 Skills
    for (const domain of domains) {
      const capability = this.domainCapabilities.get(domain);
      if (!capability) continue;

      for (const skillId of capability.skills) {
        const skill = this.skillRegistry.get(skillId);
        if (skill && !skills.includes(skill)) {
          skills.push(skill);
        }
      }
    }

    return skills;
  }

  /**
   * 组装 Tools
   */
  private assembleTools(domains: string[]): Tool[] {
    const toolNames = new Set<string>();

    // 合并所有领域允许的工具
    for (const domain of domains) {
      const capability = this.domainCapabilities.get(domain);
      if (!capability) continue;

      capability.tools.forEach((t) => toolNames.add(t));
    }

    // 获取工具实例
    return Array.from(toolNames)
      .map((name) => this.toolRegistry.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  /**
   * 组装 Memory Scopes
   */
  private assembleMemoryScopes(domains: string[]): string[] {
    const scopes: string[] = ['global']; // 始终包含全局

    for (const domain of domains) {
      const capability = this.domainCapabilities.get(domain);
      if (capability && capability.memoryScope) {
        scopes.push(capability.memoryScope);
      }
    }

    return scopes;
  }

  /**
   * 选择 Model
   */
  private selectModel(intents: Intent[], domains: string[]): ModelConfig {
    const complexity = this.estimateComplexity(intents);

    // 默认配置
    let config: ModelConfig = {
      name: 'claude-sonnet-4.5',
      temperature: 0.2,
    };

    // 复杂任务用更强的模型
    if (complexity === 'complex') {
      config.name = 'claude-opus-4.5';
      config.thinking = { type: 'enabled', budget_tokens: 10000 };
    }

    // 简单任务用更快的模型
    if (complexity === 'simple' && domains.length === 1 && domains[0] === 'life') {
      config.name = 'claude-haiku-4.5';
      config.temperature = 0.7;
    }

    // 金融领域优先使用 Opus + Extended Thinking
    if (domains.includes('finance')) {
      config.name = 'claude-opus-4.5';
      config.temperature = 0.1;
      config.thinking = { type: 'enabled', budget_tokens: 10000 };
    }

    return config;
  }

  /**
   * 估算复杂度
   */
  private estimateComplexity(intents: Intent[]): 'simple' | 'medium' | 'complex' {
    if (intents.length === 0) return 'simple';
    if (intents.length === 1) return 'simple';
    if (intents.length === 2) return 'medium';
    return 'complex';
  }

  /**
   * 初始化领域能力配置
   */
  private initDomainCapabilities(): void {
    this.domainCapabilities = new Map([
      [
        'coding',
        {
          domain: 'coding',
          systemPromptComponents: ['coding-expertise', 'security-rules'],
          skills: ['git-commit', 'review-pr', 'format-code', 'run-tests'],
          tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
          memoryScope: 'coding',
          modelPreference: { temperature: 0.2 },
        },
      ],
      [
        'life',
        {
          domain: 'life',
          systemPromptComponents: ['life-assistant-identity'],
          skills: ['reminder-set', 'todo-add', 'calendar-add', 'note-create'],
          tools: ['Read', 'Write', 'Bash'],
          memoryScope: 'life',
          modelPreference: { name: 'claude-haiku-4.5', temperature: 0.7 },
        },
      ],
      [
        'finance',
        {
          domain: 'finance',
          systemPromptComponents: ['finance-advisor-identity', 'finance-disclaimer'],
          skills: ['expense-record', 'stock-query', 'portfolio-analyze', 'budget-report'],
          tools: ['Read', 'Write', 'Bash'],
          memoryScope: 'finance',
          modelPreference: { name: 'claude-opus-4.5', temperature: 0.1 },
        },
      ],
      [
        'learning',
        {
          domain: 'learning',
          systemPromptComponents: ['learning-partner-identity', 'learning-methodology'],
          skills: ['flashcard-create', 'knowledge-graph', 'study-plan', 'spaced-repetition'],
          tools: ['Read', 'Write'],
          memoryScope: 'learning',
          modelPreference: { temperature: 0.3 },
        },
      ],
      [
        'general',
        {
          domain: 'general',
          systemPromptComponents: [],
          skills: [],
          tools: ['Read', 'Write'],
          memoryScope: 'global',
        },
      ],
    ]);
  }

  /**
   * 意图类型 → Skill ID 映射
   */
  private intentTypeToSkillId(intentType: string): string | null {
    const mapping: Record<string, string> = {
      'schedule.reminder': 'reminder-set',
      'schedule.event': 'calendar-add',
      'coding.git-commit': 'git-commit',
      'coding.review-pr': 'review-pr',
      'finance.expense-record': 'expense-record',
      'finance.stock-query': 'stock-query',
      'learning.flashcard': 'flashcard-create',
    };

    return mapping[intentType] || null;
  }
}
```

### 3. AgentLoop 集成

```typescript
// src/core/agent/AgentLoop.ts

export class AgentLoop {
  private intentRouter: IntentRouter;
  private capabilityAssembler: CapabilityAssembler;

  constructor() {
    this.intentRouter = new IntentRouter();
    this.capabilityAssembler = new CapabilityAssembler();
  }

  /**
   * 运行（智能路由版本）
   */
  async run(userMessage: string): Promise<void> {
    // 1. 意图识别
    const intents = await this.intentRouter.route(userMessage);

    this.log.info(`识别到 ${intents.length} 个意图:`, intents.map((i) => i.type));

    // 2. 组装能力
    const plan = await this.capabilityAssembler.assemble(intents);

    this.log.info(`执行计划:`, {
      domains: plan.metadata.domains,
      skills: plan.activeSkills.map((s) => s.id),
      tools: plan.availableTools.map((t) => t.name),
    });

    // 3. 构建 System Prompt（动态组装）
    const systemPrompt = await this.buildSystemPrompt(plan.systemPromptComponents);

    // 4. 检查是否有可自动应用的 Skills
    const skillResults = await this.executeSkills(plan.activeSkills, {
      userInput: userMessage,
      intents,
    });

    // 如果 Skill 已完成任务，直接返回
    if (skillResults.some((r) => r.type === 'action' && r.success)) {
      return;
    }

    // 5. 调用 LLM（使用动态组装的配置）
    const response = await this.provider.chat({
      model: plan.modelConfig.name,
      temperature: plan.modelConfig.temperature,
      thinking: plan.modelConfig.thinking,
      messages: [
        { role: 'system', content: systemPrompt },
        ...this.messages,
        { role: 'user', content: userMessage },
      ],
      tools: this.convertToolsToSchema(plan.availableTools),
    });

    // 6. 处理响应...
  }

  /**
   * 执行 Skills
   */
  private async executeSkills(
    skills: Skill[],
    context: SkillContext
  ): Promise<SkillResult[]> {
    const results: SkillResult[] = [];

    for (const skill of skills) {
      // 检查是否可自动应用
      if (!skill.config?.autoApply) continue;

      // 检查触发条件
      if (skill.config?.triggers) {
        const matched = await this.checkTriggers(skill.config.triggers, context);
        if (!matched) continue;
      }

      // 执行 Skill
      const result = await skill.execute(context);
      results.push(result);

      // 如果 Action 模式且成功，输出结果
      if (result.type === 'action' && result.success) {
        this.emit('text', result.output!);
      }
    }

    return results;
  }
}
```

## 使用示例

### 示例 1: 纯编程任务

```bash
用户：提交今天的代码

意图识别：
  - coding.git-commit (confidence: 0.95)

能力组装：
  - Domains: [coding]
  - System Prompt: core + coding-expertise
  - Skills: [git-commit]
  - Tools: [Read, Write, Edit, Bash, Grep, Glob]
  - Model: claude-sonnet-4.5 (temp: 0.2)

执行：
  ✓ 自动调用 git-commit Skill
  ✓ 生成提交信息并提交
```

### 示例 2: 纯生活任务

```bash
用户：提醒我明天 9 点开会

意图识别：
  - schedule.reminder (confidence: 0.9)

能力组装：
  - Domains: [life]
  - System Prompt: core + life-assistant-identity
  - Skills: [reminder-set]
  - Tools: [Read, Write, Bash]
  - Model: claude-haiku-4.5 (temp: 0.7)

执行：
  ✓ 自动调用 reminder-set Skill
  ✓ 设置提醒
```

### 示例 3: 跨场景任务（重点！）

```bash
用户：提醒我明天 9 点开会，然后提交今天的代码

意图识别：
  - schedule.reminder (confidence: 0.9)
  - coding.git-commit (confidence: 0.95)

能力组装：
  - Domains: [life, coding]  ← 两个领域
  - System Prompt: core + life-assistant + coding-expertise
  - Skills: [reminder-set, git-commit]
  - Tools: [Read, Write, Edit, Bash, Grep, Glob]
  - Model: claude-sonnet-4.5 (medium complexity)

执行：
  ✓ 自动调用 reminder-set Skill → 设置提醒
  ✓ 自动调用 git-commit Skill → 提交代码
  ✓ 返回："已设置明天 9 点提醒。代码已提交。"
```

### 示例 4: 复杂金融分析

```bash
用户：分析一下我最近的支出情况，并推荐一只科技股

意图识别：
  - finance.expense-analyze (confidence: 0.85)
  - finance.stock-recommend (confidence: 0.8)

能力组装：
  - Domains: [finance]
  - System Prompt: core + finance-advisor + finance-disclaimer
  - Skills: [expense-analyze, stock-query, portfolio-analyze]
  - Tools: [Read, Write, Bash]
  - Model: claude-opus-4.5 (temp: 0.1, thinking: enabled)
    ↑ 金融领域自动使用最强模型 + Extended Thinking

执行：
  ✓ Extended Thinking 深度分析
  ✓ 调用 expense-analyze Skill
  ✓ 调用 stock-query Skill
  ✓ 给出专业建议（附风险提示）
```

## 对比：手动 vs 智能

| 维度 | 手动切换 Profile | 智能意图路由 |
|------|-----------------|-------------|
| 用户体验 | `/profile switch life` ❌ | 直接说需求 ✅ |
| 跨场景支持 | 需要多次切换 ❌ | 自动混合能力 ✅ |
| 学习成本 | 需要了解 Profile ❌ | 零学习成本 ✅ |
| Jarvis 感觉 | 像操作软件 ❌ | 像对话助手 ✅ |

## 核心优势

### 1. 用户无感知

✅ 不需要知道 Profile、领域、Skill
✅ 只需要说出需求
✅ 就像和 Jarvis 对话

### 2. 智能混合

✅ 一句话可以跨多个领域
✅ 自动组装所需能力
✅ 动态选择最佳模型

### 3. 性能优化

✅ 只加载需要的组件（不是全部）
✅ 简单任务用 Haiku（快）
✅ 复杂任务用 Opus + Thinking（准）

### 4. 可扩展

✅ 新增领域只需添加 DomainCapability
✅ 新增意图只需添加匹配规则
✅ 无需修改核心逻辑

## 实施计划

### Phase 1: IntentRouter（2天）

- [ ] 定义 Intent 接口
- [ ] 实现基于规则的匹配
- [ ] 实现基于向量的匹配
- [ ] 实现基于 LLM 的分类
- [ ] 单元测试

### Phase 2: CapabilityAssembler（2天）

- [ ] 定义 DomainCapability
- [ ] 实现能力组装逻辑
- [ ] 配置 4-5 个领域
- [ ] 集成测试

### Phase 3: AgentLoop 集成（1天）

- [ ] 集成 IntentRouter
- [ ] 集成 CapabilityAssembler
- [ ] 动态 System Prompt 构建
- [ ] 端到端测试

### Phase 4: 优化和调优（1天）

- [ ] 意图识别准确率优化
- [ ] Model 选择策略优化
- [ ] 性能测试

### Phase 5: 文档和示例（0.5天）

- [ ] 用户手册
- [ ] 开发者指南
- [ ] 最佳实践

**总计：6.5天**

## 总结

### 设计范式转变

**之前**：用户操作"软件"
```
用户 → 切换模式 → 输入命令 → 获得结果
```

**现在**：用户对话"助手"（Jarvis）
```
用户 → 说出需求 → 助手智能处理 → 获得结果
       ↑
   完全无感知
```

### 核心价值

1. ✅ **真正的 AI 助手体验**：像 Jarvis，不像软件
2. ✅ **智能自适应**：根据意图动态组装能力
3. ✅ **跨场景无缝**：一句话可以跨多个领域
4. ✅ **性能最优**：动态选择模型和配置

---

**设计完成时间**：2026-03-15
**设计者**：Claude（Anthropic）+ 用户协作
**项目**：Shibit Xuanji 璇玑
