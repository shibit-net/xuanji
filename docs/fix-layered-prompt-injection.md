# 动态 Prompt 未使用问题修复

## 问题描述

从日志来看，`LayeredPromptBuilder` 虽然被创建和初始化了，但子 agent 在执行时并没有使用动态 prompt，而是使用了配置文件中的静态 `systemPrompt`。

## 根本原因

**问题**：`SessionFactory` 创建了 `LayeredPromptBuilder`，但没有将其注入到 `SubAgentFactory` 中。

**调用链**：
```
SessionFactory.createMainAgent()
  ↓
创建 LayeredPromptBuilder
  ↓
创建 TeamManager
  ↓
TeamManager 内部创建 SubAgentFactory
  ↓
❌ SubAgentFactory.promptBuilder = null  // 未注入！
  ↓
子 agent 创建时
  ↓
SubAgentFactory.createSubAgent()
  ↓
if (this.promptBuilder && ...) {  // ❌ 条件不满足
  // 使用 LayeredPromptBuilder
} else {
  // 降级：使用配置文件中的 systemPrompt
}
```

## 修复方案

### 1. 修改 `TeamManager.ts`

将 `subAgentFactory` 从 `private` 改为 `public`，允许外部注入 `promptBuilder`：

```typescript
// src/core/agent/team/TeamManager.ts

export class TeamManager implements ITeamManager {
  // ...
  public subAgentFactory: SubAgentFactory;  // 🆕 改为 public
  // ...
}
```

### 2. 修改 `SessionFactory.ts`

在创建 `TeamManager` 后，注入 `LayeredPromptBuilder`：

```typescript
// src/core/chat/SessionFactory.ts

// 8. 创建 TeamManager
const teamManager = new TeamManager(
  provider,
  registry,
  agentConfig,
  hookRegistry,
  memoryManager,
  0,
  agentRegistry,
  providerManager
);

// 🆕 注入 LayeredPromptBuilder 到 TeamManager 的 SubAgentFactory
if (teamManager.subAgentFactory) {
  teamManager.subAgentFactory.setPromptBuilder(promptBuilder);
  log.debug('LayeredPromptBuilder injected into SubAgentFactory');
}
```

## 验证方法

### 1. 检查日志

修复后，子 agent 创建时应该看到：

```
[SessionFactory] LayeredPromptBuilder initialized
[SessionFactory] LayeredPromptBuilder injected into SubAgentFactory
[SubAgentFactory] Prompt built via LayeredPromptBuilder: l0-identity, l1-coding-scenes
```

### 2. 检查 System Prompt

子 agent 的 system prompt 应该包含：
- L0 层：身份和安全底线
- L1 层：场景专用 prompt（如 `write_code`、`debug` 等）

而不是配置文件中的静态 prompt。

### 3. 测试场景切换

不同场景应该使用不同的 prompt：

```typescript
// 场景 1: write_code
const result1 = await mainAgent.execute("写一个登录接口");
// 应该使用 write_code 场景的 prompt（严谨、低温度）

// 场景 2: debug
const result2 = await mainAgent.execute("修复这个 bug");
// 应该使用 debug 场景的 prompt（细致、步骤清晰）
```

## 影响范围

### 修复前

- ❌ 所有子 agent 使用配置文件中的静态 `systemPrompt`
- ❌ 场景切换不生效
- ❌ `LayeredPromptBuilder` 被创建但未使用

### 修复后

- ✅ 子 agent 使用动态 prompt（L0 + L1）
- ✅ 场景切换生效（`write_code` / `debug` / `review` 等）
- ✅ `LayeredPromptBuilder` 正常工作

## 相关代码

### SubAgentFactory.createSubAgent()

```typescript
// src/core/agent/SubAgentFactory.ts

async createSubAgent(agentIdOrRole: string, options: SubAgentFactoryOptions) {
  // ...

  // 5. 构建完整的 System Prompt
  let systemPrompt: string;

  if (this.promptBuilder && !isInternalAgent && !options.systemPrompt) {
    // ✅ 使用 LayeredPromptBuilder 构建统一 prompt
    try {
      const buildResult = await this.promptBuilder.buildForSubAgent({
        agentId: agentConfig.id,
        agentName: agentConfig.name,
        role: agentIdOrRole,
        task: options.task,
      });
      systemPrompt = buildResult.prompt;
      log.debug(`Prompt built via LayeredPromptBuilder: ${buildResult.components.join(', ')}`);
    } catch (err) {
      log.warn(`Failed to build prompt via LayeredPromptBuilder, falling back:`, err);
      systemPrompt = this.buildSystemPrompt(agentConfig, options);
    }
  } else {
    // ❌ 降级：使用配置文件中的 systemPrompt
    systemPrompt = this.buildSystemPrompt(agentConfig, options);
  }

  // ...
}
```

### LayeredPromptBuilder.buildForSubAgent()

```typescript
// src/core/prompt/LayeredPromptBuilder.ts

async buildForSubAgent(context: SubAgentContext): Promise<PromptBuildResult> {
  // 为子 agent 构建 prompt
  // - L0: 身份和安全底线
  // - L1: 场景专用 prompt（根据 context.role 或 context.task 推断）
  
  return {
    prompt: '...',
    components: ['l0-identity', 'l1-coding-scenes'],
    scene: 'write_code',
    complexity: 'standard',
    requiredTools: [],
    estimatedTokens: 500,
  };
}
```

## 测试建议

### 单元测试

```typescript
describe('SessionFactory - LayeredPromptBuilder 注入', () => {
  test('应该将 promptBuilder 注入到 SubAgentFactory', async () => {
    const factory = new SessionFactory();
    const session = await factory.create({ userId: 'test' });
    
    // 验证：TeamManager 的 subAgentFactory 有 promptBuilder
    const teamManager = (session as any).mainAgent.teamManager;
    expect(teamManager.subAgentFactory.promptBuilder).toBeDefined();
  });
});
```

### 集成测试

```typescript
describe('动态 Prompt 集成测试', () => {
  test('子 agent 应该使用动态 prompt', async () => {
    const session = await createSession();
    
    // 执行任务
    const result = await session.send("写一个登录接口");
    
    // 验证：子 agent 使用了 write_code 场景的 prompt
    // （通过日志或 mock 验证）
  });
});
```

## 总结

**问题**：`LayeredPromptBuilder` 未被注入到 `SubAgentFactory`

**修复**：
1. 将 `TeamManager.subAgentFactory` 改为 `public`
2. 在 `SessionFactory` 中注入 `promptBuilder`

**效果**：
- ✅ 子 agent 使用动态 prompt
- ✅ 场景切换生效
- ✅ 符合 Xuanji 架构设计

**修改文件**：
- `src/core/agent/team/TeamManager.ts` - 1 行
- `src/core/chat/SessionFactory.ts` - 6 行

**风险**：低（只是注入依赖，不改变逻辑）
