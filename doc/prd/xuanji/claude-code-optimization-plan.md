# 借鉴 Claude Code 模型调用策略 — 优化方案

基于对 Claude Code 2026 最新实现的深度分析，提出 Xuanji 的优化方案。

---

## 📊 Claude Code vs Xuanji 对比

### 一、流式调用策略

| 维度 | Claude Code | Xuanji | 结论 |
|------|------------|--------|------|
| **调用方式** | 100% 流式 | 100% 流式 | ✅ 完全对等 |
| **技术要求** | max_tokens > 21K 强制流式 | 支持 65K max_tokens | ✅ 符合标准 |
| **流式节流** | 无（直接展示） | 500ms 节流 delta | ✅ Xuanji 优化更好 |
| **截断恢复** | 合成 tool_result 重试 | 合成 tool_result 重试 | ✅ 完全对等 |

**结论**：流式调用策略已完全对标，无需优化。

---

### 二、Extended Thinking 策略

| 维度 | Claude Code | Xuanji | 差距 |
|------|------------|--------|------|
| **Adaptive Thinking** | ✅ 支持（推荐方案） | ❌ 未实现 | **缺失** |
| **Budget Tokens** | ✅ 支持（精准控制） | ❌ 未实现 | **缺失** |
| **自动启用** | ✅ 根据任务类型 | ❌ 无策略 | **缺失** |

**Claude Code 启用策略**：

```typescript
const thinkingStrategies = {
  // 复杂编程任务
  'code-refactor': { type: 'adaptive', effort: 'high' },
  'architecture-design': { type: 'adaptive', effort: 'high' },

  // 标准编程任务
  'code-assistant': { type: 'adaptive', effort: 'medium' },
  'debugging': { type: 'adaptive', effort: 'medium' },

  // 轻量任务（不启用）
  'file-read': undefined,
  'compression': undefined,
  'summarization': undefined,
};
```

**Xuanji 改进方案**：

#### Phase 1：基础支持（1-2 天）

**1. 配置类型定义**

```typescript
// src/core/types/provider.ts
export interface ThinkingConfig {
  type: 'adaptive' | 'enabled';
  effort?: 'low' | 'medium' | 'high';  // adaptive 模式
  budgetTokens?: number;                // enabled 模式
}

export interface ProviderConfig {
  model: string;
  lightModel?: string;
  maxTokens?: number;
  thinking?: ThinkingConfig;  // ← 新增
  temperature?: number;
  // ...
}
```

**2. Provider 层实现**

```typescript
// src/core/providers/AnthropicProvider.ts L42-64
const params: Anthropic.MessageCreateParamsStreaming = {
  model: config.model,
  max_tokens: config.maxTokens || 65536,
  stream: true,
  messages: chatMessages,
  system: systemBlocks,
  tools: tools.map(t => ({ ...t, cache_control: { type: 'ephemeral' } })),

  // ← 新增 Extended Thinking 配置
  ...(config.thinking ? {
    thinking: config.thinking.type === 'adaptive'
      ? { type: 'adaptive', effort: config.thinking.effort ?? 'medium' }
      : { type: 'enabled', budget_tokens: config.thinking.budgetTokens ?? 10000 }
  } : {}),

  ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
};
```

**3. 默认配置**

```typescript
// src/core/config/defaults.ts
export const DEFAULT_CONFIG: AppConfig = {
  provider: {
    model: '[CC]claude-sonnet-4-5-20250929',
    lightModel: '[CC]claude-haiku-4-5-20251001',
    maxTokens: 65536,
    thinking: {
      type: 'adaptive',
      effort: 'medium',  // 默认中等深度
    },
  },
  // ...
};
```

#### Phase 2：Skill 级别自动启用（2-3 天）

**4. Skill 元数据扩展**

```typescript
// src/core/skills/types.ts
export interface Skill<T = any> extends SkillMetadata {
  // 现有字段...

  /** Extended Thinking 配置（可选） */
  thinking?: ThinkingConfig;
}
```

**5. 内置 Skill 配置**

