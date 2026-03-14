# Multi-Agent System - Phase 0 实施计划

**阶段**: Phase 0 - 核心基础设施
**时间**: 4-5 天
**目标**: 让第一个完整的配置驱动 Agent 跑起来

---

## 一、任务清单

### Task 1: 类型定义 (0.5 天)

#### 文件
- `src/core/agent/types.ts` - 扩展

#### 新增类型

```typescript
// Agent 配置
export interface AgentConfig {
  // 基础信息
  id: string
  name: string
  version: string
  author?: string
  description: string

  // 意图匹配
  tags: string[]
  triggers?: string[]
  capabilities: string[]
  examples?: Array<{ input: string; output: string }>

  // 专属 Skills
  skills: {
    builtin?: string[]
    custom?: CustomSkill[]
  }

  // 专属知识库
  knowledgeBase: {
    path: string
    sources: KnowledgeSource[]
    embedding?: EmbeddingConfig
    retrieval?: RetrievalConfig
  }

  // 专属工具
  tools: ToolConfig[]

  // System Prompt
  systemPrompt: string

  // 模型配置
  model: {
    primary: 'sonnet' | 'opus' | 'haiku'
    fallback?: 'sonnet' | 'opus' | 'haiku'
  }

  // 执行配置
  execution: {
    maxIterations: number
    timeout: number
    retryOnError?: boolean
  }

  // 权限控制
  permissions: {
    allowFileRead: boolean
    allowFileWrite: boolean
    allowBashExecution: boolean
    allowNetworkAccess: boolean
    restrictedPaths?: string[]
    allowedDomains?: string[]
  }

  // 成本控制
  cost?: {
    maxTokensPerTask: number
    budgetAlert?: number
  }

  // 启用状态
  enabled: boolean

  // 元数据
  metadata?: {
    source: 'builtin' | 'global' | 'project'
    filePath: string
    createdAt: string
    updatedAt: string
  }
}

// 自定义 Skill
export interface CustomSkill {
  id: string
  name: string
  category: 'prompt' | 'workflow'
  priority?: number
  content: string
  dependencies?: string[]
}

// 知识源
export interface KnowledgeSource {
  type: 'csv' | 'json' | 'markdown' | 'pdf'
  path: string
  description?: string
  columns?: Record<string, string>
  schema?: Record<string, string>
}

// 工具配置
export interface ToolConfig {
  name: string
  description?: string
  config?: Record<string, any>
  enabled?: boolean
}

// Embedding 配置
export interface EmbeddingConfig {
  enabled: boolean
  model?: string
  chunkSize?: number
  overlapSize?: number
}

// 检索配置
export interface RetrievalConfig {
  maxResults?: number
  similarityThreshold?: number
  hybridWeight?: {
    vector: number
    keyword: number
    recency: number
  }
}

// Agent 委派决策
export interface AgentDelegation {
  reasoning: string
  agentId: string
  context: AgentContext
  collaborative: boolean
  agentIds?: string[]
}

// Agent 上下文
export interface AgentContext {
  task: string
  constraints?: string[]
  preferences?: Record<string, any>
  [key: string]: any
}
```

#### 验收标准
- [ ] 类型定义编译通过
- [ ] 导出所有新增类型

---

### Task 2: AgentRegistry (1 天)

#### 文件
- `src/core/agent/AgentRegistry.ts` - 新增

#### 实现要点

```typescript
import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parse as parseYAML } from 'yaml'
import { glob } from 'glob'

export class AgentRegistry {
  private agents = new Map<string, AgentConfig>()
  private watchers: Array<() => void> = []

  constructor(
    private configPaths: string[] = [
      path.join(os.homedir(), '.xuanji/agents'),
      path.join(process.cwd(), '.xuanji/agents'),
      path.join(__dirname, 'builtin'),
    ]
  ) {}

  async init() {
    // 扫描所有配置目录
    for (const configPath of this.configPaths) {
      const files = await glob(`${configPath}/**/*.{yaml,yml,json}`)
      for (const file of files) {
        await this.loadAgentConfig(file)
      }
      this.watchDirectory(configPath)
    }
  }

  private async loadAgentConfig(filePath: string) {
    // 读取文件
    // 解析 YAML/JSON
    // 验证配置
    // 添加元数据
    // 注册
  }

  register(config: AgentConfig) {
    // 优先级处理：project > global > builtin
  }

  get(id: string): AgentConfig | undefined {
    return this.agents.get(id)
  }

  getEnabled(): AgentConfig[] {
    return Array.from(this.agents.values()).filter(a => a.enabled)
  }

  getAgentListForPrompt(): string {
    // 生成给 Orchestrator 的 Agent 列表
  }

  private watchDirectory(dirPath: string) {
    // 监听文件变更
  }

  async reload() {
    this.agents.clear()
    await this.init()
  }

  private validateConfig(config: AgentConfig) {
    // 验证必填字段
    // 验证引用的 Skill 是否存在
  }

  dispose() {
    this.watchers.forEach(unwatch => unwatch())
  }
}
```

