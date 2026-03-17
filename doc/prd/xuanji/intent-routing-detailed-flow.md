# 智能意图路由 - 详细执行流程

## 完整数据流示例

让我们用一个真实的用户输入，完整展示每一步发生了什么。

### 用户输入

```
"提醒我明天 9 点开会，然后帮我提交今天的代码"
```

---

## 第一步：意图识别（IntentRouter）

### 输入
```typescript
userInput: "提醒我明天 9 点开会，然后帮我提交今天的代码"
```

### 执行流程

#### 1.1 规则匹配（快速，0-5ms）

```typescript
// 扫描关键词和正则模式
const ruleBasedIntents = matchByRules(userInput);

// 检查模式库：
patterns = [
  {
    keywords: ['提醒', 'reminder', '闹钟'],
    regex: /提醒|reminder|remind/i,
    intent: 'schedule.reminder',
    domain: 'life',
    confidence: 0.9
  },
  {
    keywords: ['提交', 'commit'],
    regex: /(提交|commit).*(代码|code)/i,
    intent: 'coding.git-commit',
    domain: 'coding',
    confidence: 0.95
  },
  // ... 更多模式
]

// 匹配结果：
ruleBasedIntents = [
  {
    id: 'intent-1',
    type: 'schedule.reminder',
    domain: 'life',
    confidence: 0.9,
    text: '提醒我明天 9 点开会',
    params: {
      time: '明天 9 点',
      event: '开会'
    }
  },
  {
    id: 'intent-2',
    type: 'coding.git-commit',
    domain: 'coding',
    confidence: 0.95,
    text: '提交今天的代码',
    params: {
      scope: '今天的代码'
    }
  }
]
```

#### 1.2 向量匹配（如果规则不确定，10-50ms）

```typescript
// 如果规则匹配置信度低（< 0.7），进行语义匹配
const embedding = await embedModel.encode(userInput);
// embedding: [0.23, -0.45, 0.67, ...] (384 维向量)

// 在意图向量库中查找相似意图
const semanticIntents = await vectorStore.search(embedding, {
  limit: 5,
  threshold: 0.7
});

// 结果：
semanticIntents = [
  {
    type: 'schedule.reminder',
    domain: 'life',
    similarity: 0.85,
    confidence: 0.85
  },
  {
    type: 'coding.git-commit',
    domain: 'coding',
    similarity: 0.82,
    confidence: 0.82
  }
]
```

#### 1.3 LLM 分类（如果前两步不确定，500-2000ms）

```typescript
// 仅在以下情况调用：
// 1. 规则和向量都没找到意图
// 2. 输入很长或复杂（> 100 字符或多子句）
// 3. 意图置信度都很低（< 0.6）

if (needsLLMClassification(userInput, ruleBasedIntents, semanticIntents)) {
  const llmIntents = await classifyByLLM(userInput);
}

// LLM Prompt:
`分析用户输入，识别所有意图。

用户输入："提醒我明天 9 点开会，然后帮我提交今天的代码"

意图类型定义：
- schedule.reminder: 设置提醒、闹钟
- schedule.event: 日程安排
- coding.git-commit: 提交代码
- coding.review: 代码审查
- finance.expense: 记账
- general.question: 一般问题

返回 JSON：
[
  {
    "type": "schedule.reminder",
    "domain": "life",
    "confidence": 0.95,
    "params": { "time": "明天 9 点", "event": "开会" }
  },
  {
    "type": "coding.git-commit",
    "domain": "coding",
    "confidence": 0.9,
    "params": { "scope": "今天的代码" }
  }
]`

// LLM 响应（JSON）:
llmIntents = [
  {
    type: 'schedule.reminder',
    domain: 'life',
    confidence: 0.95,
    params: { time: '明天 9 点', event: '开会' }
  },
  {
    type: 'coding.git-commit',
    domain: 'coding',
    confidence: 0.9,
    params: { scope: '今天的代码' }
  }
]
```

#### 1.4 去重和排序

