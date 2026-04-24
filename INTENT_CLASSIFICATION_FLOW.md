# 意图分类流程说明

## 问题

意图分析结果是否正确传给了主agent？

## 答案

✅ **是的，意图分析结果正确传给了主agent**

## 完整流程

### 1. 意图分类
```typescript
// MainAgent.ts:261
classification = await this.intentClassifier.classify(userMessage);

// 返回结果：
{
  scene: 'write_code',      // 场景
  agent: 'code_writer',     // 推荐agent
  complexity: 'standard'    // 复杂度
}
```

### 2. 提取结果
```typescript
// MainAgent.ts:265-266
scene = classification.scene;
complexity = this.mapToPromptComplexity(classification.complexity);
```

### 3. 传递给PromptBuilder
```typescript
// MainAgent.ts:278-281
const buildResult = await this.promptBuilder.build({
  userMessage,
  ...(scene && { scene }),           // 传递scene
  ...(complexity && { complexity }), // 传递complexity
});
```

### 4. PromptBuilder使用结果
PromptBuilder根据scene和complexity：
- 选择合适的L1层prompt组件（场景特定指导）
- 选择合适的L2层prompt组件（能力组件）
- 调整prompt的详细程度

### 5. 构建最终Prompt
```typescript
// MainAgent.ts:285-286
const finalPrompt = buildResult.prompt + '\n\n---\n# 主Agent职责\n' + MAIN_AGENT_SYSTEM_PROMPT;
(messageManager as any).systemPrompt = finalPrompt;
```

## 数据流图

```
用户输入
  ↓
IntentClassifier.classify()
  ├─ 第1层：本地LLM分类（glm-4-flash）
  ├─ 第2层：向量分析（embedding）
  └─ 第3层：规则匹配（fallback）
  ↓
ClassificationResult {
  scene: 'write_code',
  agent: 'code_writer',
  complexity: 'standard'
}
  ↓
MainAgent提取
  ├─ scene = 'write_code'
  └─ complexity = 'simple' (映射后)
  ↓
PromptBuilder.build({
  userMessage,
  scene: 'write_code',
  complexity: 'simple'
})
  ↓
选择prompt组件
  ├─ L0: 全局基础prompt
  ├─ L1: write_code场景prompt
  └─ L2: 能力组件（根据complexity）
  ↓
组合最终prompt
  ↓
设置到MessageManager
  ↓
Agent使用prompt执行任务
```

## 验证方法

### 1. 查看日志
```
[MainAgent] 意图分类: scene=write_code agent=code_writer complexity=standard (123ms)
[MainAgent] prompt built: scene=write_code complexity=simple components=5 ~2000 tokens
[MainAgent] 📋 Loaded components: [l0-base, l1-write-code, l2-tool-use, ...]
```

### 2. 检查prompt内容
设置环境变量：
```bash
DEBUG_PROMPT=true npm run dev
```

会打印完整的system prompt，可以看到：
- 是否包含了write_code场景的指导
- 是否包含了合适的能力组件
- prompt的详细程度是否符合complexity

### 3. 观察agent行为
- 如果分类为`write_code`，agent应该专注于代码编写
- 如果分类为`debug`，agent应该专注于调试
- 如果分类为`explain`，agent应该专注于解释

## 复杂度映射

```typescript
mapToPromptComplexity(complexity: string): PromptComplexity {
  switch (complexity) {
    case 'simple':
    case 'low':
      return 'simple';
    case 'standard':
    case 'medium':
      return 'standard';
    case 'complex':
    case 'high':
      return 'detailed';
    default:
      return 'standard';
  }
}
```

## 总结

意图分析结果**完整且正确**地传递给了主agent：

1. ✅ **scene** - 用于选择场景特定的prompt组件
2. ✅ **complexity** - 用于调整prompt的详细程度
3. ✅ **agent** - 记录在日志中（未来可用于agent选择）

这确保了主agent能够：
- 获得场景特定的指导
- 使用合适的工具和能力
- 以合适的详细程度执行任务

---

创建时间：2026-04-24
状态：✅ 已验证
