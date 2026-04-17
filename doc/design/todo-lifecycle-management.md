# Todo 任务生命周期管理

## 设计理念

xuanji 是**记忆驱动**的 Agent，不依赖会话上下文。任务（todos）是**工作状态的真实反映**，不应随会话重置而消失。

## 核心原则

1. **任务独立于会话**：任务是工作进度，不因会话切换而清空
2. **智能清理策略**：自动归档 + 手动清理 + LLM 主动决策
3. **记录可追溯**：归档而非删除，保留历史记录
4. **自动感知提示**：通过 System Prompt 注入，让 LLM 自动感知何时该清理

## LLM 如何知道该清理任务？

### 方案 1：System Prompt 动态注入（已实现）

**核心机制**：`TodoContextInjector` 在每次 `AgentLoop.run()` 时自动分析任务状态，并注入提示到 System Prompt。

**触发条件**：

1. **大量已完成任务**（≥5 个）
   ```
   ⚠️ 检测到 8 个已完成任务。
   在创建新任务前，建议先调用 todo_archive 工具归档旧任务，保持列表清爽。
   ```

2. **孤儿任务**（7 天无更新）
   ```
   ⚠️ 检测到 2 个孤儿任务（7天无更新）：修复登录 bug, 优化数据库查询。
   建议询问用户是否继续这些任务，或调用 todo_clear 清理。
   ```

3. **失败任务累积**（≥3 个）
   ```
   ⚠️ 检测到 4 个失败任务。
   建议询问用户是否重试或清理这些任务。
   ```

4. **任务总数过多**（≥15 个）
   ```
   ⚠️ 当前任务列表过长（18 个任务）。
   建议归档已完成任务或清理无关任务。
   ```

5. **检测到新工作**（用户消息包含"现在"、"接下来"等关键词）
   ```
   ⚠️ 用户似乎开始了新的工作。当前还有旧任务未清理。
   
   建议流程：
   1. 先调用 todo_list 查看旧任务状态
   2. 如果旧任务已完成，调用 todo_archive {"strategy": "completed"} 归档
   3. 如果旧任务无关，调用 todo_clear {"status": "all"} 清空
   4. 然后为新工作创建任务
   ```

**实现细节**：

```typescript
// src/core/agent/AgentLoop.ts
async run(userMessage: string): Promise<void> {
  // 🆕 注入任务状态提示到 system prompt
  await this.injectTodoContextHint(userMessage);
  
  // 构建初始消息
  let messages = this.messageManager.build(userMessage);
  // ...
}

private async injectTodoContextHint(userMessage: string): Promise<void> {
  const contextHint = await generateTodoContextHint();
  const newWorkHint = detectNewWorkContext(userMessage, todos.length > 0);
  
  if (contextHint || newWorkHint) {
    this.messageManager.setSystemPromptSuffix(hint, 'todo-context');
  }
}
```

**优势**：
- ✅ 完全自动，无需 LLM 主动检查
- ✅ 上下文感知，根据用户消息智能判断
- ✅ 非侵入式，不影响主流程
- ✅ 可配置阈值（5/7/3/15 等数字可调整）

### 方案 2：工具描述中的提示（已实现）

**TodoCreateTool** 的 description 中包含清理提示：
```typescript
description = [
  '⚠️ BEFORE creating tasks: Check if there are old completed tasks.',
  'If yes, call todo_list first, then call todo_archive to clean up.',
]
```

**局限性**：依赖 LLM 主动遵守，不够可靠。

### 方案 3：TODO_PROGRESS 事件中注入警告（未实现）

在 `TodoManager.formatProgress()` 中，如果检测到需要清理，直接在进度字符串中注入警告：

```typescript
formatProgress(): string {
  const todos = Array.from(this.todos.values());
  const completed = todos.filter(t => t.status === 'completed');
  
  let warning = '';
  if (completed.length >= 5) {
    warning = '\n⚠️ 建议归档已完成任务：todo_archive {"strategy": "completed"}';
  }
  
  return `\n<!--TODO_PROGRESS:${progressData}-->${warning}`;
}
```

**优势**：LLM 每次看到 TODO_PROGRESS 都会看到警告。
**劣势**：可能过于频繁，干扰 LLM 思考。

## 实现方案

### 1. 前端清理逻辑修复

**问题**：`chatStore.reset()` 没有清空 `executionStore.todos`，导致旧任务永久累积。

**修复**：
```typescript
// desktop/renderer/stores/chatStore.ts
reset: async () => {
  await window.electron.agentReset();
  
  // 只清空前端显示状态，不清空后端持久化任务
  useExecutionStore.setState({ todos: [] });
  
  set({ messages: [], ... });
}
```

