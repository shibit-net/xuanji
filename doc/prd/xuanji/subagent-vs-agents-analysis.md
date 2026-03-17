# SubAgent vs AgentRegistry Agents 对比分析

**分析日期**：2026-03-15
**发现**：SubAgent 当前**没有使用** AgentRegistry 配置，存在优化空间

---

## 核心发现

### 🔍 重要观察

AgentRegistry 中的 4 个 Agent **本来就是为 SubAgent 设计的**：

```json5
// explore.json5, general-purpose.json5, coder.json5, plan.json5
{
  metadata: {
    builtin: true,
    isSubAgent: true,  // ← 标记为 SubAgent！
  }
}
```

但当前 SubAgent 实现**完全忽略了 AgentRegistry 的配置**！

---

## 对比分析

### 1. AgentRegistry 中的 Agents（配置化 Agent）

| Agent ID | 名称 | 用途 | 模型 | 工具权限 |
|----------|------|------|------|---------|
| **intent-analyzer** | 意图分析器 | 系统内部：意图分类 | Haiku | 无工具（内部 Agent） |
| **context-compressor** | 上下文压缩器 | 系统内部：上下文压缩 | Haiku | 无工具（内部 Agent） |
| **explore** | 探索助手 | **SubAgent**：快速探索 | Haiku | 只读（Glob/Grep/Read） |
| **general-purpose** | 通用助手 | **SubAgent**：通用任务 | Sonnet | 读写（所有工具） |
| **plan** | 架构师 | **SubAgent**：架构设计 | Opus | 只读（规划专用） |
| **coder** | 编程助手 | **SubAgent**：代码编写 | Opus | 读写（编程专用） |
| **xuanji** | 主 Agent | 主 Agent | Sonnet | 所有工具 |

**关键配置**（以 explore 为例）：

```json5
{
  id: 'explore',
  name: '探索助手',

  model: {
    primary: '[CC]claude-haiku-4-5-20251001',
    maxTokens: 16000,
  },

  systemPrompt: "You are a fast exploration agent...",

  tools: [
    { name: 'read_file', required: true },
    { name: 'glob', required: true },
    { name: 'grep', required: true },
  ],

  execution: {
    maxIterations: 20,
    timeout: 120000,  // 2 minutes
  },

  permissions: {
    fileWrite: 'deny',
    bashExec: 'deny',
  },

  metadata: {
    isSubAgent: true,
    useLightModel: true,
  }
}
```

---

### 2. SubAgent（当前实现）

**文件**：`src/core/agent/SubAgentContext.ts`

```typescript
export type AgentRoleType = 'general-purpose' | 'explore' | 'plan' | 'coder';

class SubAgentContext {
  constructor(options: SubAgentOptions) {
    this.role = options.role ?? 'general-purpose';
    this.useLightModel = options.useLightModel ?? this.inferUseLightModel(this.role);
    // ...
  }

  // ❌ 问题：基于父 Agent 配置构建，忽略 AgentRegistry
  buildAgentConfig(parentConfig: AgentConfig): AgentConfig {
    let systemPrompt = parentConfig.systemPrompt ?? '';

    // ❌ 硬编码 role prompt
    const roleSuffix = this.getRolePromptSuffix();
    systemPrompt += subAgentHeader + roleSuffix;

    return {
      ...parentConfig,  // ❌ 继承父配置
      systemPrompt,
      maxIterations: this.maxIterations,
    };
  }

  // ❌ 硬编码的 role prompt
  private getRolePromptSuffix(): string {
    switch (this.role) {
      case 'explore':
        return 'You are a fast exploration agent...';  // ❌ 与 AgentRegistry 重复
      case 'plan':
        return 'You are a software architect...';
      // ...
    }
  }
}
```

