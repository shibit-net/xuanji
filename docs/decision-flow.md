# 贾维斯架构 - Prompt 和 Agent 决策流程

## 📋 完整决策流程

```
用户输入："写一个用户登录接口"
  ↓
┌─────────────────────────────────────────────────────────┐
│ Step 1: 场景识别（IntentAnalyzer）                        │
├─────────────────────────────────────────────────────────┤
│ 1.1 规则匹配（<1ms，优先级最高）                          │
│     检查关键词正则：                                       │
│     /^(写|实现|创建).*(代码|功能|接口)/i                  │
│     ✅ 匹配成功 → scene = 'write_code'                    │
│                                                           │
│ 1.2 Embedding匹配（如果规则未匹配）                       │
│     计算用户输入与场景描述的余弦相似度                      │
│     阈值：>= 0.3                                          │
│                                                           │
│ 1.3 默认场景（如果都未匹配）                              │
│     首轮：'coding'                                        │
│     非首轮：沿用上轮场景                                   │
│                                                           │
│ 1.4 复杂度判断                                            │
│     - simple: 长度<30 且无动作词                          │
│     - complex: 含"架构|重构|多步骤"或长度>200             │
│     - standard: 其他                                      │
│     ✅ 结果：complexity = 'standard'                      │
└─────────────────────────────────────────────────────────┘
  ↓
  scene = 'write_code', complexity = 'standard'
  ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: Agent 选择（TaskPlanner）                         │
├─────────────────────────────────────────────────────────┤
│ 2.1 场景到Agent映射（硬编码）                             │
│     const mapping = {                                    │
│       'write_code': 'coder',                             │
│       'debug': 'coder',                                  │
│       'review': 'coder',                                 │
│       'test': 'coder',                                   │
│       'refactor': 'coder',                               │
│       'explain': 'general-purpose',                      │
│       'explore': 'explore',                              │
│       'plan': 'plan',                                    │
│     };                                                   │
│     ✅ agentId = 'coder'                                 │
│                                                           │
│ 2.2 任务计划生成                                          │
│     - 简单任务：strategy = 'single'                       │
│     - 复杂任务：调用LLM拆分，strategy = 'sequential'等    │
│     ✅ plan = {                                           │
│          strategy: 'single',                             │
│          tasks: [{                                       │
│            id: 'task-1',                                 │
│            agentId: 'coder',                             │
│            scene: 'write_code'                           │
│          }]                                              │
│        }                                                 │
└─────────────────────────────────────────────────────────┘
  ↓
  agentId = 'coder', scene = 'write_code'
  ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: 加载内置 Agent 配置（AgentRegistry）              │
├─────────────────────────────────────────────────────────┤
│ 3.1 从文件加载 Agent 配置                                 │
│     文件：src/core/templates/agents/coder.json5         │
│     ✅ 加载配置：                                         │
│        {                                                 │
│          id: 'coder',                                    │
│          systemPrompt: "You are a coding agent...",     │
│          tools: ['read_file', 'write_file', ...],       │
│          permissions: { fileWrite: 'ask', ... },        │
│          execution: { maxIterations: 40, ... }          │
│        }                                                 │
└─────────────────────────────────────────────────────────┘
  ↓
  内置 Agent 配置已加载
  ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: 生成场景增强 Prompt（PromptStore）                │
├─────────────────────────────────────────────────────────┤
│ 4.1 从场景配置获取增强指令                                │
│     文件：src/core/prompt/components/l1-coding-scenes.ts│
│     场景：'write_code'                                   │
│     ✅ 生成增强指令：                                     │
│        "# 当前场景：write_code                           │
│         编写代码、实现功能                                │
│         请特别注意：                                      │
│         - 遵循场景的专业要求                              │
│         - 使用合适的语气和风格                            │
│         - 输出符合场景预期的结果"                         │
└─────────────────────────────────────────────────────────┘
  ↓
  场景增强指令已生成
  ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5: 组合最终 Prompt（TeamManager）                    │
├─────────────────────────────────────────────────────────┤
│ 5.1 组合 systemPrompt                                    │
│     最终 Prompt = 内置 Agent 的 systemPrompt             │
│                  + 场景增强指令                           │
│                                                           │
│     ✅ 最终 Prompt：                                      │
│        "You are a coding agent specialized in            │
│         writing, refactoring, and testing code.          │
│         ...（内置 coder.json5 的完整 systemPrompt）       │
│                                                           │
│         # 当前场景：write_code                           │
│         编写代码、实现功能                                │
│         请特别注意：                                      │
│         - 遵循场景的专业要求                              │
│         - 使用合适的语气和风格                            │
│         - 输出符合场景预期的结果"                         │
│                                                           │
│ 5.2 创建 SubAgent 实例                                   │
│     - 使用组合后的 systemPrompt                          │
│     - 使用内置 Agent 的 tools                            │
│     - 使用内置 Agent 的 permissions                      │
│     - 使用内置 Agent 的 execution 配置                   │
└─────────────────────────────────────────────────────────┘
  ↓
  SubAgent 已创建并配置完成
  ↓
┌─────────────────────────────────────────────────────────┐
│ Step 6: 执行任务（AgentLoop）                             │
├─────────────────────────────────────────────────────────┤
│ 6.1 AgentLoop 运行                                       │
│     - 使用最终的 systemPrompt                            │
│     - 调用 LLM（Claude）                                 │
│     - 执行工具调用                                        │
│     - 返回结果                                            │
└─────────────────────────────────────────────────────────┘
  ↓
  返回结果给用户
```