```typescript
// 合并三个来源的意图
const allIntents = [
  ...ruleBasedIntents,
  ...semanticIntents,
  ...llmIntents
];

// 去重（相同 type 只保留置信度最高的）
const deduped = deduplicate(allIntents);
// 结果：
[
  { type: 'coding.git-commit', confidence: 0.95 },
  { type: 'schedule.reminder', confidence: 0.9 }
]

// 按置信度排序
const sorted = deduped.sort((a, b) => b.confidence - a.confidence);
```

### 输出（IntentRouter 返回）

```typescript
intents = [
  {
    id: 'intent-1',
    type: 'coding.git-commit',
    domain: 'coding',
    confidence: 0.95,
    params: { scope: '今天的代码' },
    text: '提交今天的代码'
  },
  {
    id: 'intent-2',
    type: 'schedule.reminder',
    domain: 'life',
    confidence: 0.9,
    params: { time: '明天 9 点', event: '开会' },
    text: '提醒我明天 9 点开会'
  }
]
```

**耗时**：5-10ms（规则匹配）或 50-100ms（向量匹配）或 500-2000ms（LLM 分类）

---

## 第二步：能力组装（CapabilityAssembler）

### 输入

```typescript
intents = [
  { type: 'coding.git-commit', domain: 'coding', confidence: 0.95 },
  { type: 'schedule.reminder', domain: 'life', confidence: 0.9 }
]
```

### 执行流程

#### 2.1 提取领域

```typescript
const domains = [...new Set(intents.map(i => i.domain))];
// domains = ['coding', 'life']
```

#### 2.2 组装 System Prompt

```typescript
// 查找每个领域的配置
const codingCapability = domainCapabilities.get('coding');
// {
//   systemPromptComponents: ['coding-expertise', 'security-rules'],
//   skills: ['git-commit', 'review-pr', 'format-code'],
//   tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
//   memoryScope: 'coding'
// }

const lifeCapability = domainCapabilities.get('life');
// {
//   systemPromptComponents: ['life-assistant-identity'],
//   skills: ['reminder-set', 'todo-add', 'calendar-add'],
//   tools: ['Read', 'Write', 'Bash'],
//   memoryScope: 'life'
// }

// 组装 System Prompt Components
const components = [
  // 核心组件（始终加载）
  coreIdentityComponent,       // priority: 100
  projectRulesComponent,        // priority: 90
  memoryContextComponent,       // priority: 80
  toolGuidanceComponent,        // priority: 70

  // coding 领域组件
  codingExpertiseComponent,     // priority: 85
  securityRulesComponent,       // priority: 75

  // life 领域组件
  lifeAssistantIdentityComponent, // priority: 85
];

// 按优先级排序
components.sort((a, b) => b.priority - a.priority);

// 渲染每个组件
const systemPromptParts = await Promise.all(
  components.map(c => c.render({
    cwd: '/project',
    messageHistory: [],
    relevantMemories: []
  }))
);

// 拼接成最终的 System Prompt
const systemPrompt = systemPromptParts.join('\n\n---\n\n');
```

**最终 System Prompt**（简化版）：
```markdown
# Xuanji - AI 编程助手

你是 Xuanji，专注于代码开发和生活助理。

## 核心原则
- 准确性优先
- 工具优先
- 渐进式

---

## 编程专长
- 语言：TypeScript, Python, JavaScript
- 框架：React, Vue, Node.js
- 工具：Git, Docker

---

## 生活助理身份
你也是用户的生活助理，帮助管理日程和提醒。
- 友好、温暖、贴心
- 主动提醒和关怀

---

## 工具使用指导
- Read：读取文件
- Write：写入文件
- Bash：执行命令

---

## 相关记忆
- 用户偏好使用 npm 而非 yarn
- 用户通常在早上 9 点开会
```

#### 2.3 筛选 Skills