```typescript
// src/core/skills/builtin/prompts/code-assistant.ts
export const codeAssistantSkill: Skill = {
  id: 'code-assistant',
  name: '编程助手',
  // ...
  thinking: {
    type: 'adaptive',
    effort: 'medium',  // 标准编程任务：中等深度
  },
};

// src/core/skills/builtin/prompts/life-secretary.ts
export const lifeSecretarySkill: Skill = {
  id: 'life-secretary',
  name: '生活秘书',
  // ...
  thinking: undefined,  // 生活任务不需要深度思考
};
```

**6. ChatSession 集成**

```typescript
// src/core/chat/ChatSession.ts run() 方法
if (this.intentRouted && this.skillRegistry && this.config) {
  // ...意图路由逻辑...

  // 🆕 根据激活的 Skill 自动启用 Extended Thinking
  const thinkingConfig = this.computeThinkingConfig(activeSkills);
  if (thinkingConfig) {
    this.agentLoop!.setThinking(thinkingConfig);
    log.info(`Extended Thinking enabled: ${thinkingConfig.type}, effort=${thinkingConfig.effort}`);
  }
}

private computeThinkingConfig(skills: Skill[]): ThinkingConfig | undefined {
  // 优先级：high > medium > low > undefined
  let maxEffort: 'low' | 'medium' | 'high' | undefined = undefined;

  for (const skill of skills) {
    if (!skill.thinking) continue;
    if (skill.thinking.type === 'enabled') return skill.thinking;  // 固定预算优先

    const effort = skill.thinking.effort ?? 'medium';
    if (!maxEffort || effortLevel(effort) > effortLevel(maxEffort)) {
      maxEffort = effort;
    }
  }

  return maxEffort ? { type: 'adaptive', effort: maxEffort } : undefined;
}

function effortLevel(effort: string): number {
  return { low: 1, medium: 2, high: 3 }[effort] ?? 0;
}
```

---

### 三、模型选择策略

| 维度 | Claude Code | Xuanji | 差距 |
|------|------------|--------|------|
| **三层模型** | Haiku 30% + Sonnet 50% + Opus 20% | 双层（配置存在） | **部分实现** |
| **智能路由** | ✅ 根据任务类型自动选择 | ❌ 未实现 | **缺失** |
| **全局应用** | ✅ 压缩、子代理用 Haiku | ⚠️ 仅 SmartMemoryExtractor | **未充分利用** |
| **OpusPlan** | ✅ Opus 规划 → Haiku 团队执行 | ❌ 未实现 | **缺失** |

**Claude Code 模型选择算法**：

```python
def select_model(task):
    # 机械性任务 → Haiku
    if is_mechanical(task):  # 文件列表、批量读取、格式转换
        return HAIKU

    # 压缩、摘要 → Haiku
    if task_type in ['compression', 'summarization', 'extraction']:
        return HAIKU

    # 子代理任务 → Haiku（默认）
    if is_sub_agent(task) and not requires_reasoning(task):
        return HAIKU

    # 安全审计 → Opus
    if has_security_implications(task):
        return OPUS

    # 架构设计 → Opus
    if is_architecture_design(task):
        return OPUS

    # 标准开发 → Sonnet（默认）
    return SONNET
```

**Xuanji 改进方案**：

#### Phase 1：全局应用 lightModel（立即实施，P0）

**1. ContextCompressor 优化**

```typescript
// src/core/agent/ContextCompressor.ts L323-327
// 修改前
const stream = this.provider!.stream(messages, [], {
  ...this.providerConfig!,  // 使用主模型（Sonnet）
  maxTokens: 1500,
  temperature: 0.2,
});

// 修改后
const stream = this.provider!.stream(messages, [], {
  model: this.providerConfig!.lightModel ?? this.providerConfig!.model,  // ← 改用 Haiku
  apiKey: this.providerConfig!.apiKey,
  baseURL: this.providerConfig!.baseURL,
  maxTokens: 1500,
  temperature: 0.2,
});
```

**预期收益**：
- 压缩调用频率：平均 10 次/会话
- 成本节省：每次调用从 $0.006 降到 $0.002（-67%）
- **总体节省**：~40% 成本（日常使用场景）

**2. SubAgentLoop 优化**

