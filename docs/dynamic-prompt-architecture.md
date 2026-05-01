# 动态 Prompt 架构设计

## 正确的理解

你说得对！子 agent 使用什么 prompt **应该是动态决策的**，而不是在 `SubAgentFactory` 中固定构建。

## 架构设计

### 职责分离

```
MainAgent（调度层）
  ↓
  职责：根据场景动态构建 prompt
  ↓
PromptStore.getSceneEnhancement(scene)
  ↓
  使用 LayeredPromptBuilder 构建完整 prompt
  ↓
TeamManager（执行层）
  ↓
  职责：使用 MainAgent 提供的 prompt 创建子 agent
  ↓
SubAgentFactory（工厂层）
  ↓
  职责：使用提供的 prompt 创建 agent 实例
```

### 数据流

```
用户输入: "写一个登录接口"
  ↓
MainAgent.execute()
  ↓
1. IntentRouter: 识别意图
2. IntentAnalyzer: 分析场景 → scene = 'write_code'
3. TaskPlanner: 规划任务 → agentId = 'coder', scene = 'write_code'
  ↓
4. PromptStore.getSceneEnhancement('write_code', { userInput: '...' })
   ↓
   LayeredPromptBuilder.build({ scene: 'write_code', ... })
   ↓
   返回完整 prompt（L0 + L1）:
   """
   # L0: 身份和安全底线
   你是 Xuanji，专业的 AI 编程助手...
   
   # L1: write_code 场景
   你是专业编程工程师，严谨、简洁，输出代码可直接运行...
   """
  ↓
5. TeamManager.createTeam({
     members: [{
       agentId: 'coder',
       systemPrompt: '完整的 L0 + L1 prompt'  // ← 动态构建的 prompt
     }]
   })
  ↓
6. SubAgentFactory.createSubAgent('coder', {
     systemPrompt: '完整的 L0 + L1 prompt'  // ← 直接使用
   })
   ↓
   检查: options.systemPrompt 存在
   ↓
   跳过 LayeredPromptBuilder（因为 MainAgent 已经构建了）
   ↓
   直接使用 options.systemPrompt
```

## 关键代码

### 1. MainAgent - 动态决策

```typescript
// src/core/agent/dispatch/MainAgent.ts

private async executeSingleTask(plan: TaskPlan, signal?: AbortSignal) {
  const task = plan.tasks[0];

  // 🎯 根据场景动态构建 prompt
  const sceneEnhancement = await this.promptStore.getSceneEnhancement(task.scene, {
    userInput: plan.goal,
  });

  // 传递给 TeamManager
  const teamConfig: TeamConfig = {
    members: [{
      agentId: task.agentId,
      systemPrompt: sceneEnhancement,  // 完整的 L0 + L1 prompt
    }],
  };

  await this.teamManager.createTeam(teamConfig);
  return this.teamManager.execute(plan.goal, signal);
}
```

### 2. PromptStore - 使用 LayeredPromptBuilder

```typescript
// src/core/agent/dispatch/PromptStore.ts

async getSceneEnhancement(scene: SceneType, context?: PromptContext): Promise<string> {
  try {
    // 🎯 使用 LayeredPromptBuilder 构建完整 prompt
    const buildResult = await this.promptBuilder.build({
      scene,                          // 场景类型
      complexity: 'standard',
      userMessage: context?.userInput,
      language: 'zh-CN',
    });

    log.debug(`Scene prompt built: scene=${scene}, components=[${buildResult.components.join(', ')}]`);
    return buildResult.prompt;  // 返回 L0 + L1
  } catch (error) {
    // 降级处理
    return this.getDefaultPrompt();
  }
}
```

### 3. SubAgentFactory - 直接使用

```typescript
// src/core/agent/SubAgentFactory.ts

async createSubAgent(agentIdOrRole: string, options: SubAgentFactoryOptions) {
  // ...

  let systemPrompt: string;

  if (this.promptBuilder && !isInternalAgent && !options.systemPrompt) {
    // 情况 1: 没有提供 systemPrompt，使用 LayeredPromptBuilder 构建
    const buildResult = await this.promptBuilder.buildForSubAgent({...});
    systemPrompt = buildResult.prompt;
  } else {
    // 情况 2: 已提供 systemPrompt（MainAgent 构建的），直接使用
    const baseSystemPrompt = options.systemPrompt ?? agentConfig.systemPrompt ?? '';
    systemPrompt = this.buildSystemPrompt(
      { ...agentConfig, systemPrompt: baseSystemPrompt },
      options,
    );
  }

  // ...
}
```