---

## 🔍 详细说明

### 1. 场景识别规则（IntentAnalyzer）

#### 规则匹配（优先级最高）

```typescript
const SCENE_RULES = {
  'write_code': /^(写|实现|创建|添加|新增).*(代码|功能|接口|组件|模块)/i,
  'debug': /^(修复|解决|排查|调试).*(bug|问题|错误|异常)/i,
  'review': /^(审查|检查|优化|改进).*(代码|实现|质量)/i,
  'test': /^(写|添加|补充).*(测试|单元测试)/i,
  'refactor': /^(重构|改造|优化).*(代码|架构)/i,
  'explain': /^(讲解|解释|说明).*(原理|代码)/i,
  'explore': /^(探索|分析|理解).*(代码库|项目)/i,
  'plan': /^(规划|设计|制定).*(方案|架构)/i,
};
```

**匹配示例：**
- "写一个用户登录接口" → `write_code`（匹配 `/^(写).*(接口)/i`）
- "修复登录bug" → `debug`（匹配 `/^(修复).*(bug)/i`）
- "审查这段代码" → `review`（匹配 `/^(审查).*(代码)/i`）

#### Embedding 匹配（降级方案）

如果规则未匹配，使用 Embedding 计算语义相似度：

```typescript
const queryEmbedding = await embeddingService.embed(userInput);
const similarity = cosineSimilarity(queryEmbedding, sceneEmbedding);

if (similarity >= 0.3) {
  return scene; // 匹配成功
}
```

#### 复杂度判断

```typescript
// simple: 长度<30 且无动作词
if (length < 30 && /^(你好|谢谢|好的)$/i.test(input)) {
  return 'simple';
}

// complex: 含多步骤关键词或长度>200
if (/架构|重构|多步骤/i.test(input) || length > 200) {
  return 'complex';
}

// standard: 其他
return 'standard';
```

---

### 2. Agent 选择映射（TaskPlanner）

#### 硬编码映射表

```typescript
const SCENE_TO_AGENT = {
  'write_code': 'coder',           // 内置 coder.json5
  'debug': 'coder',                // coder 也能调试
  'review': 'coder',               // coder 也能审查
  'test': 'coder',                 // coder 也能写测试
  'refactor': 'coder',             // coder 也能重构
  'explain': 'general-purpose',    // 内置 general-purpose.json5
  'explore': 'explore',            // 内置 explore.json5
  'plan': 'plan',                  // 内置 plan.json5
};
```

**为什么多个场景映射到同一个 Agent？**
- `coder` 是通用编程 Agent，能处理多种编程任务
- 通过**场景增强 Prompt**来区分不同场景的专业性
- 避免创建过多重复的 Agent 配置文件