```typescript
// src/core/agent/SubAgentLoop.ts 签名修改
export async function runSubAgent(
  mainProvider: ILLMProvider,
  lightProvider: ILLMProvider,  // ← 新增参数
  registry: IToolRegistry,
  parentConfig: AgentConfig,
  context: SubAgentContext,
  // ...
) {
  // 默认用 lightProvider，除非明确要求主模型
  const provider = context.requireMainModel ? mainProvider : lightProvider;

  const agentLoop = new AgentLoop(
    provider,
    filteredRegistry,
    agentConfig,
    memoryStore,
  );
  // ...
}

// src/core/tools/TaskTool.ts 调用处修改
await runSubAgent(
  this.provider!,
  this.lightProvider!,  // ← 传递 lightProvider
  this.registry!,
  this.parentConfig!,
  context,
);
```

**预期收益**：
- 子代理成本：从 $0.045/次 降到 $0.015/次（-67%）
- 典型场景：5-10 个子代理并发
- **总体节省**：~30% 成本（子代理场景）

#### Phase 2：智能模型路由（P1）

**3. 工具级别路由**

```typescript
// src/core/tools/ToolCategories.ts 新增
export const TOOL_MODEL_PREFERENCE = {
  // Haiku 足够的工具（机械性、只读）
  'haiku': [
    'read_file',
    'glob',
    'grep',
    'ls',
    'task_output',
  ],

  // Sonnet 推荐的工具（编辑、执行）
  'sonnet': [
    'write_file',
    'edit_file',
    'multi_edit',
    'bash',
    'notebook_edit',
  ],

  // 默认 Sonnet
  'default': 'sonnet',
};

// src/core/agent/ToolDispatcher.ts 新增方法
shouldUseLightModel(toolName: string): boolean {
  return TOOL_MODEL_PREFERENCE.haiku.includes(toolName);
}
```

**4. AgentLoop 集成**

```typescript
// src/core/agent/AgentLoop.ts 修改构造函数
constructor(
  mainProvider: ILLMProvider,
  lightProvider: ILLMProvider,  // ← 新增参数
  registry: IToolRegistry,
  config: AgentConfig,
  memoryStore?: IMemoryStore,
) {
  this.mainProvider = mainProvider;
  this.lightProvider = lightProvider;
  this.provider = mainProvider;  // 默认主模型
  // ...
}

// 在 runOnce() 中动态切换
private async runOnce(messages: Message[]): Promise<ProcessResult> {
  // 分析待执行工具
  const pendingTools = this.streamProcessor.getPendingToolCalls();
  const allLight = pendingTools.every(t =>
    this.toolDispatcher.shouldUseLightModel(t.name)
  );

  // 动态切换 Provider
  const provider = allLight ? this.lightProvider : this.mainProvider;

  const stream = provider.stream(messages, schemas, providerConfig);
  // ...
}
```

**预期收益**：
- 只读操作（read_file, glob, grep）占比 40%
- **总体节省**：~15% 成本

---

### 四、优化效果预估

#### 立即实施（Phase 1）

| 优化项 | 成本节省 | 性能影响 | 工期 |
|--------|---------|---------|------|
| **ContextCompressor 用 Haiku** | -67% 压缩成本 | 无（仍秒级） | 1 天 |
| **SubAgent 用 Haiku** | -67% 子代理成本 | 轻微（质量 90%） | 2 天 |
| **Extended Thinking 基础支持** | 复杂任务质量 +15% | 延迟 +10% | 2 天 |
| **总计** | **-40% 日常成本** | - | **5 天** |

#### 后续优化（Phase 2）

| 优化项 | 成本节省 | 性能影响 | 工期 |
|--------|---------|---------|------|
| **智能模型路由** | -15% 总体成本 | 无 | 3 天 |
| **Skill 级 Thinking 自动启用** | 质量 +10% | 延迟 +5% | 2 天 |
| **OpusPlan 混合编排** | -80% 子代理成本 | 需 Opus | 5 天 |
| **总计** | **-60% 总体成本** | - | **10 天** |

---

## 🎯 实施优先级

### P0 — 立即实施（本周）

