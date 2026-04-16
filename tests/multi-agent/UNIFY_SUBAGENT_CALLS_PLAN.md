# 统一 SubAgent 调用方式 - 重构方案

## 问题分析

### 当前问题

`MemoryFlushAgent.runExtractionAgent()` 有两条调用路径：

```typescript
if (this.subAgentFactory) {
  // 路径 1：使用 SubAgentFactory（新方式）
  result = await this.subAgentFactory.createAndRun('memory-extractor', {
    task,
    depth: 1,
    timeout: 25_000,
    parentConfig: this.parentConfig,  // ← 传递 parentConfig（冗余）
  });
} else {
  // 路径 2：使用 runSubAgent（旧方式，遗留代码）
  const context = new SubAgentContext({
    task,
    role: 'memory-extractor',
    depth: 1,
    timeout: 25_000,
    restrictedTools: [],
    useLightModel: true,
  });
  result = await runSubAgent(
    this.provider,
    this.lightProvider,
    this.registry,
    this.parentConfig,
    context,
    this.hookRegistry,
  );
}
```

**问题：**
1. **职责不统一**：两种方式做同样的事情
2. **代码冗余**：维护两套逻辑
3. **配置混乱**：路径 1 传递 `parentConfig`，但修复后已经不需要了
4. **遗留代码**：路径 2 是旧的实现，应该被移除

### 根本原因

历史遗留：
- 早期没有 `SubAgentFactory`，使用 `runSubAgent()` 直接调用
- 后来引入 `SubAgentFactory` 统一管理，但保留了旧路径作为回退
- 修复后，所有 agent 都有独立配置，不再需要 `parentConfig` 回退

## 重构方案

### Step 1: 移除 MemoryFlushAgent 的旧路径

**文件：** `src/memory/MemoryFlushAgent.ts`

**修改前：**
```typescript
private async runExtractionAgent(
  conversation: string,
  sessionId?: string,
): Promise<Omit<FlushResult, 'duration'>> {
  const task = this.buildExtractionTask(conversation);

  let result: { result: string };

  if (this.subAgentFactory) {
    result = await this.subAgentFactory.createAndRun('memory-extractor', {
      task,
      depth: 1,
      timeout: 25_000,
      parentConfig: this.parentConfig,
    });
  } else {
    // 旧路径：使用 runSubAgent
    const context = new SubAgentContext({...});
    result = await runSubAgent(...);
  }

  // ...
}
```

**修改后：**
```typescript
private async runExtractionAgent(
  conversation: string,
  sessionId?: string,
): Promise<Omit<FlushResult, 'duration'>> {
  if (!this.subAgentFactory) {
    throw new Error('SubAgentFactory is required for memory extraction');
  }

  const task = this.buildExtractionTask(conversation);

  // 统一使用 SubAgentFactory
  const result = await this.subAgentFactory.createAndRun('memory-extractor', {
    task,
    depth: 1,
    timeout: 25_000,
    // 不再传递 parentConfig，agent 使用自己的配置
  });

  // 解析 SubAgent 输出
  const extracted = this.parseExtractionResult(result.result);

  // 保存到记忆系统
  const savedCount = await this.saveExtractedMemories(extracted, sessionId);
  const lessonCount = await this.saveExtractedLessons(extracted, sessionId);
  await this.saveSuccessfulPatterns(extracted, sessionId);
  await this.saveUnfinishedTasks(extracted, sessionId);

  return {
    processedMessages: 0,
    extractedMemories: savedCount,
    extractedLessons: lessonCount,
    summary: extracted.summary,
    keyPoints: extracted.keyPoints,
  };
}
```

### Step 2: 简化 MemoryFlushAgent 构造函数

**修改前：**
```typescript
constructor(opts: {
  provider: ILLMProvider;
  lightProvider: ILLMProvider;
  registry: IToolRegistry;
  parentConfig: AgentConfig;
  providerConfig: ProviderConfig;
  memoryManager: MemoryManager;
  hookRegistry?: HookRegistry | null;
  subAgentFactory?: SubAgentFactory | null;
}) {
  this.provider = opts.provider;
  this.lightProvider = opts.lightProvider;
  this.registry = opts.registry;
  this.parentConfig = opts.parentConfig;
  this.providerConfig = opts.providerConfig;
  this.memoryManager = opts.memoryManager;
  this.hookRegistry = opts.hookRegistry ?? null;
  this.subAgentFactory = opts.subAgentFactory ?? null;
}
```

**修改后：**
```typescript
constructor(opts: {
  subAgentFactory: SubAgentFactory;  // 必需，不再可选
  memoryManager: MemoryManager;
}) {
  this.subAgentFactory = opts.subAgentFactory;
  this.memoryManager = opts.memoryManager;
}
```

**理由：**
- `provider`、`lightProvider`、`registry`、`parentConfig`、`providerConfig`、`hookRegistry` 都不再需要
- SubAgentFactory 内部已经管理了这些依赖
- 大幅简化构造函数

### Step 3: 更新 MemoryService 初始化

**文件：** `src/memory/MemoryService.ts`