**问题**：
- ❌ 硬编码 systemPrompt（与 AgentRegistry 重复）
- ❌ 继承父 Agent 配置（不符合 SubAgent 专业化需求）
- ❌ 工具过滤在 FilteredToolRegistry 中手动实现（应该用 AgentRegistry 的 tools 列表）
- ❌ 没有使用 AgentRegistry 的 permissions, timeout, maxIterations

---

## 触发场景对比

### AgentRegistry Agents 触发场景

#### 1. 系统内部 Agent（自动触发）

| Agent | 触发位置 | 触发条件 | 执行方式 |
|-------|---------|---------|---------|
| **intent-analyzer** | `IntentRouter` | 向量匹配未命中时 | `AgentExecutor.execute()` |
| **context-compressor** | `AgentLoop` | 上下文超过阈值时 | `AgentExecutor.execute()` |

```typescript
// IntentRouter.ts
if (this.agentRegistry) {
  const agentConfig = this.agentRegistry.get('intent-analyzer');
  const result = await AgentExecutor.execute(agentConfig, options);
}

// ContextCompressor.ts
if (this.agentRegistry) {
  const agentConfig = this.agentRegistry.get('context-compressor');
  const result = await AgentExecutor.execute(agentConfig, options);
}
```

#### 2. SubAgent 配置（应该使用但当前未使用）

| Agent | 对应 SubAgent Role | 当前状态 |
|-------|-------------------|---------|
| **explore** | `role: 'explore'` | ❌ 未使用配置 |
| **general-purpose** | `role: 'general-purpose'` | ❌ 未使用配置 |
| **plan** | `role: 'plan'` | ❌ 未使用配置 |
| **coder** | `role: 'coder'` | ❌ 未使用配置 |

---

### SubAgent 触发场景（用户主动）

#### 1. TaskTool（单个子任务）

```typescript
// 用户通过工具调用
{
  "name": "task",
  "input": {
    "description": "List all TypeScript files in src/",
    "subagent_type": "explore"  // ← 选择 role
  }
}
```

触发流程：
```
User → TaskTool → SubAgentContext(role='explore') → runSubAgent()
```

#### 2. TeamTool/QuickTeamTool（团队协作）

```typescript
{
  "name": "agent_team",
  "input": {
    "members": [
      { "id": "analyst", "role": "explore" },   // ← 每个成员选择 role
      { "id": "coder", "role": "coder" }
    ]
  }
}
```

触发流程：
```
User → TeamTool → TeamManager → runSubAgent(role='explore') × N
```

#### 3. ChainTool（链式执行）

```typescript
{
  "name": "agent_chain",
  "input": {
    "chain": [
      { "agent_id": "explore", ... },  // ← agent_id 对应 role
      { "agent_id": "coder", ... }
    ]
  }
}
```

---

## 核心区别总结

| 维度 | AgentRegistry Agents | SubAgent（当前） |
|------|---------------------|-----------------|
| **定义方式** | 静态配置（JSON5） | 动态创建（代码） |
| **配置来源** | `builtin/*.json5` | `SubAgentContext.buildAgentConfig()` |
| **SystemPrompt** | 完整专业 prompt | 硬编码简单 prompt |
| **工具列表** | 明确列表（探索=只读） | 全量 + 手动过滤 |
| **Permissions** | 精细权限控制 | 简单过滤 |
| **Model** | 配置文件指定 | 运行时选择（provider 参数） |
| **触发方式** | 系统自动 / 未使用 | 用户通过工具调用 |
| **使用场景** | 内部功能 + SubAgent | 子任务执行 |

---

## 问题分析

### 当前问题

1. **配置重复**
   - AgentRegistry 有完整的 SubAgent 配置（explore, plan, coder, general-purpose）
   - SubAgentContext 硬编码了相同的 role prompt
   - **两份配置，没有统一管理**

2. **配置不一致**
   - AgentRegistry: `explore` 限制 20 次迭代，2 分钟超时
   - SubAgent: 默认 30 次迭代，5 分钟超时
   - **无法保证行为一致**

