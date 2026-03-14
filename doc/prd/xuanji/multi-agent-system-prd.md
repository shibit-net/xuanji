# Multi-Agent System - 可配置专家代理系统

**版本**: 1.0.0
**作者**: Claude & Kevin Shi
**日期**: 2026-03-14
**状态**: 设计中

---

## 一、项目概述

### 1.1 背景

当前 Xuanji 架构采用**单一 Agent + Skill 路由**模式：
- ChatSession 直接调用 AgentLoop
- 通过 VectorSkillMatcher 进行意图路由
- 所有任务由同一个 Agent 执行

**存在的问题**：
1. **领域知识混杂**：商务、生活、代码等不同领域的 Skill 共享同一个上下文
2. **工具权限难控制**：所有 Skill 共享同一个工具集，无法细粒度隔离
3. **知识库无法专业化**：全局记忆库存储所有类型信息，检索效率低
4. **扩展性差**：新增领域需要修改核心代码

### 1.2 目标

设计一个**可配置的多 Agent 系统**，实现：
- ✅ **Agent 资源隔离**：每个 Agent 拥有独立的 Skills、知识库、工具集、System Prompt
- ✅ **配置驱动创建**：用户通过 YAML 配置文件创建自定义 Agent
- ✅ **自动意图路由**：管家 Agent 自动识别并委派给合适的 Worker Agent
- ✅ **GUI 可视化管理**：Agent 配置、知识库、执行过程可视化

### 1.3 核心概念

```
┌─────────────────────────────────────────┐
│       Orchestrator Agent (管家)          │
│  - 全局 Skills                           │
│  - 全局 Memory                           │
│  - 无工具（仅分析和委派）                 │
└───────────────┬─────────────────────────┘
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│Business │ │  Life   │ │  Code   │
│ Agent   │ │Assistant│ │ Agent   │
└─────────┘ └─────────┘ └─────────┘

每个 Worker Agent 独立拥有：
├─ 专属 SkillRegistry
├─ 专属 MemoryManager
├─ 专属 ToolRegistry
└─ 专属 SystemPrompt
```

---

## 二、功能需求

### 2.1 Agent 配置系统

#### 配置文件格式
- 支持 YAML/JSON 格式
- 三层配置优先级：
  - `~/.xuanji/agents/` - 全局 Agent（所有项目共享）
  - `.xuanji/agents/` - 项目级 Agent（仅当前项目）
  - `src/core/agent/builtin/` - 内置 Agent（系统自带）
  - 优先级：项目级 > 全局 > 内置

#### 配置项
```yaml
# 基础信息
id: business-agent
name: 商务助理
version: 1.0.0
description: |
  专注于商务接待、会议安排、关系维护

# 意图匹配
tags: [商务, 餐饮, 会议]
capabilities:
  - 根据客户身份推荐餐厅
  - 预订高端餐厅和会议室

# 专属 Skills
skills:
  builtin: [xuanji-assistant, security-rules]
  custom:
    - id: business-etiquette
      content: |
        # 商务礼仪规范
        ...

# 专属知识库
knowledgeBase:
  path: ~/.xuanji/agents/business-agent/knowledge
  sources:
    - type: csv
      path: contacts.csv
    - type: json
      path: restaurants.json
  embedding:
    enabled: true

# 专属工具
tools:
  - name: web_search
    config:
      provider: google
  - name: booking
  - name: knowledge_query

# System Prompt
systemPrompt: |
  你是 Xuanji 的商务助理...

# 模型/执行/权限配置
model:
  primary: sonnet
execution:
  maxIterations: 20
  timeout: 600
permissions:
  allowFileWrite: false
  allowBashExecution: false
```

### 2.2 知识库系统

#### 数据源支持
- **CSV**: 结构化数据（联系人、餐厅列表）
- **JSON**: 半结构化数据（配置、记录）
- **Markdown**: 文档知识（会议记录、规范）
- **PDF**: 外部文档（合同、报告）

