# 自定义 SubAgent 扩展指南

本文档介绍如何创建自定义 SubAgent，扩展璇玑的能力。

---

## 快速开始

### 1. 创建配置文件

**位置选择**：

| 位置 | 作用域 | 优先级 |
|------|-------|-------|
| `~/.xuanji/agents/my-agent.json5` | 全局（所有项目） | 中 |
| `.xuanji/agents/my-agent.json5` | 当前项目 | 高（覆盖全局） |

**示例**：创建股票分析 SubAgent

```bash
# 创建全局配置
mkdir -p ~/.xuanji/agents
vi ~/.xuanji/agents/stock-analyst.json5
```

配置内容参考：`doc/examples/custom-subagent-example.json5`

---

### 2. 关键字段说明

#### 必填字段

```json5
{
  id: 'stock-analyst',              // ✅ 唯一标识（在 TaskTool 中使用）
  name: '股票分析师',               // ✅ 显示名称
  description: '...',               // ✅ 描述
  systemPrompt: '...',              // ✅ 定义 Agent 行为
  tools: [...],                     // ✅ 工具列表
  model: { primary: '...' },        // ✅ 模型配置
  execution: {...},                 // ✅ 执行配置
  permissions: {...},               // ✅ 权限配置
  metadata: { isSubAgent: true },   // ✅ 标记为 SubAgent
}
```

#### SubAgent 特殊标记

**关键**：必须设置 `metadata.isSubAgent = true`

```json5
metadata: {
  isSubAgent: true,  // ✅ 标记为 SubAgent（可被 TaskTool 使用）
  builtin: false,    // 非内置
  category: 'finance',  // 自定义分类
}
```

---

### 3. SystemPrompt 最佳实践

**结构化提示词**：

```
你是一个专业的 {领域} Agent。

你的职责：
- {职责1}
- {职责2}
- {职责3}

约束：
- {约束1}（如：不能访问网络）
- {约束2}（如：只能只读）
- {约束3}

方法：
1. {步骤1}
2. {步骤2}
3. {步骤3}
```

**示例**：

```json5
systemPrompt: `你是一个专业的文档生成 Agent。

你的职责：
- 分析代码生成 API 文档
- 提取函数签名和注释
- 生成 Markdown 格式文档
- 保持文档与代码同步

约束：
- 只读代码，不修改任何文件
- 文档输出到指定路径
- 遵循项目文档规范

方法：
1. 使用 glob/grep 搜索代码文件
2. 使用 read_file 读取代码
3. 提取关键信息（函数/类/接口）
4. 生成结构化 Markdown
5. 使用 write_file 输出文档`,
```

---

### 4. 工具选择指南

**只读 SubAgent**（探索/分析）：

```json5
tools: [
  { name: 'read_file', required: true },
  { name: 'glob', required: true },
  { name: 'grep', required: true },
  { name: 'ls', required: false },
  { name: 'ask_user', required: true },
],
permissions: {
  fileRead: 'always',
  fileWrite: 'deny',   // 禁止写入
  bashExec: 'deny',    // 禁止命令
  network: 'ask',
}
```

**读写 SubAgent**（代码编写/文档生成）：

```json5
tools: [
  { name: 'read_file', required: true },
  { name: 'write_file', required: true },
  { name: 'edit_file', required: true },
  { name: 'bash', required: true },
  { name: 'glob', required: true },
  { name: 'grep', required: true },
],
permissions: {
  fileRead: 'always',
  fileWrite: 'ask',    // 写入需要确认
  bashExec: 'ask',     // 命令需要确认
  network: 'deny',
}
```

**网络 SubAgent**（数据获取/API 调用）：

```json5
tools: [
  { name: 'web_fetch', required: true },
  { name: 'bash', required: true },
  { name: 'read_file', required: true },
  { name: 'write_file', required: true },
],
permissions: {
  fileRead: 'always',
  fileWrite: 'ask',
  bashExec: 'ask',
  network: 'always',   // 需要网络访问
}
```

---

### 5. 模型选择建议

| 任务复杂度 | 推荐模型 | 示例场景 |
|-----------|---------|---------|
| **低** | Haiku | 快速搜索、简单分析、数据提取 |
| **中** | Sonnet | 代码生成、文档编写、数据处理 |
| **高** | Opus | 架构设计、复杂推理、辩论讨论 |