---

### 3. 场景增强 Prompt（PromptStore）

#### 场景配置示例

```typescript
// write_code 场景
{
  prompt: `你是专业编程工程师，严谨、简洁，输出代码可直接运行。

核心原则：
- 代码质量：可直接运行，无语法错误
- 简洁明了：附带1-2句核心解释
- 最佳实践：遵循语言规范和设计模式
- 安全优先：避免SQL注入、XSS等安全漏洞`,
  description: '编写代码、实现功能',
  keywords: /^(写|实现|创建).*(代码|功能|接口)/i,
}

// debug 场景
{
  prompt: `你是资深调试工程师，耐心、细致，步骤清晰。

核心原则：
- 先分析：理解报错信息，定位问题根源
- 再修复：给出具体修改方案，步骤清晰
- 验证：说明如何验证修复是否成功`,
  description: '排查问题、修复bug、调试代码',
  keywords: /^(修复|解决|排查).*(bug|问题|错误)/i,
}
```

#### 增强指令生成

```typescript
async getSceneEnhancement(scene: SceneType): Promise<string> {
  const config = this.sceneConfigs.get(scene);
  return `
# 当前场景：${scene}

${config.description}

请特别注意：
- 遵循场景的专业要求
- 使用合适的语气和风格
- 输出符合场景预期的结果
`;
}
```

---

### 4. 最终 Prompt 组合（TeamManager）

```typescript
// 内置 Agent 的 systemPrompt（基础）
const basePrompt = agentConfig.systemPrompt;
// "You are a coding agent specialized in writing..."

// 场景增强指令（专业性）
const sceneEnhancement = await promptStore.getSceneEnhancement(scene);
// "# 当前场景：write_code\n编写代码、实现功能..."

// 最终组合
const finalPrompt = `${basePrompt}\n\n${sceneEnhancement}`;
```

---

## 📊 决策流程总结

| 步骤 | 负责模块 | 输入 | 输出 | 耗时 |
|------|---------|------|------|------|
| 1. 场景识别 | IntentAnalyzer | 用户输入 | scene + complexity | <1ms（规则）或~10ms（Embedding） |
| 2. Agent选择 | TaskPlanner | scene + complexity | agentId + strategy | <1ms（查表） |
| 3. 加载Agent | AgentRegistry | agentId | Agent配置 | <1ms（缓存） |
| 4. 生成增强 | PromptStore | scene | 场景增强指令 | <1ms（查表） |
| 5. 组合Prompt | TeamManager | Agent配置 + 增强指令 | 最终Prompt | <1ms |
| 6. 执行任务 | AgentLoop | 最终Prompt + 用户输入 | 结果 | ~2-5s（LLM） |

**总开销：** ~2-5s（主要是 LLM 调用时间）

---

## 🎯 核心优势

### 1. 快速场景识别
- 规则匹配：<1ms，覆盖80%常见场景
- Embedding匹配：~10ms，处理复杂语义
- 场景防抖：避免频繁切换

### 2. 灵活 Agent 映射
- 硬编码映射：简单、可控
- 易于扩展：添加新场景只需修改映射表
- 复用内置 Agent：避免重复配置

### 3. 混合 Prompt 策略
- 保留内置 Agent 的精心配置
- 场景增强提供专业性
- 两者优势结合，互不冲突

### 4. 高性能
- 大部分决策<1ms（查表）
- 只有 LLM 调用耗时
- 总体响应时间~2-5s

---

## 🔧 如何扩展

### 添加新场景

1. **在 l1-coding-scenes.ts 添加场景配置**
```typescript
'new_scene': {
  prompt: '场景专业指令...',
  description: '场景描述',
  keywords: /场景关键词正则/i,
}
```

2. **在 TaskPlanner 添加映射**
```typescript
'new_scene': 'coder', // 或其他 Agent
```

### 添加新 Agent

1. **创建 Agent 配置文件**
```bash
src/core/templates/agents/new-agent.json5
```

2. **在 TaskPlanner 添加映射**
```typescript
'some_scene': 'new-agent',
```

---

**决策流程完整且高效！** 🎉