#### 验收标准
- [ ] 能扫描所有配置目录（builtin/global/project）
- [ ] 能正确加载 YAML/JSON 配置
- [ ] 配置验证能捕获错误
- [ ] 优先级正确（项目 > 全局 > 内置）
- [ ] 热重载功能正常
- [ ] `getAgentListForPrompt()` 输出格式正确

---

### Task 3: ConfigurableWorkerAgent (2 天)

#### 文件
- `src/core/agent/ConfigurableWorkerAgent.ts` - 新增
- `src/core/agent/WorkerAgent.ts` - 扩展

#### 实现要点

```typescript
export class ConfigurableWorkerAgent extends WorkerAgent {
  private skillRegistry: SkillRegistry
  private memoryManager: IMemoryStore
  private toolRegistry: IToolRegistry
  private agentDir: string

  constructor(
    private config: AgentConfig,
    private globalSkillRegistry: SkillRegistry,
    private globalToolRegistry: IToolRegistry,
    private providers: ProviderFactory,
  ) {
    this.agentDir = this.resolveAgentDirectory(config)
    this.skillRegistry = await this.buildSkillRegistry()
    this.memoryManager = await this.buildMemoryManager()
    this.toolRegistry = this.buildToolRegistry()

    super(
      providers.get(config.model.primary),
      this.toolRegistry,
      config.systemPrompt,
    )
  }

  private buildSkillRegistry(): SkillRegistry {
    const registry = new SkillRegistry()

    // 加载内置 Skills
    if (this.config.skills.builtin) {
      for (const skillId of this.config.skills.builtin) {
        const skill = this.globalSkillRegistry.get(skillId)
        if (skill) registry.register(skill)
      }
    }

    // 加载自定义 Skills
    if (this.config.skills.custom) {
      for (const customSkill of this.config.skills.custom) {
        const skill = this.createSkillFromConfig(customSkill)
        registry.register(skill)
      }
    }

    return registry
  }

  private async buildMemoryManager(): Promise<IMemoryStore> {
    const knowledgeDir = path.join(this.agentDir, 'knowledge')
    await fs.mkdir(knowledgeDir, { recursive: true })

    const memoryManager = new MemoryManager({
      storagePath: path.join(knowledgeDir, 'vector.db'),
      embeddingConfig: this.config.knowledgeBase.embedding,
    })

    await memoryManager.init()

    // 加载数据源
    for (const source of this.config.knowledgeBase.sources) {
      await this.loadKnowledgeSource(source, knowledgeDir, memoryManager)
    }

    return memoryManager
  }

  private async loadKnowledgeSource(
    source: KnowledgeSource,
    knowledgeDir: string,
    memoryManager: IMemoryStore,
  ) {
    const sourcePath = path.join(knowledgeDir, source.path)

    switch (source.type) {
      case 'csv':
        await this.loadCSV(sourcePath, source, memoryManager)
        break
      case 'json':
        await this.loadJSON(sourcePath, source, memoryManager)
        break
      case 'markdown':
        await this.loadMarkdown(sourcePath, source, memoryManager)
        break
    }
  }

  private buildToolRegistry(): IToolRegistry {
    const filteredRegistry = new FilteredToolRegistry(
      this.globalToolRegistry,
      (toolName) => {
        const toolConfig = this.config.tools.find(t => t.name === toolName)
        return toolConfig?.enabled !== false
      },
    )

    // 应用自定义配置
    for (const toolConfig of this.config.tools) {
      const tool = filteredRegistry.get(toolConfig.name)
      if (tool && toolConfig.config) {
        tool.setConfig(toolConfig.config)
      }
    }

    // 注册专属工具
    filteredRegistry.register(new KnowledgeQueryTool(this.memoryManager))

    return filteredRegistry
  }

  async run(context: AgentContext): Promise<string> {
    // 检索专属知识库
    const knowledge = await this.memoryManager.retrieve(context.task, {
      type: ['agent_knowledge'],
      maxResults: this.config.knowledgeBase.retrieval?.maxResults || 5,
    })

    // 构建系统提示词
    const systemPrompt = this.buildSystemPrompt(context, knowledge)

    // 创建 AgentLoop
    const agentLoop = new AgentLoop({
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      skillRegistry: this.skillRegistry,
      systemPrompt,
      maxIterations: this.config.execution.maxIterations,
      timeout: this.config.execution.timeout,
    })

    // 执行任务
    const result = await agentLoop.run(context.task)

    return result.text
  }

  private buildSystemPrompt(
    context: AgentContext,
    knowledge: MemoryEntry[],
  ): string {
    let prompt = this.config.systemPrompt

    // 注入专属知识
    if (knowledge.length > 0) {
      prompt += `\n\n# 专属知识库检索结果\n\n`
      prompt += knowledge.map((entry, i) => {
        return `## 知识 ${i + 1}\n${entry.content}`
      }).join('\n\n')
    }

    // 注入上下文变量
    prompt = prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return context[key] || match
    })

    return prompt
  }
}
```

#### 验收标准
- [ ] 能正确加载专属 Skills（builtin + custom）
- [ ] 能正确初始化专属知识库
- [ ] 能正确加载 CSV/JSON/Markdown 数据源
- [ ] 能正确过滤工具并应用自定义配置
- [ ] `run()` 方法能执行任务并返回结果
- [ ] 系统提示词正确注入知识和上下文

---

### Task 4: KnowledgeQueryTool (0.5 天)

#### 文件
- `src/core/tools/KnowledgeQueryTool.ts` - 新增

#### 实现要点

```typescript
export class KnowledgeQueryTool implements ITool {
  name = 'knowledge_query'
  description = '查询当前 Agent 的专属知识库'

