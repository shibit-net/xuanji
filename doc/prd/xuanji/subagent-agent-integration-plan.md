# SubAgent与Agent整合方案

**状态**: 设计中
**日期**: 2026-03-15
**目标**: 消除SubAgent与Agent的概念冗余，统一到AgentRegistry架构

---

## 问题分析

### 1. 配置重复

**AgentRegistry已有完整配置**（builtin/目录）：
- `explore.json5` - 快速探索型（Haiku，只读，2分钟）
- `plan.json5` - 架构规划型（Opus，只读，5分钟）
- `coder.json5` - 代码编写型（Opus，读写，10分钟）
- `general-purpose.json5` - 通用任务型（Sonnet，读写，5分钟）

每个配置包含：
```json5
{
  id: 'explore',
  systemPrompt: "You are a fast exploration agent...",
  tools: [{ name: 'read_file' }, { name: 'glob' }, ...],
  model: { primary: '[CC]claude-haiku-4-5-20251001' },
  permissions: { fileWrite: 'deny', bashExec: 'deny' },
  execution: { maxIterations: 20, timeout: 120000 },
  metadata: { isSubAgent: true }
}
```

**SubAgentContext硬编码相同内容**（SubAgentContext.ts L163-174）：
```typescript
private getRolePromptSuffix(): string {
  switch (this.role) {
    case 'explore':
      return 'You are a fast exploration agent. Quickly search codebases...';
    case 'plan':
      return 'You are a software architect. Design implementation plans...';
    case 'coder':
      return 'You are a coding agent. Write, edit, and test code...';
  }
}
```

**冲突**：
1. systemPrompt在两个地方维护
2. 工具过滤在两个地方（permissions.fileWrite=deny + SubAgentContext强制排除write_file）
3. 用户修改explore.json5不会影响SubAgentContext的硬编码逻辑

---

### 2. 概念混淆

**SubAgent不应该是独立的Agent类型**，而应该是：
- **Agent的一种执行模式**
- 带有特定执行约束的Agent实例

**类比**：
- Agent = 普通函数
- SubAgent = 带超时、深度限制、工具过滤的函数调用

---

## 设计方案

### 核心原则

**SubAgent只管理执行约束，不管理Agent身份**：