```typescript
// 方式 1: 根据意图精确匹配
const skillMapping = {
  'coding.git-commit': 'git-commit',
  'schedule.reminder': 'reminder-set',
  'coding.review-pr': 'review-pr',
  'finance.expense-record': 'expense-record'
};

const intentBasedSkills = intents
  .map(i => skillMapping[i.type])
  .filter(Boolean)
  .map(id => skillRegistry.get(id));

// intentBasedSkills = [
//   gitCommitSkill,
//   reminderSetSkill
// ]

// 方式 2: 加载领域相关的 Skills（补充）
const domainSkills = [];
for (const domain of ['coding', 'life']) {
  const capability = domainCapabilities.get(domain);
  for (const skillId of capability.skills) {
    const skill = skillRegistry.get(skillId);
    if (skill && !intentBasedSkills.includes(skill)) {
      domainSkills.push(skill);
    }
  }
}

// domainSkills = [
//   reviewPrSkill,        // coding 相关
//   formatCodeSkill,      // coding 相关
//   todoAddSkill,         // life 相关
//   calendarAddSkill      // life 相关
// ]

// 最终 Skills（意图精确 + 领域相关）
const activeSkills = [...intentBasedSkills, ...domainSkills];
```

**最终 Skills**：
```typescript
activeSkills = [
  // 意图精确匹配
  {
    id: 'git-commit',
    name: 'Git Commit',
    config: { autoApply: true, triggers: [...] }
  },
  {
    id: 'reminder-set',
    name: 'Set Reminder',
    config: { autoApply: true, triggers: [...] }
  },

  // 领域相关（备用）
  {
    id: 'review-pr',
    name: 'Review PR',
    config: { autoApply: false }
  },
  {
    id: 'format-code',
    name: 'Format Code',
    config: { autoApply: false }
  }
]
```

#### 2.4 筛选 Tools

```typescript
// 合并所有领域允许的工具
const toolNames = new Set();

for (const domain of ['coding', 'life']) {
  const capability = domainCapabilities.get(domain);
  capability.tools.forEach(t => toolNames.add(t));
}

// toolNames = Set(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'])

// 获取工具实例
const availableTools = Array.from(toolNames)
  .map(name => toolRegistry.get(name))
  .filter(Boolean);
```

**最终 Tools**：
```typescript
availableTools = [
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GrepTool,
  GlobTool
]
```

#### 2.5 合并 Memory Scopes

```typescript
// 确定需要查询的记忆范围
const memoryScopes = ['global']; // 始终包含全局记忆

for (const domain of ['coding', 'life']) {
  const capability = domainCapabilities.get(domain);
  memoryScopes.push(capability.memoryScope);
}

// memoryScopes = ['global', 'coding', 'life']

// 从多个 scope 查询相关记忆
const memories = await memoryStore.retrieve(userInput, {
  scopes: memoryScopes,
  limit: 10
});
```

**查询到的记忆**：
```typescript
memories = [
  {
    scope: 'coding',
    content: '用户偏好使用 npm 而非 yarn',
    relevance: 0.85
  },
  {
    scope: 'life',
    content: '用户通常在早上 9 点开会',
    relevance: 0.8
  },
  {
    scope: 'global',
    content: '用户喜欢简洁的提交信息',
    relevance: 0.75
  }
]
```

#### 2.6 选择 Model

```typescript
// 估算复杂度
const complexity = estimateComplexity(intents);
// intents.length = 2 → complexity = 'medium'

// 默认配置
let modelConfig = {
  name: 'claude-sonnet-4.5',
  temperature: 0.2,
  maxTokens: 8000
};

// 规则 1: 复杂任务用更强的模型
if (complexity === 'complex') {
  modelConfig.name = 'claude-opus-4.5';
  modelConfig.thinking = { type: 'enabled', budget_tokens: 10000 };
}

// 规则 2: 简单生活任务用更快的模型
if (complexity === 'simple' && domains.length === 1 && domains[0] === 'life') {
  modelConfig.name = 'claude-haiku-4.5';
  modelConfig.temperature = 0.7;
}

// 规则 3: 金融领域优先 Opus + Thinking
if (domains.includes('finance')) {
  modelConfig.name = 'claude-opus-4.5';
  modelConfig.temperature = 0.1;
  modelConfig.thinking = { type: 'enabled', budget_tokens: 10000 };
}

// 当前情况：medium complexity + coding + life
// → 使用 claude-sonnet-4.5 (默认)
```