  constructor(private memoryManager: IMemoryStore) {}

  toSchema(): ToolSchema {
    return {
      name: this.name,
      description: `
查询当前 Agent 的专属知识库（包括联系人、文档、历史记录等）。

使用场景：
- 查找客户信息（姓名、职位、偏好）
- 检索历史记录（会议记录、决策）
- 查询领域知识（餐厅列表、技术规范）

注意：此工具只能访问当前 Agent 的知识库，不能跨 Agent 查询。
`,
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '查询关键词或问题',
          },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: '限制查询的数据源（可选）',
          },
          maxResults: {
            type: 'number',
            description: '最大返回结果数（默认 3）',
          },
        },
        required: ['query'],
      },
    }
  }

  async execute(input: any): Promise<ToolResult> {
    const { query, sources, maxResults = 3 } = input

    const results = await this.memoryManager.retrieve(query, {
      type: ['agent_knowledge'],
      maxResults,
      metadata: sources ? { source: { $in: sources } } : undefined,
    })

    if (results.length === 0) {
      return {
        success: true,
        output: '❌ 知识库中没有找到相关信息',
      }
    }

    const output = results.map((entry, i) => {
      const source = entry.metadata?.source || '未知来源'
      return `## 结果 ${i + 1}\n**来源**: ${source}\n\n${entry.content}`
    }).join('\n---\n')

    return {
      success: true,
      output: `✅ 找到 ${results.length} 条相关信息：\n\n${output}`,
    }
  }
}
```

#### 验收标准
- [ ] Schema 定义正确
- [ ] 能查询专属知识库
- [ ] 支持数据源过滤
- [ ] 返回格式正确

---

### Task 5: OrchestratorAgent (1 天)

#### 文件
- `src/core/agent/OrchestratorAgent.ts` - 新增

#### 实现要点

```typescript
export class OrchestratorAgent {
  constructor(
    private provider: ILLMProvider,
    private agentRegistry: AgentRegistry,
    private memoryManager: IMemoryStore,
    private globalSkillRegistry: SkillRegistry,
    private globalToolRegistry: IToolRegistry,
    private providers: ProviderFactory,
  ) {}

