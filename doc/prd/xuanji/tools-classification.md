# 璇玑工具分类总览

## 实施日期
2026-03-16

## 概述
对璇玑系统中的所有 35 个工具进行完整分类，分为三个层次：
- **CORE（核心工具）**：5 个，所有场景都需要的基础工具
- **META（元能力工具）**：17 个，任务管理、Multi-Agent、记忆、系统管理等元能力
- **SCENE（场景工具）**：11 个，按编程/生活场景分组的专用工具
- **其他**：2 个，特殊场景工具（Team Tools）

---

## 工具分类详表

### 1️⃣ CORE — 核心工具（5 个）

所有场景都默认启用的基础工具。

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `read_file` | 读取文件内容 | `ReadTool.ts` |
| `ask_user` | 询问用户问题（多选/单选） | `AskUserTool.ts` |
| `bash` | 执行 Bash 命令 | `BashTool.ts` |
| `glob` | 文件模式匹配（查找文件） | `GlobTool.ts` |
| `grep` | 内容搜索（ripgrep） | `GrepTool.ts` |

---

### 2️⃣ META — 元能力工具（17 个）

跨场景的元能力，始终可用。

#### 📋 任务管理（7 个）

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `todo_create` | 创建任务 | `TodoStorageTool.ts` |
| `todo_update` | 更新任务状态 | `TodoUpdateTool.ts` |
| `todo_list` | 列出任务列表 | `TodoListTool.ts` |
| `task_output` | 查看后台任务输出 | `TaskOutputTool.ts` |
| `plan_review` | 计划审查（用户确认） | `PlanReviewTool.ts` |
| `enter_plan_mode` | 进入 Plan Mode（只读） | `EnterPlanModeTool.ts` |
| `exit_plan_mode` | 退出 Plan Mode | `ExitPlanModeTool.ts` |

#### 🤖 Multi-Agent（6 个）

| 工具名 | 说明 | 文件位置 | 状态 |
|--------|------|----------|------|
| `task` | SubAgent 调度（旧） | `TaskTool.ts` | ⚠️ 已废弃 |
| `delegate` | 委托子 Agent 执行任务 | `DelegateTool.ts` | ✅ 推荐 |
| `orchestrate` | 编排多个并行/串行子任务 | `OrchestrateTool.ts` | ✅ 推荐 |
| `pipeline` | 管道式多步骤执行 | `PipelineTool.ts` | ✅ 推荐 |
| `list_agents` | 列出可用 Agent | `ListAgentsTool.ts` | ✅ 推荐 |
| `match_agent` | 匹配最佳 Agent | `MatchAgentTool.ts` | ✅ 推荐 |

#### 🧠 记忆系统（1 个）

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `retrieve_memory` | 检索历史记忆（所有 Agent 可用） | `RetrieveMemoryTool.ts` |

**说明**：
- 主 Agent：自动注入记忆到 System Prompt
- 子 Agent：通过 `retrieve_memory` 工具主动检索
- LLM 根据任务判断是否需要调用

#### ⚙️ 系统管理（2 个）

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `butler_daemon` | 智能管家守护进程 | `ButlerDaemonTool.ts` |
| `enter_worktree` | 进入 Git 工作树（隔离环境） | `WorktreeTool.ts` |

#### 🐛 调试/测试（1 个）

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `sleep` | 延迟执行（测试用） | `SleepTool.ts` |

---

### 3️⃣ SCENE — 场景工具（11 个）

按场景分组，仅在对应场景激活时可用。

#### 💻 编程场景（5 个）

激活条件：Scene = `coding` 或 Skill = `code-assistant`

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `write_file` | 创建文件 | `WriteTool.ts` |
| `edit_file` | 编辑文件（diff 模式） | `EditTool.ts` |
| `multi_edit` | 批量编辑多个文件 | `MultiEditTool.ts` |
| `list_directory` | 目录浏览（`ls`） | `LSTool.ts` |
| `notebook_edit` | 编辑 Jupyter Notebook | `NotebookEditTool.ts` |

#### 🌍 生活场景（6 个）

激活条件：Scene = `life` 或 Skill = `life-secretary`