```json5
// 快速探索（Haiku）
model: {
  primary: '[CC]claude-haiku-4-5-20251001',
  fallback: '[CC]claude-haiku-4-5-20251001',
  maxTokens: 16000,
}

// 代码编写（Sonnet/Opus）
model: {
  primary: '[CC]claude-opus-4-6',
  fallback: '[CC]claude-sonnet-4-5-20250929',
  maxTokens: 32000,
}
```

---

### 6. 使用自定义 SubAgent

#### 方式1：通过 TaskTool

**修改 TaskTool 的 enum**：

```typescript
// src/core/tools/TaskTool.ts
subagent_type: {
  type: 'string',
  enum: [
    'general-purpose',
    'explore',
    'plan',
    'coder',
    'stock-analyst',  // ✅ 添加你的 Agent
  ],
}
```

**使用**：

```typescript
{
  tool: 'task',
  input: {
    description: '分析腾讯股票的近期表现',
    subagent_type: 'stock-analyst',
  }
}
```

#### 方式2：动态加载（推荐）

**无需修改 TaskTool**，AgentRegistry 自动加载：

```typescript
// SubAgentContext.ts
export type AgentRoleType = string;  // 改为 string，支持任意 ID
```

**使用**：

```
用户："用 stock-analyst agent 分析腾讯股票"
璇玑：[调用 TaskTool，subagent_type='stock-analyst']
```

---

## 完整示例

### 示例1：文档生成 Agent

**配置**：`~/.xuanji/agents/doc-generator.json5`

```json5
{
  id: 'doc-generator',
  name: 'API 文档生成器',
  description: '自动从代码生成 API 文档',

  model: {
    primary: '[CC]claude-sonnet-4-5-20250929',
    maxTokens: 32000,
  },

  systemPrompt: `你是 API 文档生成专家。

职责：
- 分析代码提取 API 端点
- 提取参数、返回值、示例
- 生成 OpenAPI/Swagger 格式文档

输出：
- docs/api.md（Markdown 格式）
- docs/openapi.yaml（OpenAPI 规范）`,

  tools: [
    { name: 'read_file', required: true },
    { name: 'write_file', required: true },
    { name: 'glob', required: true },
    { name: 'grep', required: true },
  ],

  execution: {
    mode: 'react',
    maxIterations: 40,
    timeout: 600000,  // 10 分钟
  },

  permissions: {
    fileRead: 'always',
    fileWrite: 'ask',
    bashExec: 'deny',
    network: 'deny',
    allowedPaths: ['docs/'],  // 只能写入 docs 目录
  },

  metadata: {
    isSubAgent: true,
    category: 'documentation',
  },

  tags: ['subagent', 'documentation', 'api'],
  enabled: true,
}
```

**使用**：

```
用户："用 doc-generator agent 生成 API 文档"
```

---

### 示例2：代码审查 Agent

**配置**：`~/.xuanji/agents/security-reviewer.json5`

```json5
{
  id: 'security-reviewer',
  name: '安全审查员',
  description: '专注于代码安全漏洞检测',

  model: {
    primary: '[CC]claude-opus-4-6',  // 安全审查需要复杂推理
    maxTokens: 32000,
  },

  systemPrompt: `你是代码安全专家。

关注点：
- SQL 注入
- XSS 跨站脚本
- CSRF 跨站请求伪造
- 敏感信息泄露
- 权限绕过
- 依赖漏洞

输出格式：
1. 漏洞列表（严重性 + 位置 + 描述）
2. 修复建议（代码示例）
3. 安全评分（0-100）`,

  tools: [
    { name: 'read_file', required: true },
    { name: 'glob', required: true },
    { name: 'grep', required: true },
    { name: 'bash', required: true },  // 运行安全扫描工具
  ],

  execution: {
    mode: 'react',
    maxIterations: 50,
    timeout: 600000,
  },

  permissions: {
    fileRead: 'always',
    fileWrite: 'deny',   // 只读审查
    bashExec: 'ask',     // 运行扫描工具
    network: 'deny',
    allowedCommands: ['npm audit', 'snyk test', 'semgrep'],
  },

  metadata: {
    isSubAgent: true,
    category: 'security',
  },

  tags: ['subagent', 'security', 'code-review'],
  enabled: true,
}
```

---

### 示例3：数据分析 Agent

**配置**：`~/.xuanji/agents/data-analyst.json5`

```json5
{
  id: 'data-analyst',
  name: '数据分析师',
  description: '分析日志、指标、数据库数据',

  model: {
    primary: '[CC]claude-sonnet-4-5-20250929',
    maxTokens: 32000,
  },

  systemPrompt: `你是数据分析专家。