  async analyze(userMessage: string): Promise<AgentDelegation> {
    // 获取所有启用的 Agent
    const enabledAgents = this.agentRegistry.getEnabled()

    // 检索全局记忆
    const memories = await this.memoryManager.retrieve(userMessage, {
      type: ['user_preference', 'project_fact'],
    })

    // 构建系统提示词
    const systemPrompt = `
你是 Xuanji 的管家 Agent，负责分析用户意图并委派给最合适的专业 Agent。

# 可用的 Worker Agent

${this.agentRegistry.getAgentListForPrompt()}

# 记忆库上下文

${formatMemories(memories)}

# 任务

分析用户请求，返回 JSON 格式的委派决策：

\`\`\`json
{
  "reasoning": "分析过程",
  "agentId": "选择的 Agent ID",
  "context": {
    "task": "提取的核心任务",
    "constraints": ["约束条件"],
    "preferences": {}
  },
  "collaborative": false
}
\`\`\`

原则：
1. 优先匹配 Agent 的 capabilities 和 tags
2. 考虑 Agent 的可用工具是否满足需求
3. 提取记忆中的关键信息注入 context
`

    // 调用 LLM
    const messages = [{ role: 'user', content: userMessage }]
    const stream = this.provider.stream(messages, [], { systemPrompt })
    const processor = new StreamProcessor()
    const result = await processor.process(stream)

    // 解析委派决策
    const delegation = this.parseDelegation(result.text)

    // 验证 Agent 是否存在
    if (!this.agentRegistry.get(delegation.agentId)) {
      throw new Error(`Agent 不存在: ${delegation.agentId}`)
    }

    return delegation
  }

  async delegate(delegation: AgentDelegation): Promise<string> {
    const { agentId, context } = delegation

    // 获取配置
    const agentConfig = this.agentRegistry.get(agentId)!

    // 创建 Worker Agent
    const workerAgent = new ConfigurableWorkerAgent(
      agentConfig,
      this.globalSkillRegistry,
      this.globalToolRegistry,
      this.providers,
    )

    // 执行任务
    const result = await workerAgent.run(context)

    return result
  }

  private parseDelegation(text: string): AgentDelegation {
    // 提取 JSON 代码块
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/)
    if (!jsonMatch) {
      throw new Error('无法解析委派决策：未找到 JSON')
    }

    const delegation = JSON.parse(jsonMatch[1])

    // 验证必填字段
    if (!delegation.agentId || !delegation.context?.task) {
      throw new Error('委派决策格式错误')
    }

    return delegation
  }
}
```

#### 验收标准
- [ ] `analyze()` 能正确分析意图
- [ ] LLM 返回的 JSON 能正确解析
- [ ] `delegate()` 能创建 WorkerAgent 并执行
- [ ] 错误情况能正确处理（Agent 不存在、JSON 解析失败）

---

### Task 6: ChatSession 集成 (0.5 天)

#### 文件
- `src/session/ChatSession.ts` - 修改

#### 实现要点

```typescript
export class ChatSession {
  private agentRegistry: AgentRegistry
  private orchestrator: OrchestratorAgent

  async init() {
    // ... 现有初始化逻辑 ...

    // 初始化 AgentRegistry
    this.agentRegistry = new AgentRegistry()
    await this.agentRegistry.init()

    // 初始化 Orchestrator
    this.orchestrator = new OrchestratorAgent(
      this.provider,
      this.agentRegistry,
      this.memoryManager,
      this.skillRegistry,
      this.registry,
      this.providers,
    )
  }

  async run(userMessage: string) {
    // 1. Orchestrator 分析意图
    const delegation = await this.orchestrator.analyze(userMessage)

    // 发送委派事件
    this.emit('agent:delegation', {
      agentId: delegation.agentId,
      task: delegation.context.task,
    })

    // 2. 委派给 Worker Agent
    const result = await this.orchestrator.delegate(delegation)

    // 3. 返回结果
    this.emit('text', result)
  }
}
```

#### 验收标准
- [ ] ChatSession 能初始化 AgentRegistry
- [ ] ChatSession 能初始化 Orchestrator
- [ ] `run()` 方法能正确委派任务
- [ ] 发送 `agent:delegation` 事件

---

### Task 7: 内置 Agent 配置 (0.5 天)

#### 文件
- `src/core/agent/builtin/business-agent.yaml` - 新增
- `src/core/agent/builtin/life-assistant.yaml` - 新增
- `src/core/agent/builtin/code-agent.yaml` - 新增

#### business-agent.yaml

```yaml
id: business-agent
name: 商务助理
version: 1.0.0
description: |
  专注于商务接待、会议安排、关系维护等任务。