**修改前：**
```typescript
initMemoryFlushAgent(options: {
  provider: ILLMProvider;
  lightProvider: ILLMProvider;
  registry: IToolRegistry;
  parentConfig: AgentConfig;
  providerConfig: any;
  hookRegistry: HookRegistry;
  subAgentFactory?: SubAgentFactory;
}): void {
  if (!this.memoryManager) {
    log.warn('MemoryManager not set, cannot initialize MemoryFlushAgent');
    return;
  }

  try {
    this.memoryFlushAgent = new MemoryFlushAgent({
      provider: options.provider,
      lightProvider: options.lightProvider,
      registry: options.registry,
      parentConfig: options.parentConfig,
      providerConfig: options.providerConfig,
      memoryManager: this.memoryManager,
      hookRegistry: options.hookRegistry,
      subAgentFactory: options.subAgentFactory,
    });
    log.info('🧠 MemoryFlushAgent initialized');
  } catch (err) {
    log.warn('MemoryFlushAgent init failed:', err);
  }
}
```

**修改后：**
```typescript
initMemoryFlushAgent(options: {
  subAgentFactory: SubAgentFactory;
}): void {
  if (!this.memoryManager) {
    log.warn('MemoryManager not set, cannot initialize MemoryFlushAgent');
    return;
  }

  try {
    this.memoryFlushAgent = new MemoryFlushAgent({
      subAgentFactory: options.subAgentFactory,
      memoryManager: this.memoryManager,
    });
    log.info('🧠 MemoryFlushAgent initialized');
  } catch (err) {
    log.warn('MemoryFlushAgent init failed:', err);
  }
}
```

### Step 4: 更新 ChatSession 调用

**文件：** `src/core/chat/ChatSession.ts`

**修改前：**
```typescript
if (this.provider && this.lightProvider && this.registry && this.memoryManager && this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
  this.memoryService.initMemoryFlushAgent({
    provider: this.provider,
    lightProvider: this.lightProvider,
    registry: this.registry,
    parentConfig: {
      model: this.config!.provider.model,
      apiKey: this.config!.provider.apiKey,
      baseURL: this.config!.provider.baseURL,
      maxTokens: this.config!.provider.maxTokens,
      temperature: this.config!.provider.temperature,
    },
    providerConfig: this.config!.provider,
    hookRegistry: this.hookRegistry,
    subAgentFactory: this.subAgentFactory ?? undefined,
  });
}
```

**修改后：**
```typescript
if (this.subAgentFactory && this.memoryManager && this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
  this.memoryService.initMemoryFlushAgent({
    subAgentFactory: this.subAgentFactory,
  });
}
```

### Step 5: 移除 runSubAgent 函数（可选）

如果 `runSubAgent()` 函数只被 MemoryFlushAgent 使用，可以考虑移除：

**检查使用情况：**
```bash
grep -r "runSubAgent" src/ --include="*.ts" | grep -v "SubAgentLoop.ts"
```

如果只有 MemoryFlushAgent 使用，可以删除 `src/core/agent/SubAgentLoop.ts` 中的 `runSubAgent` 导出。

## 重构后的优势

### 1. 职责统一
- ✅ 所有 SubAgent 调用都通过 `SubAgentFactory`
- ✅ 记忆 agent 和其他 agent 使用相同的调用方式

### 2. 代码简化
- ✅ MemoryFlushAgent 构造函数从 8 个参数减少到 2 个
- ✅ 移除了 150+ 行的旧路径代码
- ✅ ChatSession 初始化代码更简洁

### 3. 配置清晰
- ✅ 每个 agent 使用自己配置文件中的 provider
- ✅ 不再需要 parentConfig 回退
- ✅ 配置来源一目了然

### 4. 易于维护
- ✅ 只有一条代码路径，减少维护成本
- ✅ 修改 SubAgent 逻辑只需要改一个地方
- ✅ 新增 agent 类型更容易

## 实施步骤

1. ✅ 修改 `MemoryFlushAgent.ts` - 移除旧路径
2. ✅ 简化 `MemoryFlushAgent` 构造函数
3. ✅ 更新 `MemoryService.ts` 初始化方法
4. ✅ 更新 `ChatSession.ts` 调用代码
5. ✅ 运行测试验证
6. ⚠️ （可选）移除 `runSubAgent` 函数

## 测试验证

### 测试用例

1. **记忆提取测试**
   - 正常对话后退出，验证记忆是否正确提取
   - 检查 token 使用量 > 0
   - 验证使用的是 memory-extractor 的独立 API Key

2. **agent_team 测试**
   - 运行 sequential/parallel 等策略
   - 验证所有成员都能正常工作
   - 检查每个成员的 token 使用量

3. **配置验证**
   - 确保所有 builtin agent 都有完整的 provider 配置
   - 验证启动时不会报错

## 风险评估

### 低风险
- ✅ SubAgentFactory 已经稳定运行
- ✅ 所有 agent 都有独立配置
- ✅ 只是移除冗余代码，不改变核心逻辑

### 需要注意
- ⚠️ 确保 ChatSession 初始化时 subAgentFactory 已经创建
- ⚠️ 如果有其他地方使用 runSubAgent，需要一并迁移

## 总结

这次重构将：
1. **统一职责**：所有 SubAgent 都通过 SubAgentFactory 调用
2. **减少冗余**：移除 150+ 行旧代码
3. **简化配置**：构造函数参数从 8 个减少到 2 个
4. **提高可维护性**：只有一条代码路径

建议立即实施，风险低，收益高。