3. **无法独立优化**
   - 想调整 explore 的 systemPrompt → 需要改 `SubAgentContext.getRolePromptSuffix()`
   - 想调整 explore 的工具权限 → 需要改 `SubAgentContext` 构造函数
   - **配置分散，难以维护**

4. **运行时模型选择能力被忽略**
   - AgentRegistry 配置了固定 model（explore=Haiku, coder=Opus）
   - 但 SubAgent 的**优势**是运行时选择（根据 useLightModel）
   - **如何平衡？**

---

## 优化方案

### 方案 1：SubAgent 使用 AgentRegistry 配置 ✅ 推荐

**核心思路**：SubAgent 从 AgentRegistry 获取配置，但保留运行时模型选择

```typescript
// SubAgentLoop.ts
export async function runSubAgent(
  mainProvider: ILLMProvider,
  lightProvider: ILLMProvider,
  registry: IToolRegistry,
  parentConfig: AgentConfig,
  context: SubAgentContext,
  hookRegistry?: HookRegistry | null,
  memoryStore?: IMemoryStore | null,
  agentRegistry?: AgentRegistry | null,  // ← 新增参数
): Promise<SubAgentResult> {

  // 1. 尝试从 AgentRegistry 获取 SubAgent 配置
  let agentConfig = parentConfig;
  if (agentRegistry) {
    const profile = agentRegistry.get(context.role);  // 'explore', 'coder', etc.
    if (profile && profile.metadata?.isSubAgent) {
      // 使用 AgentRegistry 的配置（systemPrompt, tools, permissions, timeout 等）
      agentConfig = {
        systemPrompt: profile.systemPrompt,
        maxIterations: profile.execution.maxIterations,
        // ❌ 不使用 profile.model（保留运行时选择）
      };
    }
  }

  // 2. 运行时选择 provider（保留原有逻辑）
  const provider = context.useLightModel ? lightProvider : mainProvider;

  // 3. 创建过滤后的工具注册表
  let filteredRegistry = registry;
  if (agentConfig.tools) {
    // 使用 AgentRegistry 的工具列表（而不是全量过滤）
    filteredRegistry = new ToolRegistrySubset(registry, agentConfig.tools);
  } else {
    // 降级到原有逻辑
    filteredRegistry = new FilteredToolRegistry(registry, context.restrictedTools);
  }

  // 4. 创建子代理 AgentLoop
  const agentLoop = new AgentLoop(
    provider,  // ← 运行时选择的 provider
    filteredRegistry,
    agentConfig,
    memoryStore,
  );

  // ...
}
```

**优势**：
- ✅ 统一配置管理（所有 SubAgent 配置在 `builtin/*.json5`）
- ✅ 精确控制（工具列表、权限、超时、迭代次数）
- ✅ 保留运行时模型选择能力（mainProvider vs lightProvider）
- ✅ 易于维护（修改 JSON5 即可，无需改代码）

**兼容性**：
- ✅ 向后兼容：如果 AgentRegistry 未传入或没有对应配置，降级到原有逻辑
- ✅ 渐进式迁移：可以逐个 Agent 迁移

---

### 方案 2：移除硬编码，强制使用 AgentRegistry

**核心思路**：SubAgent 必须从 AgentRegistry 获取配置

```typescript
// SubAgentContext.ts
class SubAgentContext {
  // ❌ 删除 getRolePromptSuffix()
  // ❌ 删除 buildAgentConfig()

  // 只保留 depth, timeout, restrictedTools 等运行时参数
}

// SubAgentLoop.ts
export async function runSubAgent(...) {
  if (!agentRegistry) {
    throw new Error('AgentRegistry is required for SubAgent');
  }

  const profile = agentRegistry.get(context.role);
  if (!profile || !profile.metadata?.isSubAgent) {
    throw new Error(`Invalid SubAgent role: ${context.role}`);
  }

  // 强制使用 AgentRegistry 配置
  const agentConfig = {
    systemPrompt: profile.systemPrompt,
    maxIterations: profile.execution.maxIterations,
    // ...
  };

  // ...
}
```