技能：
- 日志分析（错误率、性能瓶颈）
- 统计分析（趋势、异常检测）
- SQL 查询优化
- 可视化建议

输出：
- 分析报告（Markdown）
- 数据图表（ASCII/Mermaid）
- 优化建议`,

  tools: [
    { name: 'read_file', required: true },
    { name: 'write_file', required: true },
    { name: 'bash', required: true },  // 运行数据处理脚本
    { name: 'grep', required: true },
    { name: 'glob', required: true },
  ],

  execution: {
    mode: 'react',
    maxIterations: 40,
    timeout: 600000,
  },

  permissions: {
    fileRead: 'always',
    fileWrite: 'ask',
    bashExec: 'ask',
    network: 'deny',
    allowedCommands: ['python', 'node', 'jq', 'awk'],
  },

  metadata: {
    isSubAgent: true,
    category: 'data',
  },

  tags: ['subagent', 'data', 'analysis'],
  enabled: true,
}
```

---

## 高级功能

### 1. SubAgent 在 Team 中使用

自定义 SubAgent 可以在 TeamTool 中使用：

```typescript
{
  tool: 'agent_team',
  input: {
    strategy: 'sequential',
    members: [
      { id: 'security-reviewer', role: 'security-reviewer' },
      { id: 'performance', role: 'coder' },
      { id: 'doc', role: 'doc-generator' },
    ],
    goal: '全面审查代码'
  }
}
```

---

### 2. SubAgent 配置覆盖

**项目级覆盖全局配置**：

```bash
# 全局配置
~/.xuanji/agents/doc-generator.json5  # 默认生成 Markdown

# 项目配置（覆盖全局）
.xuanji/agents/doc-generator.json5    # 覆盖为生成 OpenAPI
```

---

### 3. 动态模型选择

根据任务复杂度自动选择模型：

```json5
model: {
  primary: '[CC]claude-sonnet-4-5-20250929',
  fallback: '[CC]claude-haiku-4-5-20251001',  // 降级到快速模型
}
```

---

## 注意事项

### 安全性

1. **权限最小化**：SubAgent 只给必要的权限
2. **工具限制**：只注册需要的工具
3. **路径限制**：使用 `allowedPaths` 限制文件访问
4. **命令限制**：使用 `allowedCommands` 限制可执行命令

### 性能

1. **超时设置**：根据任务复杂度设置合理的 timeout
2. **迭代限制**：设置 maxIterations 防止无限循环
3. **模型选择**：简单任务用 Haiku，复杂任务用 Opus

### 可维护性

1. **命名规范**：使用清晰的 id 和 name
2. **文档完整**：description 说明用途
3. **标签分类**：使用 tags 和 category 分类
4. **版本管理**：配置文件纳入版本控制

---

## 故障排查

### Q1: 自定义 Agent 没有生效

**检查**：
1. 配置文件路径是否正确（`~/.xuanji/agents/` 或 `.xuanji/agents/`）
2. JSON5 语法是否正确（逗号、引号）
3. `metadata.isSubAgent` 是否设置为 `true`
4. AgentRegistry 是否重新加载（重启璇玑）

### Q2: TaskTool 找不到自定义 Agent

**解决**：

**方式1**：修改 TaskTool enum（不推荐）

```typescript
// src/core/tools/TaskTool.ts
enum: ['general-purpose', 'explore', 'plan', 'coder', 'your-agent']
```

**方式2**：修改 AgentRoleType 为 string（推荐）

```typescript
// src/core/agent/SubAgentContext.ts
export type AgentRoleType = string;  // 支持任意 ID
```

### Q3: SubAgent 工具不可用

**检查**：
1. `tools` 列表是否包含该工具
2. `permissions` 是否允许（如 fileWrite: 'deny' 会禁用 write_file）
3. FilteredToolRegistry 是否过滤了该工具

---

## 总结

### 新增自定义 SubAgent 的步骤

1. ✅ 创建配置文件（`~/.xuanji/agents/my-agent.json5`）
2. ✅ 设置 `metadata.isSubAgent = true`
3. ✅ 定义 systemPrompt、tools、permissions
4. ✅ 重启璇玑，AgentRegistry 自动加载
5. ✅ 使用："用 my-agent agent 执行任务"

### 无需修改代码

AgentRegistry 会自动扫描和加载所有配置文件，你只需创建配置即可！

---

**更新日期**: 2026-03-15
**版本**: v1.0