| 工具名 | 说明 | 文件位置 |
|--------|------|----------|
| `memory_store` | 存储记忆条目 | `MemoryStoreTool.ts` |
| `memory_search` | 搜索记忆 | `MemorySearchTool.ts` |
| `reminder_set` | 设置提醒 | `ReminderSetTool.ts` |
| `reminder_check` | 检查提醒 | `ReminderCheckTool.ts` |
| `web_search` | Web 搜索（MCP） | `mcp/search/EnhancedWebSearchTool.ts` |
| `web_fetch` | 抓取网页内容 | `WebFetchTool.ts` |

---

### 4️⃣ 其他工具（2 个）

特殊场景或已废弃的工具。

| 工具名 | 说明 | 文件位置 | 状态 |
|--------|------|----------|------|
| `agent_team` | 团队协作（旧） | `TeamTool.ts` | ⚠️ 已废弃 |
| `quick_team` | 快速团队（旧） | `QuickTeamTool.ts` | ⚠️ 已废弃 |

---

## 工具统计

| 分类 | 数量 | 说明 |
|------|------|------|
| CORE | 5 | 基础工具，始终可用 |
| META | 17 | 元能力工具，始终可用 |
| SCENE.coding | 5 | 编程场景专用 |
| SCENE.life | 6 | 生活场景专用 |
| 其他 | 2 | 特殊场景/已废弃 |
| **总计** | **35** | - |

---

## 动态工具加载策略

### Token 优化效果

基于分层工具加载，不同场景加载的工具数量：

| 场景 | 工具组成 | 总数 | Token 节省 |
|------|----------|------|-----------|
| 编程场景 | CORE(5) + META(17) + coding(5) | 27 | -23% |
| 生活场景 | CORE(5) + META(17) + life(6) | 28 | -20% |
| 全量加载 | 所有工具 | 35 | 0% (基准) |

### 配置控制

- **启用动态加载**：`features.dynamicToolLoading = true`（默认）
- **Schema 优化**：`tools.schemaMode = 'compact'`（默认）

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/core/tools/ToolCategories.ts` | 工具分类定义（本次修改） |
| `src/core/tools/DynamicToolFilter.ts` | 动态工具过滤器 |
| `src/core/tools/ToolRegistry.ts` | 工具注册表 |
| `src/core/chat/SessionInitializer.ts` | 工具注册逻辑 |
| `src/core/config/defaults.ts` | 默认配置 |

---

## 修改记录

### 2026-03-16

**修改内容**：

1. **META 工具扩展**（8 → 17 个）
   - 新增 Multi-Agent 工具：`delegate`, `orchestrate`, `pipeline`, `list_agents`, `match_agent`
   - 新增记忆检索：`retrieve_memory`
   - 新增系统管理：`butler_daemon`, `enter_worktree`
   - 新增任务管理：`task_output`
   - 新增调试工具：`sleep`
   - 删除不存在的：`todo_get`（未实现）

2. **SCENE.coding 修正**
   - `ls` → `list_directory`（修正为实际工具名）

3. **文档化**
   - 创建本文档，完整记录所有 35 个工具的分类和说明

**测试验证**：
```bash
npm run typecheck  # 类型检查通过
npm run dev:gui     # GUI 启动成功
```

---

## 未来优化

### 新增场景分类建议

可根据需要扩展更多场景分类：

```typescript
SCENE: {
  'coding': [...],
  'life': [...],
  // 未来可扩展：
  'data-analysis': ['pandas_query', 'plot_chart', ...],
  'devops': ['docker_exec', 'k8s_apply', ...],
  'research': ['arxiv_search', 'citation_format', ...],
}
```

### 工具退休机制

对于已废弃的工具（`agent_team`, `quick_team`, `task`）：

1. 在文档中标记 `⚠️ 已废弃`
2. 添加 deprecation warning 日志
3. 下一个大版本彻底移除

---

## 总结

✅ **已完成**：
- 35 个工具完整分类
- 更新 `ToolCategories.ts`
- 添加 Multi-Agent 工具到 META
- 添加记忆检索工具到 META
- 修正 `ls` → `list_directory`

✅ **核心价值**：
- 清晰的工具组织结构
- 支持动态工具加载（Token 优化）
- 便于未来工具扩展
- 完整的工具文档

✅ **预期效果**：
- 编程场景：节省 23% tokens
- 生活场景：节省 20% tokens
- 工具管理更规范
- 新手更容易理解系统架构
