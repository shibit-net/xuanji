# SubAgent Provider 继承机制修复

## 问题描述

在 agent_team 工具执行时，SubAgent 创建过程中出现 **apiKey 缺失**错误：

```
Error: Anthropic API key is required
```

### 根本原因

**SubAgentFactory** 在创建子 Agent 时，**总是**通过 `ProviderManager.getProvider()` 创建新 Provider。当 Agent 没有独立配置时，ProviderManager 会回退到全局配置读取 `apiKey`，但在测试环境中全局配置的 apiKey 为空。

### 问题代码（修复前）

```typescript
// src/core/agent/SubAgentFactory.ts:200-208
const provider = this.providerManager.getProvider({
  id: agentConfig.id,
  model: agentConfig.model,
  provider: {
    model: agentConfig.model.primary,
    // ❌ 如果 Agent 没有独立的 apiKey，ProviderManager 会回退到全局配置
  },
} as any);
```

---

## 设计原则

### 正确的 Provider 继承策略

**1. 预置 Agent（有独立配置）**  
→ 使用 ProviderManager 创建独立的 Provider  
→ 配置来源：`.xuanji/agents/*.json5` 中的 `provider` 字段

**2. 临时 Agent（无独立配置）**  
→ 复用父 Agent 的 Provider  
→ 由主 LLM 动态生成 System Prompt  

**3. 回退机制**  
→ 如果没有独立配置且没有父 Provider  
→ 回退到全局配置（可能失败，需要用户配置 apiKey）

---

## 修复方案

### 1. SubAgentFactory 构造函数添加父 Provider 参数

```typescript
// src/core/agent/SubAgentFactory.ts:135-145
export class SubAgentFactory {
  constructor(
    private agentRegistry: AgentRegistry,
    private providerManager: ProviderManager,
    private baseRegistry: IToolRegistry,
    private hookRegistry?: HookRegistry | null,
    private memoryStore?: IMemoryStore | null,
    private parentProvider?: ILLMProvider | null,  // 👈 新增
  ) {
    // ...
  }
}
```

### 2. createSubAgent 中添加智能选择逻辑

```typescript
// src/core/agent/SubAgentFactory.ts:200-232
// 3. 创建 Provider（智能选择）
let provider: ILLMProvider;
const hasIndependentProvider = !!(agentConfig as any).provider?.apiKey
  || !!(agentConfig as any).provider?.baseURL
  || !!(agentConfig as any).provider?.adapter;

if (hasIndependentProvider) {
  // 预置 Agent：有独立配置
  provider = this.providerManager.getProvider({
    id: agentConfig.id,
    model: agentConfig.model,
    provider: (agentConfig as any).provider,
  } as any);
} else if (this.parentProvider) {
  // 临时 Agent：复用父 Provider  👈 核心修复
  provider = this.parentProvider;
} else {
  // 回退：通过 ProviderManager 创建（依赖全局配置）
  provider = this.providerManager.getProvider({
    id: agentConfig.id,
    model: agentConfig.model,
    provider: { model: agentConfig.model.primary },
  } as any);
}
```

### 3. 更新所有调用点，传递父 Provider

**TeamManager**
```typescript
// src/core/agent/team/TeamManager.ts:72-80
this.subAgentFactory = new SubAgentFactory(
  agentRegistry,
  providerManager,
  registry,
  hookRegistry,
  memoryStore,
  mainProvider,  // 👈 传递父 Provider
);
```

**TaskTool**
```typescript
// src/core/tools/TaskTool.ts:138-145
this.subAgentFactory = new SubAgentFactory(
  this.agentRegistry,
  this.providerManager,
  this.registry,
  this.hookRegistry,
  this.memoryStore,
  this.mainProvider,  // 👈 传递父 Provider
);
```

**ChatSession**
```typescript
// src/core/chat/ChatSession.ts:230-237
this.subAgentFactory = new SubAgentFactory(
  this.agentRegistry,
  this.providerManager,
  this.baseRegistry!,
  this.hookRegistry,
  this.memoryManager,
  this.mainProvider,  // 👈 传递父 Provider
);
```

---

## 测试验证

### 1. 原有集成测试（agent_team）

```bash
npm test -- test/integration/agent-team-tool-execution.test.ts
```

**结果**：✅ 所有 5 个测试通过
- Sequential Team
- Parallel Team  
- Hierarchical Team
- Debate Team
- Pipeline Team

### 2. 新增专项测试（Provider 继承）

```bash
npm test -- test/integration/subagent-provider-inheritance.test.ts
```

**结果**：✅ 所有 2 个测试通过
- 临时 Agent 应该复用父 Provider
- 无父 Provider 时应该使用 Mock Provider（测试环境）

---

## 影响范围

### 修改文件

- ✅ `src/core/agent/SubAgentFactory.ts` — 核心修复
- ✅ `src/core/agent/team/TeamManager.ts` — 传递父 Provider
- ✅ `src/core/tools/TaskTool.ts` — 传递父 Provider
- ✅ `src/core/chat/ChatSession.ts` — 传递父 Provider
- ✅ `test/integration/subagent-provider-inheritance.test.ts` — 新增测试

### 向后兼容性

✅ **完全兼容**  
- 原有代码调用 `new SubAgentFactory(...)` 时，`parentProvider` 为可选参数（默认 `null`）
- 回退到原有逻辑（依赖全局配置）

---

## 最佳实践

### 预置 Agent 配置示例

```json5
// .xuanji/agents/custom-researcher.json5
{
  id: 'custom-researcher',
  name: 'Custom Researcher',
  provider: {
    apiKey: 'sk-custom-key',       // 独立 API Key
    baseURL: 'https://custom.api', // 独立 Base URL
    adapter: 'openai',              // 独立 Adapter
    model: 'gpt-4',
  },
  tools: ['web_search', 'read_file'],
  systemPrompt: 'You are a research specialist.',
}
```

### 临时 Agent 使用

```typescript
// 无需配置 provider，自动复用父 Provider
const result = await agentTeam({
  team_name: 'Research Team',
  goal: 'Gather information',
  strategy: 'parallel',
  members: [
    {
      id: 'temp-researcher-1',
      role: 'general-purpose',  // builtin Agent，无独立配置
      capabilities: ['Research news'],
      // ✅ 自动复用父 Agent 的 Provider
    },
  ],
});
```

---

## 总结

✅ **修复完成**：SubAgent 现在能够正确继承父 Agent 的 Provider 配置  
✅ **测试通过**：所有集成测试（7 个）全部通过  
✅ **向后兼容**：不影响现有代码  
✅ **设计合理**：预置 Agent 独立配置 + 临时 Agent 继承父配置  

**核心价值**：  
- 🔥 解决了 agent_team 工具在测试环境中的 apiKey 缺失问题
- 🔥 建立了清晰的 Provider 继承机制
- 🔥 为多 Agent 协作场景提供了稳定的基础设施