**最终 Model 配置**：
```typescript
modelConfig = {
  name: 'claude-sonnet-4.5',
  temperature: 0.2,
  maxTokens: 8000
}
```

### 输出（CapabilityAssembler 返回）

```typescript
executionPlan = {
  systemPromptComponents: [
    coreIdentityComponent,
    codingExpertiseComponent,
    lifeAssistantIdentityComponent,
    projectRulesComponent,
    memoryContextComponent,
    securityRulesComponent,
    toolGuidanceComponent
  ],

  activeSkills: [
    gitCommitSkill,         // 自动应用
    reminderSetSkill,       // 自动应用
    reviewPrSkill,          // 备用
    formatCodeSkill         // 备用
  ],

  availableTools: [
    ReadTool,
    WriteTool,
    EditTool,
    BashTool,
    GrepTool,
    GlobTool
  ],

  memoryScopes: ['global', 'coding', 'life'],

  modelConfig: {
    name: 'claude-sonnet-4.5',
    temperature: 0.2,
    maxTokens: 8000
  },

  metadata: {
    intents: [
      { type: 'coding.git-commit', domain: 'coding', confidence: 0.95 },
      { type: 'schedule.reminder', domain: 'life', confidence: 0.9 }
    ],
    domains: ['coding', 'life'],
    estimatedComplexity: 'medium'
  }
}
```

**耗时**：10-30ms

---

## 第三步：执行（AgentLoop）

### 输入

```typescript
executionPlan = { ... }  // 上一步的输出
userMessage = "提醒我明天 9 点开会，然后帮我提交今天的代码"
```

### 执行流程

#### 3.1 构建 System Prompt

```typescript
// 渲染所有组件
const systemPromptParts = await Promise.all(
  executionPlan.systemPromptComponents.map(component =>
    component.render({
      cwd: process.cwd(),
      messageHistory: this.messages,
      relevantMemories: memories
    })
  )
);

// 拼接
const systemPrompt = systemPromptParts.join('\n\n---\n\n');
```

#### 3.2 检查自动应用的 Skills

```typescript
const skillResults = [];

for (const skill of executionPlan.activeSkills) {
  // 只处理自动应用的 Skill
  if (!skill.config?.autoApply) continue;

  // 检查触发条件
  if (skill.config?.triggers) {
    const matched = await checkTriggers(skill.config.triggers, {
      userInput: userMessage,
      intents: executionPlan.metadata.intents
    });

    if (!matched) continue;
  }

  // 执行 Skill
  console.log(`🔧 执行 Skill: ${skill.name}`);
  const result = await skill.execute({
    userInput: userMessage,
    intents: executionPlan.metadata.intents,
    cwd: process.cwd(),
    tools: toolRegistry,
    messageHistory: this.messages
  });

  skillResults.push(result);

  // 如果是 Action 模式且成功，输出结果
  if (result.type === 'action' && result.success) {
    this.emit('text', result.output);
  }
}
```

**Skill 执行结果**：
```typescript
skillResults = [
  {
    skillId: 'reminder-set',
    type: 'action',
    success: true,
    output: '✓ 已设置提醒：明天 9 点 - 开会',
    needsLLM: false
  },
  {
    skillId: 'git-commit',
    type: 'hybrid',
    success: true,
    output: '已暂存的更改:\n  modified: src/core/agent/AgentLoop.ts\n\n请生成提交信息',
    needsLLM: true,
    metadata: { diff: '...' }
  }
]
```

#### 3.3 调用 LLM