## 两种使用模式

### 模式 1: MainAgent 调度（推荐）

**特点**：
- MainAgent 根据场景动态构建 prompt
- 支持场景切换（write_code / debug / review 等）
- 使用 LayeredPromptBuilder（L0 + L1）

**流程**：
```
MainAgent
  → PromptStore.getSceneEnhancement(scene)
    → LayeredPromptBuilder.build({ scene })
      → 返回 L0 + L1 prompt
  → TeamManager.createTeam({ systemPrompt: '...' })
    → SubAgentFactory.createSubAgent({ systemPrompt: '...' })
      → 直接使用提供的 prompt
```

### 模式 2: 直接调用 SubAgentFactory（兼容）

**特点**：
- 直接调用 SubAgentFactory，不经过 MainAgent
- 没有场景分析和动态 prompt
- 使用 agent 配置文件中的静态 prompt

**流程**：
```
SubAgentFactory.createSubAgent('coder', { task: '...' })
  → 检查: options.systemPrompt 不存在
  → 使用 LayeredPromptBuilder.buildForSubAgent()
    → 返回基础 prompt（L0 + agent 配置中的 prompt）
```

## 场景切换示例

### 场景 1: write_code

```
用户: "写一个登录接口"
  ↓
IntentAnalyzer: scene = 'write_code'
  ↓
PromptStore.getSceneEnhancement('write_code')
  ↓
LayeredPromptBuilder.build({ scene: 'write_code' })
  ↓
返回 prompt:
"""
# L0: 身份
你是 Xuanji，专业的 AI 编程助手...

# L1: write_code 场景
你是专业编程工程师，严谨、简洁，输出代码可直接运行。

核心原则：
- 代码质量：可直接运行，无语法错误
- 简洁明了：附带1-2句核心解释
- 最佳实践：遵循语言规范和设计模式
"""
```

### 场景 2: debug

```
用户: "修复这个 bug"
  ↓
IntentAnalyzer: scene = 'debug'
  ↓
PromptStore.getSceneEnhancement('debug')
  ↓
LayeredPromptBuilder.build({ scene: 'debug' })
  ↓
返回 prompt:
"""
# L0: 身份
你是 Xuanji，专业的 AI 编程助手...

# L1: debug 场景
你是资深调试工程师，耐心、细致，步骤清晰。

核心原则：
- 先分析：理解报错信息，定位问题根源
- 再修复：给出具体修改方案，步骤清晰
- 验证：说明如何验证修复是否成功
"""
```

## 总结

**正确的架构**：
- ✅ MainAgent 负责动态决策（根据场景选择 prompt）
- ✅ PromptStore 负责构建 prompt（使用 LayeredPromptBuilder）
- ✅ SubAgentFactory 负责创建实例（使用提供的 prompt）

**职责分离**：
- MainAgent：调度层，决策"用什么 prompt"
- PromptStore：服务层，构建"完整的 prompt"
- SubAgentFactory：工厂层，创建"agent 实例"

**动态性**：
- 场景识别：IntentAnalyzer 动态分析
- Prompt 构建：LayeredPromptBuilder 动态组装
- Agent 创建：SubAgentFactory 使用动态 prompt

**之前的误解**：
- ❌ 以为需要在 SubAgentFactory 中注入 promptBuilder
- ❌ 以为 SubAgentFactory 应该负责构建动态 prompt
- ✅ 实际上 MainAgent 已经通过 PromptStore 构建了动态 prompt
- ✅ SubAgentFactory 只需要使用提供的 prompt 即可

**修复内容**：
- ✅ `PromptStore.getSceneEnhancement()` 使用 `LayeredPromptBuilder.build()`
- ✅ `MainAgent` 传递 `userInput` 到 `getSceneEnhancement()`
- ✅ 保持 `SubAgentFactory` 的原有逻辑（直接使用提供的 prompt）