### 2. TodoManager 增强

**新增功能**：

#### 归档机制
- `archiveTodo(todoId)` — 归档单个任务
- `archiveCompleted()` — 归档所有已完成任务
- `autoArchive(thresholdHours)` — 自动归档超过阈值的任务
- `getArchivedCount()` — 获取归档任务数量

#### 清理策略
- `clearByStatus(status?)` — 清空指定状态的任务
- `detectStaleTasks(thresholdDays)` — 检测孤儿任务（长期无更新）

**存储结构**：
```
~/.xuanji/
├── todos.jsonl          # 活跃任务
└── todos-archive.jsonl  # 归档任务
```

### 3. 新增工具

#### TodoArchiveTool
```typescript
name: 'todo_archive'
description: '归档已完成的任务，保留记录但不再显示'

参数：
- strategy: 'completed' | 'auto'
- thresholdHours: number (默认 24)

示例：
{"strategy": "completed"}  // 归档所有已完成
{"strategy": "auto", "thresholdHours": 1}  // 归档 1 小时前完成的
```

### 4. GUI 增强

**TodoPanel 新增功能**：
- ✅ 显示归档任务数量
- ✅ "归档"按钮（清理已完成任务）
- ✅ 归档状态提示（"X 已归档"）

**交互流程**：
```
用户点击"归档" 
  → 调用 window.electron.todoArchiveCompleted()
  → 后端归档所有 completed 任务
  → 更新前端归档计数
  → 任务从列表消失
```

## 清理时机

### 自动清理（推荐）
- ✅ **24 小时后自动归档**：completed 任务超过 24 小时 → 自动归档
- ✅ **孤儿任务检测**：pending 任务 7 天无更新 → 标记为 stale

### 手动清理
- ✅ **GUI 按钮**：用户点击"归档"按钮
- ✅ **Skill 命令**：`/archive-tasks` 或 `/clear-tasks`

### LLM 主动清理
- ✅ **上下文感知**：LLM 检测到任务列表过长时主动询问
- ✅ **工具调用**：`todo_archive` 工具让 LLM 决策何时归档

## 会话切换行为

```
用户切换会话 A → B：
├─ 前端：executionStore.todos 清空（避免显示 A 的任务）
├─ 后端：TodoManager 保持不变（任务持久化）
└─ 恢复会话 A：从 TodoManager 重新加载任务到前端
```

**未来优化**：
- 按会话隔离任务（`sessionId` 字段）
- 或全局任务池 + 标签系统（`tags: ['session-A', 'project-X']`）

## 文件清单

### 后端
- `src/core/tools/TodoManager.ts` — 增加归档方法
- `src/core/tools/TodoArchiveTool.ts` — 新增归档工具
- `src/core/tools/TodoContextInjector.ts` — **新增**：任务状态分析和提示生成
- `src/core/tools/ToolRegistry.ts` — 注册新工具
- `src/core/agent/AgentLoop.ts` — **修改**：集成 TodoContextInjector

### 桥接层
- `desktop/main/agent-bridge.ts` — 新增 todo 管理 IPC 处理
- `desktop/main/index.ts` — 新增 IPC 通道
- `desktop/main/preload.ts` — 暴露 API 给渲染进程

### 前端
- `desktop/renderer/stores/chatStore.ts` — 修复 reset 逻辑
- `desktop/renderer/components/TodoPanel.tsx` — 增加归档按钮
- `desktop/renderer/global.d.ts` — 新增类型定义

## 使用示例

### LLM 主动归档
```
用户：帮我重构 auth 模块
LLM：创建 Task 1-4
... 完成所有任务 ...

用户：现在帮我写测试
LLM：检测到 4 个已完成任务，先归档旧任务
     调用 todo_archive {"strategy": "completed"}
     然后创建新的测试任务
```

### 用户手动归档
```
用户点击 TodoPanel 的"归档"按钮
→ 已完成任务移入 ~/.xuanji/todos-archive.jsonl
→ 活跃列表清空，显示"4 已归档"
```

## 后续优化

1. **按会话隔离**：每个会话独立的任务列表
2. **归档查询**：提供工具查询归档历史
3. **自动清理策略**：后台定时任务自动归档
4. **任务统计**：Dashboard 显示任务完成趋势

## 总结

通过这次重构，xuanji 的任务管理系统更符合"记忆驱动"的设计理念：
- ✅ 任务不再随会话消失
- ✅ 智能归档保持列表清爽
- ✅ 历史记录可追溯
- ✅ LLM 可主动决策清理时机