#### 向量检索
- 本地 Embedding 模型：`all-MiniLM-L6-v2`
- 存储：SQLite + sqlite-vec
- 混合检索：向量相似度 + 关键词 + 时效性

#### 专属工具
- `knowledge_query` 工具：查询当前 Agent 的知识库
- 不能跨 Agent 查询（资源隔离）

### 2.3 Orchestrator Agent

#### 职责
1. 接收用户意图
2. 从全局记忆库检索上下文（人物信息、项目知识）
3. 调用 LLM 分析意图，选择合适的 Worker Agent
4. 委派任务并传递上下文
5. 汇总结果返回用户

#### 委派决策
```typescript
interface AgentDelegation {
  reasoning: string           // 为什么选择这个 Agent
  agentId: string            // 选择的 Agent ID
  context: {
    task: string             // 提取的核心任务
    constraints: string[]    // 约束条件
    preferences: object      // 偏好设置
  }
  collaborative: boolean     // 是否需要多 Agent 协作
  agentIds?: string[]        // 协作的 Agent 列表
}
```

### 2.4 GUI 管理界面

#### Agent 管理器
- **左侧边栏**: 会话列表 / Agent 管理 / 设置
- **Agent 列表**: 分组显示（内置/全局/项目），支持搜索
- **Agent 详情**: 查看配置、能力、工具、权限
- **Agent 编辑器**: 可视化配置界面（表单 + YAML 预览）

#### Agent 工作台（右侧面板新增标签）
- **当前执行**: 显示活跃 Agent 和执行时长
- **任务列表**: Worker Agent 任务队列（pending/running/success/error）
- **工具使用**: 当前 Agent 的工具调用列表
- **执行历史**: 最近 10 次 Agent 执行记录

#### 知识库管理
- **数据源列表**: 显示所有知识源（类型、路径、大小）
- **知识库搜索**: 搜索知识库内容
- **数据源添加**: 上传文件或配置路径

---

## 三、技术设计

### 3.1 核心模块

#### AgentRegistry
```typescript
class AgentRegistry {
  private agents: Map<string, AgentConfig>

  async init()                              // 扫描所有配置目录
  register(config: AgentConfig)             // 注册 Agent
  get(id: string): AgentConfig              // 获取配置
  getEnabled(): AgentConfig[]               // 获取所有启用的 Agent
  getAgentListForPrompt(): string           // 生成给 Orchestrator 的 Agent 列表
  reload()                                  // 热重载
}
```

#### OrchestratorAgent
```typescript
class OrchestratorAgent {
  async analyze(userMessage: string): Promise<AgentDelegation>
  async delegate(delegation: AgentDelegation): Promise<string>
  private createWorkerAgent(config: AgentConfig): WorkerAgent
}
```

#### ConfigurableWorkerAgent
```typescript
class ConfigurableWorkerAgent extends WorkerAgent {
  private skillRegistry: SkillRegistry       // 专属 Skill Registry
  private memoryManager: IMemoryStore        // 专属知识库
  private toolRegistry: IToolRegistry        // 专属工具集

  private buildSkillRegistry(): SkillRegistry
  private buildMemoryManager(): IMemoryStore
  private buildToolRegistry(): IToolRegistry
  async run(context: AgentContext): Promise<string>
}
```

#### KnowledgeQueryTool
```typescript
class KnowledgeQueryTool implements ITool {
  name = 'knowledge_query'

  async execute(input: {
    query: string
    sources?: string[]
    maxResults?: number
  }): Promise<ToolResult>
}
```

### 3.2 数据流