tags: [商务, 餐饮, 会议, 接待]

capabilities:
  - 根据客户身份和偏好推荐餐厅
  - 预订高端餐厅和会议室

skills:
  builtin: [xuanji-assistant, security-rules]
  custom:
    - id: business-etiquette
      name: 商务礼仪规范
      category: prompt
      content: |
        # 商务礼仪规范

        ## 餐厅选择原则
        1. 地理位置：距离客户 3km 内
        2. 菜系偏好：优先熟悉菜系

knowledgeBase:
  path: ~/.xuanji/agents/business-agent/knowledge
  sources: []
  embedding:
    enabled: false

tools:
  - name: web_search
  - name: booking
  - name: calendar
  - name: knowledge_query

systemPrompt: |
  你是 Xuanji 的商务助理，专注于商务活动策划和执行。

model:
  primary: sonnet

execution:
  maxIterations: 20
  timeout: 600

permissions:
  allowFileRead: true
  allowFileWrite: false
  allowBashExecution: false
  allowNetworkAccess: true

enabled: true
```

#### 验收标准
- [ ] 3 个内置 Agent 配置文件创建完成
- [ ] YAML 格式正确
- [ ] AgentRegistry 能正确加载

---

## 二、集成测试

### 测试场景 1: 商务助理 Agent

**输入**:
```
用户：帮我预订今晚招待王总的餐厅
```

**预期流程**:
1. ChatSession.run() → OrchestratorAgent.analyze()
2. 检索全局记忆库：王总（假设找到：华为 CEO，喜欢粤菜）
3. LLM 分析 → 选择 business-agent
4. OrchestratorAgent.delegate() → ConfigurableWorkerAgent
5. ConfigurableWorkerAgent.run()
   - 检索专属知识库（假设为空）
   - 调用工具：web_search("粤菜餐厅 推荐")
   - 返回结果
6. ChatSession 输出结果

**预期输出**:
```
已为您搜索到以下粤菜餐厅：
1. 顺德人家（国贸店）- 粤菜，人均 600 元
2. ...

请选择一家餐厅，我将为您预订。
```

### 测试场景 2: 代码 Agent

**输入**:
```
用户：帮我重构 AgentRegistry 的 loadAgentConfig 方法
```

**预期流程**:
1. Orchestrator 分析 → 选择 code-agent
2. code-agent 执行
   - read_file(AgentRegistry.ts)
   - 分析代码
   - 提出重构建议
3. 返回结果

**预期输出**:
```
建议重构 loadAgentConfig 方法：

1. 提取配置验证到单独方法
2. 提取 YAML/JSON 解析逻辑
3. 添加错误处理

重构后的代码：
...
```

---

## 三、验收清单

### 功能完整性
- [ ] AgentRegistry 能扫描并加载所有配置
- [ ] ConfigurableWorkerAgent 能正确初始化专属资源
- [ ] KnowledgeQueryTool 能查询专属知识库
- [ ] OrchestratorAgent 能正确分析意图并委派
- [ ] ChatSession 能完整运行 Orchestrator 模式
- [ ] 内置 Agent 配置正确且能加载

### 代码质量
- [ ] 所有代码通过 TypeScript 编译
- [ ] 所有代码通过 ESLint 检查
- [ ] 关键方法有注释说明
- [ ] 错误处理完善

### 测试覆盖
- [ ] 集成测试场景 1 通过
- [ ] 集成测试场景 2 通过
- [ ] 配置文件验证测试通过

---

## 四、风险与挑战

### 风险 1: 知识库加载性能
**影响**: 大量数据源可能导致初始化慢
**缓解**:
- 懒加载（首次使用时加载）
- 异步初始化
- 显示加载进度

### 风险 2: LLM 委派决策不准确
**影响**: 选择错误的 Agent
**缓解**:
- 提供清晰的 Agent 描述
- 提供 Few-shot 示例
- 记录委派历史供参考

### 风险 3: 配置文件格式错误
**影响**: Agent 无法加载
**缓解**:
- 严格的 Schema 验证
- 友好的错误提示
- 提供配置模板

---

## 五、后续工作

完成 Phase 0 后，进入 Phase 1（GUI 配置界面），主要任务：
1. AgentManager 组件
2. AgentEditor 组件
3. AgentDetail 组件
4. IPC 接口扩展