1. ✅ **ContextCompressor 用 lightModel**
   - 文件：`src/core/agent/ContextCompressor.ts` L323
   - 改动：1 行
   - 收益：-67% 压缩成本

2. ✅ **SubAgent 用 lightProvider**
   - 文件：`src/core/agent/SubAgentLoop.ts`, `src/core/tools/TaskTool.ts`
   - 改动：签名修改 + 参数传递
   - 收益：-67% 子代理成本

### P1 — 重要补充（下周）

3. ⭐ **Extended Thinking 基础支持**
   - 文件：`src/core/types/provider.ts`, `src/core/providers/AnthropicProvider.ts`
   - 改动：配置类型 + API 调用
   - 收益：复杂任务质量 +15%

4. ⭐ **Skill 级 Thinking 自动启用**
   - 文件：`src/core/skills/types.ts`, `src/core/chat/ChatSession.ts`
   - 改动：元数据扩展 + 自动计算
   - 收益：智能化，用户无感

### P2 — 进阶优化（后续）

5. 🔮 **智能模型路由**
   - 工具级别路由
   - 动态 Provider 切换

6. 🔮 **OpusPlan 混合编排**
   - 需结合 Wave 4 Item 6（多代理团队）

---

## 📋 实施检查清单

### Phase 1（P0）— 5 天工期

- [ ] **Day 1**: ContextCompressor lightModel 优化
  - [ ] 修改 `ContextCompressor.ts` L323
  - [ ] 测试压缩功能
  - [ ] 验证成本节省

- [ ] **Day 2-3**: SubAgent lightProvider 优化
  - [ ] 修改 `SubAgentLoop.ts` 签名
  - [ ] 修改 `TaskTool.ts` 调用
  - [ ] 修改 `ChatSession.ts` 初始化
  - [ ] 测试子代理功能
  - [ ] 验证质量降级（< 10%）

- [ ] **Day 4-5**: Extended Thinking 基础支持
  - [ ] 新增 `ThinkingConfig` 类型
  - [ ] 修改 `AnthropicProvider` API 调用
  - [ ] 修改默认配置
  - [ ] 测试复杂任务（重构、架构设计）
  - [ ] 验证质量提升

### Phase 2（P1）— 2-3 天工期

- [ ] **Day 1-2**: Skill 级 Thinking 自动启用
  - [ ] 扩展 Skill 元数据
  - [ ] 配置内置 Skill
  - [ ] ChatSession 自动计算
  - [ ] 测试不同 Skill 场景

- [ ] **Day 3**: 文档和测试
  - [ ] 更新用户文档
  - [ ] 更新配置说明
  - [ ] 集成测试

---

## 📊 数据验证方法

### 成本验证

```bash
# 记录 7 天日志
grep "Cost" ~/.xuanji/logs/info.log | tail -1000 > cost-before.log

# 优化后再记录 7 天
grep "Cost" ~/.xuanji/logs/info.log | tail -1000 > cost-after.log

# 对比分析
python scripts/analyze-cost.py cost-before.log cost-after.log
```

### 质量验证（SubAgent）

```typescript
// 测试用例：对比主模型 vs lightModel 子代理质量
const testCases = [
  '重构 src/core/agent/AgentLoop.ts',
  '优化 ContextCompressor 性能',
  '修复 DynamicToolFilter 初始化问题',
];

for (const task of testCases) {
  const mainResult = await runSubAgent(mainProvider, ...);
  const lightResult = await runSubAgent(lightProvider, ...);

  // 人工评估：功能正确性、代码质量、文档完整性
  console.log(`任务: ${task}`);
  console.log(`主模型质量: ${evaluateQuality(mainResult)}`);
  console.log(`轻量模型质量: ${evaluateQuality(lightResult)}`);
}
```

---

## 🔗 参考资料

- [Building with extended thinking - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Adaptive thinking - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Claude Sonnet vs Haiku 2026 Comparison](https://serenitiesai.com/articles/claude-sonnet-vs-haiku-2026)
- [What's new in Claude 4.6](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-6)

---

**创建时间**：2026-03-03
**状态**：待实施
**预期收益**：-40% 成本（Phase 1）+ 质量提升
