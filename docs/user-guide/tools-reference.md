# 工具参考

> 最后更新：2026-03-10

本文档详细介绍 Xuanji 的所有内置工具及其使用方法。

---

## 目录

- [核心工具](#核心工具)
  - [read_file](#read_file)
  - [write_file](#write_file)
  - [edit_file](#edit_file)
  - [multi_edit](#multi_edit)
  - [bash](#bash)
  - [glob](#glob)
  - [grep](#grep)
- [Web 工具](#web-工具)
  - [web_search](#web_search)
  - [web_fetch](#web_fetch)
- [记忆工具](#记忆工具)
  - [memory_store](#memory_store)
  - [memory_search](#memory_search)
- [提醒工具](#提醒工具)
  - [reminder_set](#reminder_set)
  - [reminder_check](#reminder_check)
- [任务工具](#任务工具)
  - [task](#task)
  - [agent_team](#agent_team)
  - [quick_team](#quick_team)
- [交互工具](#交互工具)
  - [ask_user](#ask_user)
  - [plan_review](#plan_review)
- [其他工具](#其他工具)
  - [notebook_edit](#notebook_edit)
  - [worktree](#worktree)
  - [sleep](#sleep)

---

## 核心工具

### read_file

读取文件内容。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `file_path` | string | ✅ | - | 文件路径（绝对路径） |
| `offset` | number | ❌ | `0` | 起始行号 |
| `limit` | number | ❌ | `2000` | 读取行数 |
| `pages` | string | ❌ | - | PDF 页码范围（如 "1-5"） |

**支持的文件类型**：

- 文本文件（.txt、.md、.json、.ts、.py 等）
- 图片（.png、.jpg、.gif、.svg）
- PDF（.pdf，需指定 `pages` 参数）
- Jupyter Notebook（.ipynb）

**使用示例**：

```typescript
// 读取整个文件
{
  "file_path": "/path/to/file.ts"
}

// 读取部分行
{
  "file_path": "/path/to/large-file.log",
  "offset": 100,
  "limit": 50
}

// 读取 PDF 特定页
{
  "file_path": "/path/to/doc.pdf",
  "pages": "1-5"
}
```

**输出格式**：

```
     1→ const name = 'Xuanji';
     2→ const version = '0.9.0';
     3→
     4→ export { name, version };
```

**注意事项**：

- 大文件（> 2000 行）建议使用 `offset` 和 `limit` 分块读取
- PDF 文件必须指定 `pages` 参数（最多 20 页）
- 图片文件会以 base64 编码展示（多模态模型可视觉理解）

---

### write_file

创建或覆盖文件。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `file_path` | string | ✅ | 文件路径（绝对路径） |
| `content` | string | ✅ | 文件内容 |

**使用示例**：

```typescript
{
  "file_path": "/path/to/hello.md",
  "content": "# Hello, Xuanji!\n\nThis is a test file."
}
```

**输出**：

```
✅ 文件写入成功：/path/to/hello.md
```

**注意事项**：

- **覆盖现有文件前需先使用 `read_file` 读取**（Xuanji 会自动检查）
- 如果文件已存在，内容会被完全覆盖
- 推荐使用 `edit_file` 修改现有文件（仅发送差异）

---

### edit_file

编辑文件的部分内容（精确字符串替换）。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `file_path` | string | ✅ | - | 文件路径（绝对路径） |
| `old_string` | string | ✅ | - | 要替换的字符串 |
| `new_string` | string | ✅ | - | 替换后的字符串 |
| `replace_all` | boolean | ❌ | `false` | 是否替换所有匹配 |

**使用示例**：

```typescript
{
  "file_path": "/path/to/config.json",
  "old_string": "\"version\": \"0.8.0\"",
  "new_string": "\"version\": \"0.9.0\"",
  "replace_all": false
}
```

**输出**（带行号的 diff）：

```diff
/path/to/config.json

  1 │ {
  2 │   "name": "xuanji",
  3 │ -  "version": "0.8.0",
  3 │ +  "version": "0.9.0",
  4 │   "description": "AI Assistant"
  5 │ }

✅ 编辑成功
```

**注意事项**：

- `old_string` 必须在文件中唯一（除非 `replace_all: true`）
- 必须保留原文的缩进（Read 工具输出的格式中，行号后的 tab 不是文件内容）
- 适用于小范围修改（大范围修改使用 `multi_edit` 或 `write_file`）

---

### multi_edit

批量编辑文件（多个独立替换操作）。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `file_path` | string | ✅ | 文件路径（绝对路径） |
| `edits` | array | ✅ | 编辑操作列表 |

**edits 数组元素**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `old_string` | string | ✅ | - | 要替换的字符串 |
| `new_string` | string | ✅ | - | 替换后的字符串 |
| `replace_all` | boolean | ❌ | `false` | 是否替换所有匹配 |

**使用示例**：

```typescript
{
  "file_path": "/path/to/app.ts",
  "edits": [
    {
      "old_string": "const VERSION = '0.8.0';",
      "new_string": "const VERSION = '0.9.0';"
    },
    {
      "old_string": "console.log('old');",
      "new_string": "console.log('new');"
    }
  ]
}
```

**输出**：

```
✅ 批量编辑成功（2 处修改）
```

**注意事项**：

- 所有编辑操作按顺序执行
- 如果任一操作失败，整个事务会回滚

---

### bash

执行 Shell 命令。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `command` | string | ✅ | - | Shell 命令 |
| `description` | string | ✅ | - | 命令描述（简短说明作用） |
| `timeout` | number | ❌ | `120000` | 超时时间（ms） |
| `run_in_background` | boolean | ❌ | `false` | 是否后台运行 |
| `dangerouslyDisableSandbox` | boolean | ❌ | `false` | 禁用沙箱（危险） |

**使用示例**：

```typescript
// 普通命令
{
  "command": "git status",
  "description": "查看 git 状态"
}

// 后台运行
{
  "command": "npm test",
  "description": "运行测试",
  "run_in_background": true
}

// 自定义超时
{
  "command": "npm run build",
  "description": "构建项目",
  "timeout": 300000
}
```

**输出**：

```
On branch master
Your branch is up to date with 'origin/master'.

nothing to commit, working tree clean

✅ 命令执行成功（退出码 0）
```

**注意事项**：

- 工作目录默认为当前项目根目录
- 长时间运行的命令建议使用 `run_in_background: true`
- 禁止执行危险命令（如 `rm -rf /`），除非配置白名单
- 沙箱模式（macOS/Linux）默认启用，限制系统路径写入和网络访问

---

### glob

查找匹配 glob 模式的文件。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `pattern` | string | ✅ | - | Glob 模式 |
| `path` | string | ❌ | `.` | 搜索目录 |

**使用示例**：

```typescript
// 查找所有 TypeScript 文件
{
  "pattern": "**/*.ts"
}

// 查找特定目录下的 Markdown 文件
{
  "pattern": "*.md",
  "path": "docs"
}

// 查找多种类型的文件
{
  "pattern": "**/*.{ts,tsx,js,jsx}"
}
```

**输出**（按修改时间排序）：

```
src/index.ts
src/core/agent/AgentLoop.ts
src/core/tools/ReadTool.ts
...
共找到 234 个文件
```

**注意事项**：

- 默认忽略 `node_modules`、`.git` 等目录
- 最多返回 1000 个文件（可配置）
- 结果按最后修改时间倒序排列

---

### grep

搜索文件内容（支持正则表达式）。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `pattern` | string | ✅ | - | 搜索模式（正则表达式） |
| `path` | string | ❌ | `.` | 搜索路径 |
| `output_mode` | string | ❌ | `"files_with_matches"` | 输出模式 |
| `glob` | string | ❌ | - | 文件过滤（glob 模式） |
| `type` | string | ❌ | - | 文件类型（js/py/ts 等） |
| `-i` | boolean | ❌ | `false` | 忽略大小写 |
| `-C` | number | ❌ | `0` | 上下文行数 |
| `multiline` | boolean | ❌ | `false` | 多行匹配 |
| `head_limit` | number | ❌ | `0` | 限制输出行数（0 = 不限制） |

**输出模式**：

- `files_with_matches` — 仅输出匹配的文件路径（默认）
- `content` — 输出匹配的内容
- `count` — 输出每个文件的匹配数

**使用示例**：

```typescript
// 查找包含 "TODO" 的文件
{
  "pattern": "TODO",
  "output_mode": "files_with_matches"
}

// 查找函数定义（带上下文）
{
  "pattern": "function\\s+\\w+",
  "output_mode": "content",
  "-C": 2,
  "glob": "**/*.ts"
}

// 忽略大小写搜索
{
  "pattern": "error",
  "-i": true,
  "output_mode": "content"
}

// 多行匹配
{
  "pattern": "interface\\s+\\{[\\s\\S]*?\\}",
  "multiline": true
}
```

**输出**：

```
src/core/agent/AgentLoop.ts
src/core/tools/BaseTool.ts
src/adapters/cli/App.tsx
共找到 15 个匹配文件
```

**注意事项**：

- 正则语法基于 Rust ripgrep（`{ }` 需要转义为 `\{ \}`）
- 默认单行匹配，跨行搜索需启用 `multiline: true`
- 最多返回 500 个匹配（可配置）

---

## Web 工具

### web_search

搜索互联网内容。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `query` | string | ✅ | - | 搜索关键词 |
| `allowed_domains` | string[] | ❌ | - | 限制搜索域名 |
| `blocked_domains` | string[] | ❌ | - | 排除搜索域名 |

**使用示例**：

```typescript
// 普通搜索
{
  "query": "React hooks best practices 2026"
}

// 限制域名
{
  "query": "TypeScript",
  "allowed_domains": ["typescriptlang.org", "github.com"]
}

// 排除域名
{
  "query": "AI news",
  "blocked_domains": ["spam-site.com"]
}
```

**输出**：

```
找到 5 个结果：

1. [React Hooks - React Documentation](https://react.dev/hooks)
   React Hooks 官方文档，介绍所有内置 Hooks...

2. [Best Practices for React Hooks](https://example.com/...)
   ...

Sources:
- [React Hooks - React Documentation](https://react.dev/hooks)
- [Best Practices for React Hooks](https://example.com/...)
```

**支持的搜索引擎**：

- **Tavily**（推荐）
- **Serper**
- **Brave Search**
- **DuckDuckGo**（免费，无需 API Key，功能受限）

详见 [Web 能力](./web-capabilities.md)。

---

### web_fetch

抓取网页内容。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `url` | string | ✅ | 网页 URL |
| `prompt` | string | ✅ | 提取指令（告诉 LLM 提取什么信息） |

**使用示例**：

```typescript
{
  "url": "https://github.com/shibit/xuanji",
  "prompt": "Extract the project description and main features"
}
```

**输出**：

```
Xuanji is an open-source AI assistant built with TypeScript, Ink, and Node.js.

Main features:
- Multi-LLM support (Claude, GPT)
- 16+ built-in tools
- Memory system with vector retrieval
- Session management
- MCP integration
```

**注意事项**：

- HTML 会自动转换为 Markdown（使用 Readability）
- 结果会通过轻量模型总结（节省 token）
- 有 SSRF 防护（禁止访问私有 IP）
- 缓存 TTL 15 分钟

---

## 记忆工具

### memory_store

存储长期记忆。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `content` | string | ✅ | 记忆内容 |
| `importance` | number | ❌ | 重要性（1-10，默认 5） |
| `tags` | string[] | ❌ | 标签 |

**使用示例**：

```typescript
{
  "content": "用户偏好使用 TypeScript 和 React，不喜欢 Vue",
  "importance": 8,
  "tags": ["preference", "tech-stack"]
}
```

**输出**：

```
✅ 记忆已存储（ID: 1234）
```

---

### memory_search

检索长期记忆。

**参数**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `query` | string | ✅ | - | 搜索关键词 |
| `max_results` | number | ❌ | `10` | 最大结果数 |

**使用示例**：

```typescript
{
  "query": "用户的技术栈偏好",
  "max_results": 5
}
```

**输出**：

```
找到 2 条记忆：

1. 用户偏好使用 TypeScript 和 React，不喜欢 Vue
   重要性：8 | 时间：2026-03-01

2. 用户的 Node.js 版本是 20.0.0
   重要性：5 | 时间：2026-02-28
```

详见 [记忆系统](./memory-system.md)。

---

## 提醒工具

### reminder_set

设置提醒。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `time` | string | ✅ | 提醒时间（ISO 8601 或自然语言） |
| `content` | string | ✅ | 提醒内容 |
| `recurring` | string | ❌ | 重复模式（daily/weekly/monthly） |

**使用示例**：

```typescript
// 一次性提醒
{
  "time": "2026-03-15 10:00",
  "content": "开会：讨论 Q2 计划"
}

// 重复提醒
{
  "time": "09:00",
  "content": "每日站会",
  "recurring": "daily"
}
```

---

### reminder_check

检查待处理提醒。

**参数**：无

**使用示例**：

```typescript
{}
```

**输出**：

```
待处理提醒（2 条）：

1. 开会：讨论 Q2 计划
   时间：2026-03-15 10:00（3 小时后）

2. 每日站会
   时间：每天 09:00（明天）
```

---

## 任务工具

### task

创建子代理执行任务。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `task` | string | ✅ | 任务描述 |
| `context` | string | ❌ | 上下文信息 |

**使用示例**：

```typescript
{
  "task": "分析 src/core/agent/AgentLoop.ts 文件，总结其核心逻辑",
  "context": "这是 Agent 调度的核心模块"
}
```

**输出**：

```
[SubAgent 启动]
任务：分析 src/core/agent/AgentLoop.ts 文件...

[SubAgent 执行中...]
1. 使用 read_file 读取文件
2. 分析代码结构

[SubAgent 完成]
AgentLoop 的核心逻辑包括：
- ReAct 循环（Reasoning + Action）
- 流式处理 LLM 响应
- 工具调用调度
- 错误恢复机制
```

**注意事项**：

- SubAgent 继承主 Agent 的配置（模型、权限等）
- SubAgent 无法访问某些工具（如 `task` 本身，避免无限嵌套）
- 最大嵌套深度 3 层，超时 5 分钟

---

### agent_team

创建多个协作的子代理。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `agents` | array | ✅ | Agent 配置列表 |

**使用示例**：

```typescript
{
  "agents": [
    {
      "name": "Researcher",
      "task": "搜索最新的 React 19 特性",
      "tools": ["web_search", "web_fetch"]
    },
    {
      "name": "Coder",
      "task": "根据研究结果编写示例代码",
      "tools": ["write_file", "edit_file"]
    }
  ]
}
```

详见 [子代理系统](./subagent-system.md)。

---

### quick_team

快速创建任务队列（并发执行）。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `tasks` | string[] | ✅ | 任务列表 |

**使用示例**：

```typescript
{
  "tasks": [
    "读取 package.json",
    "读取 README.md",
    "读取 tsconfig.json"
  ]
}
```

**输出**：

```
[并发执行 3 个任务]
✅ 任务 1 完成
✅ 任务 2 完成
✅ 任务 3 完成

[汇总结果]
...
```

---

## 交互工具

### ask_user

向用户提问。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `question` | string | ✅ | 问题内容 |

**使用示例**：

```typescript
{
  "question": "是否要删除 node_modules 目录？"
}
```

**输出**：

```
[等待用户输入...]

用户回答：是的，请删除
```

---

### plan_review

提交执行计划供用户确认。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `plan` | string | ✅ | 执行计划描述 |
| `actions` | array | ✅ | 具体操作列表 |

**使用示例**：

```typescript
{
  "plan": "重构 Agent 模块",
  "actions": [
    { "type": "edit", "path": "src/core/agent/AgentLoop.ts", "description": "优化 ReAct 循环" },
    { "type": "create", "path": "src/core/agent/StreamHandler.ts", "description": "新增流式处理器" }
  ]
}
```

**输出**：

```
[执行计划审查]

计划：重构 Agent 模块

操作：
1. [编辑] src/core/agent/AgentLoop.ts
   优化 ReAct 循环

2. [创建] src/core/agent/StreamHandler.ts
   新增流式处理器

是否批准？[y/n]
```

---

## 其他工具

### notebook_edit

编辑 Jupyter Notebook 单元格。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `notebook_path` | string | ✅ | Notebook 路径 |
| `cell_id` | string | ❌ | 单元格 ID |
| `new_source` | string | ✅ | 新内容 |
| `cell_type` | string | ❌ | 单元格类型（code/markdown） |
| `edit_mode` | string | ❌ | 编辑模式（replace/insert/delete） |

**使用示例**：

```typescript
{
  "notebook_path": "/path/to/notebook.ipynb",
  "cell_id": "abc123",
  "new_source": "import pandas as pd\ndf = pd.read_csv('data.csv')",
  "edit_mode": "replace"
}
```

---

### worktree

创建 Git Worktree（隔离工作区）。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | string | ❌ | Worktree 名称（默认随机生成） |

**使用示例**：

```typescript
{
  "name": "feature-xyz"
}
```

**输出**：

```
✅ Worktree 创建成功：.claude/worktrees/feature-xyz
分支：feature-xyz（基于 master）

会话目录已切换到 Worktree
```

---

### sleep

暂停执行（用于测试或等待）。

**参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `duration` | number | ✅ | 暂停时长（毫秒） |

**使用示例**：

```typescript
{
  "duration": 2000
}
```

**输出**：

```
⏸️ 暂停 2000ms
```

---

## 下一步

- [Skills 使用指南](./skills-guide.md) — 内置 Skill 和自定义 Skill
- [权限系统](./permission-system.md) — 权限控制详解
- [记忆系统](./memory-system.md) — 记忆管理详解

---

[← 返回文档首页](./README.md) | [下一步：Skills 使用指南 →](./skills-guide.md)