```
用户输入 "帮我预订今晚招待王总的餐厅"
  │
  ▼
ChatSession.run()
  │
  ▼
OrchestratorAgent.analyze()
  ├─ 检索全局记忆库："王总" 的信息
  ├─ 调用 LLM 分析意图
  └─ 返回委派决策：{ agentId: 'business-agent', ... }
  │
  ▼
OrchestratorAgent.delegate()
  │
  ▼
ConfigurableWorkerAgent (business-agent)
  ├─ 加载专属 Skills
  ├─ 检索专属知识库（contacts.csv, restaurants.json）
  ├─ 创建 AgentLoop（专属 SkillRegistry + ToolRegistry）
  ├─ 执行任务（ReAct 循环）
  │   ├─ knowledge_query(query: "王总")
  │   ├─ web_search("粤菜餐厅 国贸")
  │   └─ booking({ restaurant: "顺德人家", time: "18:30" })
  └─ 返回结果
  │
  ▼
左侧对话区：显示简洁结论
右侧工作台：显示执行过程（Agent/工具/日志）
```

### 3.3 资源目录结构

```
~/.xuanji/agents/business-agent/
├── config.yaml                  # Agent 配置
├── knowledge/                   # 专属知识库
│   ├── vector.db               # 向量数据库
│   ├── contacts.csv            # 联系人
│   ├── restaurants.json        # 餐厅列表
│   └── meeting-history/        # 会议记录
├── templates/                   # 邮件模板
│   └── meeting-invite.html
└── logs/                        # 执行日志
    └── 2026-03-14.log
```

### 3.4 流式事件扩展

新增 Agent 相关事件：
- `agent:delegation` - 委派事件（显示选择的 Agent）
- `agent:worker-start` - Worker 开始执行
- `agent:worker-end` - Worker 执行完成
- `agent:worker-tool` - Worker 工具调用

---

## 四、实施计划

### Phase 0: 核心基础设施 (4-5 天)

**目标**: 让第一个完整的配置驱动 Agent 跑起来

**任务**:
1. **类型定义** (0.5 天)
   - [ ] `AgentConfig` 完整类型定义
   - [ ] `CustomSkill`, `KnowledgeSource`, `ToolConfig` 类型
   - [ ] `AgentDelegation`, `AgentContext` 类型

2. **AgentRegistry** (1 天)
   - [ ] 扫描配置目录（builtin/global/project）
   - [ ] 加载 YAML/JSON 配置
   - [ ] 配置验证
   - [ ] 热重载（监听文件变更）
   - [ ] `getAgentListForPrompt()` 方法

3. **ConfigurableWorkerAgent** (2 天)
   - [ ] `buildSkillRegistry()` - 加载 builtin + custom Skills
   - [ ] `buildMemoryManager()` - 创建专属知识库
   - [ ] `buildToolRegistry()` - 过滤工具 + 注入配置
   - [ ] `loadKnowledgeSource()` - CSV/JSON/Markdown 加载器
   - [ ] `run()` - 执行任务（集成专属资源）

4. **KnowledgeQueryTool** (0.5 天)
   - [ ] 工具定义和 Schema
   - [ ] `execute()` 方法（查询专属知识库）
   - [ ] 格式化输出

5. **OrchestratorAgent** (1 天)
   - [ ] `analyze()` - 意图分析和委派决策
   - [ ] `delegate()` - 创建 WorkerAgent 并执行
   - [ ] `createWorkerAgent()` - 根据配置实例化
   - [ ] `parseDelegation()` - 解析 LLM 返回的 JSON

6. **ChatSession 集成** (0.5 天)
   - [ ] 初始化 AgentRegistry
   - [ ] 初始化 OrchestratorAgent
   - [ ] `run()` 方法改造（Orchestrator 模式）

7. **内置 Agent 配置** (0.5 天)
   - [ ] `business-agent.yaml`
   - [ ] `life-assistant.yaml`
   - [ ] `code-agent.yaml`

**验收标准**:
- ✅ 可通过 YAML 配置创建 Agent
- ✅ Agent 拥有专属 Skills、知识库、工具
- ✅ Orchestrator 能正确分析意图并委派
- ✅ Worker Agent 能执行任务并返回结果
- ✅ CLI 模式下能正常使用

---

### Phase 1: GUI 配置界面 (3-4 天)

**目标**: 用户可通过 GUI 创建、管理、测试 Agent

**任务**:
1. **Sidebar 扩展** (0.5 天)
   - [ ] 新增"Agent 管理"视图切换按钮
   - [ ] 路由逻辑（chat/agents/settings）