```typescript
// 如果有 Skill 返回了 hybrid 或 prompt 类型，需要 LLM 继续处理
const needsLLM = skillResults.some(r => r.needsLLM);

if (needsLLM) {
  // 将 Skill 输出添加到上下文
  const skillOutputs = skillResults
    .filter(r => r.needsLLM)
    .map(r => r.output)
    .join('\n\n');

  // 构建消息
  const messages = [
    {
      role: 'system',
      content: systemPrompt  // 动态组装的 System Prompt
    },
    ...this.messages,  // 历史消息
    {
      role: 'user',
      content: `${userMessage}\n\n## Skill 输出\n\n${skillOutputs}`
    }
  ];

  // 调用 LLM
  const response = await this.provider.chat({
    model: executionPlan.modelConfig.name,
    temperature: executionPlan.modelConfig.temperature,
    maxTokens: executionPlan.modelConfig.maxTokens,
    messages: messages,
    tools: this.convertToolsToSchema(executionPlan.availableTools)
  });

  // 处理响应...
}
```

**LLM 请求**：
```typescript
{
  model: 'claude-sonnet-4.5',
  temperature: 0.2,
  maxTokens: 8000,

  messages: [
    {
      role: 'system',
      content: `# Xuanji - AI 编程助手

你是 Xuanji，专注于代码开发和生活助理。

## 编程专长
- 语言：TypeScript, Python, JavaScript
...

## 生活助理身份
你也是用户的生活助理...
...`
    },
    {
      role: 'user',
      content: `提醒我明天 9 点开会，然后帮我提交今天的代码

## Skill 输出

✓ 已设置提醒：明天 9 点 - 开会

已暂存的更改:
  modified: src/core/agent/AgentLoop.ts

请生成提交信息`
    }
  ],

  tools: [
    { name: 'Read', description: '...', input_schema: {...} },
    { name: 'Write', description: '...', input_schema: {...} },
    { name: 'Edit', description: '...', input_schema: {...} },
    { name: 'Bash', description: '...', input_schema: {...} },
    { name: 'Grep', description: '...', input_schema: {...} },
    { name: 'Glob', description: '...', input_schema: {...} }
  ]
}
```

**LLM 响应**：
```typescript
{
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: '好的，我已经为你设置了明天 9 点的开会提醒。现在让我提交代码。'
    },
    {
      type: 'tool_use',
      id: 'tool_1',
      name: 'Bash',
      input: {
        command: 'git commit -m "feat: add intelligent intent routing to AgentLoop"'
      }
    }
  ]
}
```

#### 3.4 执行工具调用

```typescript
// LLM 调用了 Bash 工具
const tool = toolRegistry.get('Bash');
const result = await tool.execute({
  command: 'git commit -m "feat: add intelligent intent routing to AgentLoop"'
});

// 结果
result = `[main abc123d] feat: add intelligent intent routing to AgentLoop
 1 file changed, 50 insertions(+), 10 deletions(-)`
```

### 最终输出（返回给用户）

```
✓ 已设置提醒：明天 9 点 - 开会

✓ 代码已提交：feat: add intelligent intent routing to AgentLoop
  1 file changed, 50 insertions(+), 10 deletions(-)
```

**总耗时**：
- 意图识别：5-10ms
- 能力组装：10-30ms
- Skill 执行：100-500ms
- LLM 调用：1000-3000ms
- **总计**：1.1-3.5s

---

## 总结：整个流程做了什么

### 阶段 1: IntentRouter（智能识别）

**输入**：用户原始输入
**做了什么**：
1. 用规则快速匹配关键词
2. 用向量语义匹配意图
3. 必要时用 LLM 精确分类
4. 去重、排序、提取参数

**输出**：结构化的意图列表

### 阶段 2: CapabilityAssembler（动态组装）

**输入**：意图列表
**做了什么**：
1. 提取涉及的领域
2. 从每个领域加载配置
3. 组装 System Prompt（核心 + 领域特定）
4. 筛选 Skills（精确匹配 + 领域相关）
5. 筛选 Tools（合并领域权限）
6. 合并 Memory Scopes
7. 选择最佳 Model

**输出**：完整的执行计划

### 阶段 3: AgentLoop（执行）

**输入**：执行计划 + 用户输入
**做了什么**：
1. 渲染 System Prompt
2. 执行自动应用的 Skills
3. 如果需要，调用 LLM（带动态配置）
4. 执行 LLM 返回的工具调用
5. 返回结果

**输出**：用户可见的结果

---

## 关键价值

1. **用户无感知**：只需说需求，系统自动识别和组装
2. **智能混合**：一句话跨多个领域，自动混合能力
3. **性能优化**：只加载需要的组件，选择最佳模型
4. **完全动态**：每次请求都是实时组装，没有预设配置

这就是 Jarvis 体验的本质！