| 维度 | 由谁决定 | 存储位置 |
|------|---------|---------|
| **身份特征** | AgentRegistry | builtin/*.json5 |
| - systemPrompt | AgentRegistry | ✓ |
| - tools | AgentRegistry | ✓ |
| - model | AgentRegistry | ✓ |
| - permissions | AgentRegistry | ✓ |
| - capabilities | AgentRegistry | ✓ |
| **执行约束** | SubAgentContext | 运行时参数 |
| - depth | SubAgentContext | ✓ |
| - timeout | SubAgentContext | ✓（可被AgentConfig覆盖） |
| - concurrency | SubAgentContext | ✓ |
| - restrictedTools | SubAgentContext | ✓（仅递归风险工具） |
| - isolation | SubAgentContext | ✓ |
| - parentContext | SubAgentContext | ✓ |

---

### 架构调整

#### 1. SubAgentContext职责简化

**保留**：
```typescript
export class SubAgentContext {
  readonly task: string;
  readonly parentContext: string | undefined;
  readonly depth: number;
  readonly isolation: IsolationMode;
  readonly role: AgentRoleType;  // 用于AgentRegistry查询

  // 执行约束（默认值，可被AgentConfig覆盖）
  readonly timeout: number;
  readonly maxIterations: number;
  readonly restrictedTools: string[];  // 仅ALWAYS_RESTRICTED_TOOLS
}
```

**删除**：
```typescript
- getRolePromptSuffix()  // ❌ 不再硬编码
- buildAgentConfig()     // ❌ 改为SubAgentLoop直接使用AgentRegistry配置
- inferUseLightModel()   // ❌ 由AgentRegistry的model.primary决定
```

**修改**：
```typescript
// 原来：强制排除write_file/edit_file/bash
if (this.role === 'explore' || this.role === 'plan') {
  restricted.add('write_file');
  restricted.add('edit_file');
  restricted.add('bash');
}

// 修改为：完全由AgentRegistry的tools和permissions决定
// SubAgentContext只排除递归风险工具
export const ALWAYS_RESTRICTED_TOOLS = ['task'];
```

---

#### 2. SubAgentLoop使用AgentRegistry

**原来**（硬编码）：
```typescript
const agentConfig = context.buildAgentConfig(parentConfig);
// systemPrompt = parentPrompt + rolePromptSuffix + subAgentHeader

const provider = context.useLightModel ? lightProvider : mainProvider;
```

**修改后**（AgentRegistry）：
```typescript
// 1. 从AgentRegistry获取Agent配置
const agentProfile = agentRegistry.get(context.role);
if (!agentProfile) {
  throw new Error(`Agent "${context.role}" not found in registry`);
}

// 2. 使用AgentProfile的systemPrompt（不追加rolePromptSuffix）
const systemPrompt = [
  agentProfile.systemPrompt,
  `\n\n---\n[SubAgent Mode - Depth: ${context.depth}]`,
  context.parentContext ? `\n[Parent Context]\n${context.parentContext}` : '',
].join('\n');

const agentConfig: AgentConfig = {
  systemPrompt,
  maxIterations: agentProfile.execution.maxIterations,
  model: agentProfile.model.primary,
  maxTokens: agentProfile.model.maxTokens,
  // ... 其他字段从agentProfile复制
};

// 3. 使用ProviderManager获取Provider（基于AgentProfile配置）
const provider = providerManager.getProvider(agentProfile);

// 4. 创建FilteredToolRegistry（基于AgentProfile.tools）
const allowedTools = new Set(agentProfile.tools.map(t => t.name));
const filteredRegistry = new FilteredToolRegistry(
  registry,
  Array.from(registry.getAll().map(t => t.name))
    .filter(name => !allowedTools.has(name) || context.restrictedTools.includes(name))
);
```

---

#### 3. 工具过滤策略

**两层过滤**：

1. **AgentRegistry层**（Agent身份）：
   - explore.json5: `tools: ['read_file', 'glob', 'grep']` → 只读
   - explore.json5: `permissions: { fileWrite: 'deny', bashExec: 'deny' }` → 强制拒绝

2. **SubAgentContext层**（递归防护）：
   - `ALWAYS_RESTRICTED_TOOLS = ['task']` → 防止无限递归
   - 不再强制排除write_file/edit_file/bash

**FilteredToolRegistry合并两层**：
```typescript
const allowedTools = new Set(agentProfile.tools.map(t => t.name));
const restrictedTools = new Set(context.restrictedTools);  // 仅['task']

// 工具可用条件：在AgentProfile.tools中 AND 不在restrictedTools中
const filteredRegistry = new FilteredToolRegistry(
  registry,
  Array.from(registry.getAll().map(t => t.name))
    .filter(name => !allowedTools.has(name) || restrictedTools.has(name))
);
```

---

#### 4. Timeout和MaxIterations策略

**优先级**：AgentRegistry > SubAgentContext默认值

```typescript
// SubAgentContext提供默认值
export const DEFAULT_TIMEOUT = 300_000;
export const DEFAULT_MAX_ITERATIONS = 30;

// SubAgentLoop优先使用AgentRegistry配置
const agentConfig: AgentConfig = {
  maxIterations: agentProfile.execution.maxIterations,  // 优先
  // 如果AgentProfile没有配置，降级到SubAgentContext
};

const timeout = agentProfile.execution.timeout ?? context.timeout;
```

**Agent配置示例**：
- explore: `timeout: 120000` (2分钟) - 覆盖默认5分钟
- coder: `timeout: 600000` (10分钟) - 覆盖默认5分钟

---

## 实施步骤

### Phase 1: 简化SubAgentContext ✅

**任务**：
- [x] 删除`getRolePromptSuffix()`方法
- [x] 删除`buildAgentConfig()`方法
- [x] 删除`inferUseLightModel()`方法
- [x] 删除工具强制排除逻辑（explore/plan的write_file等）
- [x] 保留`ALWAYS_RESTRICTED_TOOLS = ['task']`

**影响**：
- `SubAgentContext.ts`
- `SubAgentLoop.ts`（需要适配）

---

### Phase 2: SubAgentLoop使用AgentRegistry ✅（已在进行中）

**任务**（与Phase 2 ProviderManager整合）：
- [x] 从AgentRegistry.get(role)获取AgentProfile
- [x] 使用AgentProfile.systemPrompt（不追加rolePromptSuffix）
- [x] 使用ProviderManager.getProvider(agentProfile)
- [x] 使用AgentProfile.tools创建FilteredToolRegistry
- [x] 使用AgentProfile.execution配置（maxIterations, timeout）

**文件**：
- `src/core/agent/SubAgentLoop.ts`

---

### Phase 3: 更新Agent配置 ✅

**任务**：
- [x] 检查explore/plan/coder/general-purpose.json5配置完整性
- [x] 确保metadata.isSubAgent正确标记
- [x] 确保所有SubAgent配置都有完整的systemPrompt

**文件**：
- `src/core/agent/builtin/explore.json5`
- `src/core/agent/builtin/plan.json5`
- `src/core/agent/builtin/coder.json5`
- `src/core/agent/builtin/general-purpose.json5`

---

### Phase 4: 测试与验证

**任务**：
- [ ] 单元测试：SubAgentContext简化
- [ ] 集成测试：SubAgentLoop使用AgentRegistry
- [ ] E2E测试：TaskTool创建SubAgent
- [ ] 验证工具过滤正确（explore只读，coder读写）
- [ ] 验证模型选择正确（explore=Haiku, plan/coder=Opus）
- [ ] 验证timeout正确（explore=2min, coder=10min）

---

## 预期效果

### 配置统一性

**优化前**：
```
SubAgent配置分散：
- SubAgentContext.getRolePromptSuffix() - 硬编码提示词
- SubAgentContext工具过滤 - 硬编码工具规则
- SubAgentContext.inferUseLightModel() - 硬编码模型选择
- explore.json5 - AgentRegistry配置
```

**优化后**：
```
SubAgent配置统一：
- explore.json5（AgentRegistry）- 所有配置的单一来源
- SubAgentContext - 仅执行约束（depth, timeout, recursion防护）
```

---

### 可维护性

**优化前**：
- 修改explore行为需要改两个地方（SubAgentContext + explore.json5）
- 配置不一致风险高
- 用户自定义Agent无法作为SubAgent使用

**优化后**：
- 修改explore行为只需修改explore.json5
- 配置单一来源，一致性保证
- 用户可以创建自定义SubAgent（只需metadata.isSubAgent=true）

---

### 扩展性

**新增SubAgent角色**：
```json5
// ~/.xuanji/agents/my-custom-subagent.json5
{
  id: 'my-agent',
  name: '我的助手',
  systemPrompt: "...",
  tools: [...],
  model: { primary: '...' },
  execution: { timeout: 180000 },
  metadata: { isSubAgent: true }  // 标记为SubAgent
}
```

**使用**：
```typescript
const context = new SubAgentContext({
  task: '执行任务',
  role: 'my-agent',  // AgentRegistry会查找my-agent配置
});

const result = await runSubAgent(providerManager, agentRegistry, ...);
```

---

## 兼容性

**向后兼容**：
- TaskTool.input_schema.subagent_type枚举不变
- SubAgentContext构造函数参数不变
- runSubAgent()函数签名已在Phase 2修改（添加agentRegistry参数）

**破坏性变更**：
- 删除SubAgentContext.buildAgentConfig() - 内部方法，无外部调用
- 删除SubAgentContext.getRolePromptSuffix() - 私有方法，无外部调用

---

## 总结

### 核心理念

**SubAgent ≠ 独立的Agent类型**
**SubAgent = 受限执行模式的Agent实例**

**类比**：
- Agent = 普通函数
- SubAgent = 带深度限制、超时、工具过滤的函数调用

### 职责划分

| 维度 | AgentRegistry | SubAgentContext |
|------|--------------|----------------|
| 身份特征 | ✓ | ✗ |
| 执行约束 | ✗ | ✓ |
| 配置存储 | JSON5文件 | 运行时参数 |

### 优势

1. **配置统一**：单一来源（AgentRegistry）
2. **概念清晰**：SubAgent只是执行模式，不是Agent类型
3. **可维护性**：修改Agent行为只需修改一个文件
4. **可扩展性**：用户可创建自定义SubAgent
5. **一致性**：AgentRegistry配置自动应用到SubAgent

---

**完成日期**: 待定
**负责人**: Kevin Shi