2. **AgentManager 组件** (1 天)
   - [ ] 左侧：Agent 列表（分组：内置/全局/项目）
   - [ ] 右侧：Agent 详情/编辑器切换
   - [ ] 搜索功能
   - [ ] 创建 Agent 按钮

3. **AgentEditor 组件** (1.5 天)
   - [ ] 基础信息（id/name/description）
   - [ ] 意图匹配（tags/capabilities）
   - [ ] Skills 配置（builtin 选择 + custom 编辑器）
   - [ ] 知识库配置（数据源列表）
   - [ ] 工具配置（勾选 + 自定义配置）
   - [ ] System Prompt 编辑器
   - [ ] 模型/执行/权限配置
   - [ ] YAML 预览
   - [ ] 保存/取消

4. **AgentDetail 组件** (0.5 天)
   - [ ] 只读展示所有配置
   - [ ] 编辑/删除按钮（内置 Agent 不可删除）
   - [ ] 测试按钮

5. **AgentTestDialog 组件** (0.5 天)
   - [ ] 测试输入框
   - [ ] 运行测试按钮
   - [ ] 结果展示（Markdown + 工具调用）

6. **IPC 接口** (0.5 天)
   - [ ] `agent:list` - 获取 Agent 列表
   - [ ] `agent:get` - 获取 Agent 配置
   - [ ] `agent:create` - 创建 Agent
   - [ ] `agent:update` - 更新 Agent
   - [ ] `agent:delete` - 删除 Agent
   - [ ] `agent:test` - 测试 Agent

7. **chatStore 扩展** (0.5 天)
   - [ ] `agents` 状态
   - [ ] `selectedAgent` 状态
   - [ ] CRUD 操作方法

**验收标准**:
- ✅ 可通过 GUI 创建 Agent（表单填写）
- ✅ 可编辑/删除 Agent（全局/项目级）
- ✅ 可测试 Agent（独立对话）
- ✅ 配置实时保存到 YAML 文件
- ✅ 内置 Agent 不可编辑/删除

---

### Phase 2: Agent 工作台可视化 (2-3 天)

**目标**: 右侧面板展示 Agent 执行过程

**任务**:
1. **RightPanel 扩展** (0.5 天)
   - [ ] 新增"Agent 工作台"标签
   - [ ] 标签切换逻辑

2. **AgentWorkspaceTab 组件** (1 天)
   - [ ] 当前执行区域（Agent 名称 + 耗时）
   - [ ] 任务列表（pending/running/success/error）
   - [ ] 工具使用统计（当前 Agent）
   - [ ] 执行历史（最近 10 次）

3. **流式事件扩展** (0.5 天)
   - [ ] `agent:delegation` 事件
   - [ ] `agent:worker-start` 事件
   - [ ] `agent:worker-end` 事件
   - [ ] `agent:worker-tool` 事件

4. **chatStore 扩展** (0.5 天)
   - [ ] `currentAgent` 状态（活跃 Agent）
   - [ ] `workerTasks` 状态（任务列表）
   - [ ] `agentHistory` 状态（历史记录）
   - [ ] 监听新事件并更新状态

5. **左侧对话区优化** (0.5 天)
   - [ ] 折叠分析过程（`<details>`）
   - [ ] 显示委派标签（`[📋 委派给: business-agent]`）
   - [ ] 精简展示（问题 + 结论）

**验收标准**:
- ✅ 左侧显示简洁的问题和结论
- ✅ 右侧实时显示 Agent 执行状态
- ✅ 工具调用在右侧工作台可见
- ✅ 任务列表显示所有 Worker 状态
- ✅ 执行历史可追溯

---

### Phase 3: 知识库增强 (3-5 天)

**目标**: 知识库管理界面 + 更多数据源支持

**任务**:
1. **知识库管理界面** (1.5 天)
   - [ ] 数据源列表（类型/路径/大小）
   - [ ] 添加数据源（上传文件/配置路径）
   - [ ] 删除数据源
   - [ ] 知识库搜索（实时搜索）
   - [ ] 知识条目查看/编辑