**优势**：
- ✅ 强制配置化，无硬编码
- ✅ 所有 SubAgent 配置在一处管理

**劣势**：
- ❌ 破坏向后兼容性（必须传入 AgentRegistry）
- ❌ 可能影响现有代码

---

## 推荐实施方案

### Phase 1：添加 AgentRegistry 支持（向后兼容）✅

**目标**：SubAgent 可选使用 AgentRegistry 配置

**步骤**：

1. **修改 runSubAgent() 签名**
   ```typescript
   export async function runSubAgent(
     // ...
     agentRegistry?: AgentRegistry | null,  // ← 新增可选参数
   ): Promise<SubAgentResult>
   ```

2. **优先使用 AgentRegistry 配置**
   ```typescript
   let agentConfig = parentConfig;
   if (agentRegistry) {
     const profile = agentRegistry.get(context.role);
     if (profile?.metadata?.isSubAgent) {
       agentConfig = this.buildConfigFromProfile(profile, context);
     }
   }
   // 降级到原有逻辑
   if (!agentConfig) {
     agentConfig = context.buildAgentConfig(parentConfig);
   }
   ```

3. **更新所有调用点**
   - TaskTool.setDependencies() 添加 agentRegistry 参数
   - TeamTool.setDependencies() 添加 agentRegistry 参数
   - ChainTool.setDependencies() 添加 agentRegistry 参数
   - Executor 构造函数添加 agentRegistry 参数

4. **更新 ChatSession 初始化**
   ```typescript
   // ChatSession.ts
   this.taskTool.setDependencies({
     provider: this.provider,
     lightProvider: this.lightProvider,
     registry: this.toolRegistry,
     agentConfig: this.config,
     agentRegistry: this.agentRegistry,  // ← 传递 AgentRegistry
   });
   ```

---

### Phase 2：完善 Agent 配置（可选）

**目标**：确保所有 SubAgent 配置完整

**步骤**：

1. 审查 `explore.json5`, `general-purpose.json5`, `plan.json5`, `coder.json5`
2. 确保 systemPrompt 完整（已经很完善）
3. 确保 tools 列表准确
4. 确保 permissions 正确
5. 确保 execution 参数合理

---

### Phase 3：移除硬编码（长期）

**目标**：删除 `SubAgentContext.getRolePromptSuffix()` 和 `buildAgentConfig()`

**条件**：
- 所有调用点都传入 agentRegistry
- 所有 SubAgent 配置完整
- 测试覆盖充分

---

## 总结

### 当前状态

| 组件 | 状态 | 问题 |
|------|------|------|
| **AgentRegistry Agents** | ✅ 配置完整 | 未被 SubAgent 使用 |
| **SubAgent** | ❌ 硬编码配置 | 与 AgentRegistry 重复 |
| **集成** | ❌ 未集成 | 配置分散，难以维护 |

### 优化方向

✅ **Phase 1（推荐）**：SubAgent 使用 AgentRegistry 配置
- 统一配置管理
- 保留运行时模型选择
- 向后兼容

🔲 **Phase 2（可选）**：完善 Agent 配置

🔲 **Phase 3（长期）**：移除硬编码

### 核心价值

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 配置管理 | 分散（代码+JSON） | 统一（JSON） | ⬆️⬆️⬆️ |
| 可维护性 | 低（硬编码） | 高（配置化） | ⬆️⬆️⬆️ |
| 配置一致性 | 无保证 | 强保证 | ⬆️⬆️⬆️ |
| 灵活性 | 中 | 高 | ⬆️⬆️ |

---

**分析完成日期**：2026-03-15
**下一步**：实施 Phase 1 优化