2. **PDF 数据源支持** (1 天)
   - [ ] 依赖安装：`pdf-parse`
   - [ ] `loadPDF()` 方法
   - [ ] PDF 文本提取
   - [ ] 分块存储（chunk + overlap）

3. **SQL 数据源支持** (1 天)
   - [ ] 数据库连接配置（MySQL/PostgreSQL/SQLite）
   - [ ] `loadSQL()` 方法
   - [ ] 查询结果转换为知识条目

4. **API 数据源支持** (1 天)
   - [ ] HTTP API 配置（URL/Method/Auth）
   - [ ] `loadAPI()` 方法
   - [ ] 定时同步（cron）

5. **知识库自动同步** (0.5 天)
   - [ ] 文件监听（chokidar）
   - [ ] 增量更新（检测变更）
   - [ ] 同步日志

**验收标准**:
- ✅ 可通过 GUI 管理知识库数据源
- ✅ 支持 CSV/JSON/Markdown/PDF 数据源
- ✅ 知识库搜索功能正常
- ✅ 文件变更自动同步
- ✅ 增量更新（不重复导入）

---

### Phase 4: 高级特性 (1-2 周)

**目标**: Agent 协作、自我学习、Marketplace

**任务**:
1. **Agent 协作编排** (3 天)
   - [ ] DAG 工作流定义
   - [ ] 顺序执行（Task1 → Task2 → Task3）
   - [ ] 并行执行（Task1 & Task2 → Task3）
   - [ ] 条件分支（if/else）
   - [ ] Agent 间数据传递

2. **Agent 自我学习** (3 天)
   - [ ] 从对话中提取知识（LLM 总结）
   - [ ] 自动更新知识库
   - [ ] 从失败中学习（错误案例存储）
   - [ ] 自动优化 System Prompt

3. **Agent Marketplace** (4 天)
   - [ ] Agent 导出（打包配置 + 知识库）
   - [ ] Agent 导入（解压 + 安装）
   - [ ] 社区 Agent 浏览（GitHub/Registry）
   - [ ] Agent 版本管理（Git 集成）

4. **Agent 性能监控** (2 天)
   - [ ] 执行时长统计
   - [ ] 成功率统计
   - [ ] 成本统计（Token 消耗）
   - [ ] 性能仪表盘

**验收标准**:
- ✅ 支持多 Agent 协作（顺序/并行）
- ✅ Agent 能从对话中学习
- ✅ 可导入/导出 Agent
- ✅ 性能监控仪表盘可用

---

## 五、示例配置

### 5.1 商务助理 Agent

```yaml
id: business-agent
name: 商务助理
version: 1.0.0
description: 专注于商务接待、会议安排、关系维护

tags: [商务, 餐饮, 会议, 接待]

capabilities:
  - 根据客户身份和偏好推荐餐厅
  - 预订高端餐厅和会议室
  - 管理商务日程和提醒

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
        3. 环境要求：私密、安静、高档
        4. 价格定位：300-800 元/人

knowledgeBase:
  path: ~/.xuanji/agents/business-agent/knowledge
  sources:
    - type: csv
      path: contacts.csv
      description: 客户联系人（职位、偏好、过敏）
    - type: json
      path: restaurants.json
      description: 推荐餐厅列表
  embedding:
    enabled: true
    model: all-MiniLM-L6-v2

tools:
  - name: web_search
    config:
      provider: google
  - name: booking
  - name: calendar
  - name: email
  - name: knowledge_query

systemPrompt: |
  你是 Xuanji 的商务助理，专注于商务活动策划和执行。

  工作流程：
  1. 从专属知识库检索客户信息
  2. 根据礼仪规范制定 2-3 个方案
  3. 检查日历冲突
  4. 执行预订并发送确认

model:
  primary: sonnet

execution:
  maxIterations: 20
  timeout: 600

permissions:
  allowFileWrite: false
  allowBashExecution: false
  allowNetworkAccess: true

enabled: true
```

### 5.2 代码审查 Agent（项目级）

```yaml
id: code-reviewer
name: 代码审查专家
version: 1.0.0
description: 遵循项目编码规范，审查代码质量

tags: [代码审查, 质量检查]

capabilities:
  - 审查代码风格和规范
  - 发现潜在 Bug 和安全漏洞
  - 提出重构建议

skills:
  builtin: [xuanji-assistant, security-rules]
  custom:
    - id: coding-standards
      name: 项目编码规范
      category: prompt
      content: |
        # Xuanji 项目编码规范

        ## TypeScript 规范
        - 使用 ESLint + Prettier
        - 禁止 any 类型
        - 导出接口使用 PascalCase

        ## 测试规范
        - 核心模块覆盖率 > 80%
        - 使用 Vitest 框架

knowledgeBase:
  path: .xuanji/agents/code-reviewer/knowledge
  sources:
    - type: markdown
      path: coding-standards.md
    - type: markdown
      path: architecture-decisions.md

tools:
  - name: read_file
  - name: grep
  - name: glob
  - name: bash
  - name: write_file

systemPrompt: |
  你是 Xuanji 的代码审查专家。

  审查维度：
  1. 代码风格
  2. 安全性
  3. 性能
  4. 可维护性
  5. 测试覆盖率

model:
  primary: sonnet

execution:
  maxIterations: 20
  timeout: 600

permissions:
  allowFileWrite: true
  allowBashExecution: true

enabled: true
```

---

## 六、技术挑战与解决方案

### 6.1 知识库隔离

**挑战**: 多个 Agent 的知识库可能包含相同数据（如"王总"信息）

**解决方案**:
- 全局记忆库存储通用信息（人物、项目知识）
- Agent 知识库存储领域专属信息（餐厅列表、技术规范）
- Orchestrator 负责将全局信息注入到委派上下文

### 6.2 Agent 选择准确性

**挑战**: LLM 可能选择错误的 Agent

**解决方案**:
- 提供清晰的 Agent 描述（name/description/capabilities）
- 提供 Few-shot 示例（examples 字段）
- 支持用户显式指定 Agent（`@business-agent 帮我...`）
- 记录委派历史，供 LLM 参考

### 6.3 知识库同步性能

**挑战**: 大量文件监听可能影响性能

**解决方案**:
- 使用 chokidar 去重
- 批量更新（debounce）
- 后台异步同步
- 增量更新（仅处理变更部分）

### 6.4 Agent 配置验证

**挑战**: 用户配置错误导致 Agent 无法运行

**解决方案**:
- 严格的 Schema 验证（JSON Schema）
- 配置文件保存前预检
- 友好的错误提示
- 配置模板和示例

---

## 七、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| LLM 委派决策错误 | 中 | 高 | Few-shot 示例 + 用户反馈机制 |
| 知识库加载性能 | 低 | 中 | 懒加载 + 缓存 + 增量更新 |
| Agent 配置复杂度 | 高 | 中 | GUI 配置界面 + 模板 + 文档 |
| 多 Agent 通信开销 | 低 | 低 | 本地调用，无网络通信 |
| 知识库数据安全 | 中 | 高 | 加密存储 + 权限控制 |

---

## 八、后续演进方向

1. **Agent 插件市场**：类似 VS Code Extension Marketplace
2. **Agent 自动调参**：根据执行结果自动优化 System Prompt
3. **Agent 联邦学习**：多 Agent 共享知识但保护隐私
4. **Agent 版本回滚**：Git 集成，支持配置版本管理
5. **Agent 性能优化**：缓存、预加载、并行执行

---

## 九、参考资料

- [AutoGPT Architecture](https://github.com/Significant-Gravitas/AutoGPT)
- [LangChain Multi-Agent](https://python.langchain.com/docs/use_cases/multi_agent)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [sqlite-vec Documentation](https://github.com/asg017/sqlite-vec)
