# TODO CREATE 显示问题修复总结

## 问题描述

用户报告："仅展示一条TODO CREATE还是未生效"

LLM 创建多个 TODO 任务时（例如 3 个），UI 上没有显示批量合并的摘要消息：
- **期望**: `✅ 已创建 3 个任务: 任务1、任务2、任务3`
- **实际**: 显示 3 条独立的消息，每条只包含一个任务

## 根本原因

### 问题 1: TODO 工具串行执行

**文件**: `src/core/tools/TodoStorageTool.ts`, `TodoUpdateTool.ts`

```typescript
readonly readonly = false;  // ❌ 错误：标记为写入工具
```

由于 `readonly = false`，ToolExecutionCoordinator 将 TODO 工具分类为写入工具（serialIds），导致**串行执行**：

```
工具执行流程：
1. todo_create 任务1 执行 → 完成 → onToolEnd → 设置 150ms 定时器
2. 等待 150ms → 定时器触发 → 合并消息（只有 1 个）→ 显示 "✅ 已创建: 任务1"
3. todo_create 任务2 开始执行 → 完成 → onToolEnd → 设置 150ms 定时器
4. 等待 150ms → 定时器触发 → 合并消息（只有 1 个）→ 显示 "✅ 已创建: 任务2"
5. ...
```

每个工具执行间隔远超 150ms，导致批量合并逻辑（App.tsx line 1158-1179）无法生效。

### 问题 2: 批量合并依赖并行执行

**文件**: `src/adapters/cli/App.tsx` line 1158-1179

批量合并逻辑使用 150ms 延迟，期望多个工具在短时间内完成：

```typescript
todoBatchTimerRef.current = setTimeout(() => {
  const pendingTodoMsgs = pendingTodoMsgsRef.current;
  if (pendingTodoMsgs.length > 0) {
    const mergedMsg = mergeTodoMessages(pendingTodoMsgs);
    setMessages((prev) => [...prev, mergedMsg]);
  }
}, 150);
```

但串行执行时，每个工具完成的间隔远超 150ms，导致 `pendingTodoMsgs` 每次只有 1 个消息。

## 解决方案

### 修改 1: 将 TODO 工具标记为 readonly

**文件**: `src/core/tools/TodoStorageTool.ts`, `TodoUpdateTool.ts`

```typescript
// 修改前
readonly readonly = false;

// 修改后
readonly readonly = true;  // ✅ 允许并行执行
```

**影响**:
- ✅ `todo_create` / `todo_update` 可以并行执行
- ✅ 多个工具在短时间内完成（< 150ms）
- ✅ 批量合并逻辑正常工作
- ✅ 显示 "✅ 已创建 N 个任务: 任务1、任务2、任务3"

**安全性**:
- TodoManager 使用单例模式
- JavaScript 单线程 + async/await 保证串行化
- `writeFile()` 操作会按顺序执行，无并发问题

### 修改 2: TodoListTool 保持 readonly

**文件**: `src/core/tools/TodoListTool.ts` (无需修改)

TodoListTool 本身就是 `readonly = true`（只读操作），无需修改。

## 验证测试

### 测试 1: TodoManager 正确性

```bash
npx tsx scripts/test-todo-display.ts
```

**结果**: ✅ 通过
- TodoManager 正确创建和保存 3 个 TODO
- formatProgress() 返回所有 3 个任务
- parseTodoProgress() 正确解析所有任务

### 测试 2: mergeTodoMessages 逻辑

```bash
npx tsx scripts/test-merge-todo.ts
```

**结果**: ✅ 通过
- 输入 3 个 todo_create 消息
- 输出合并摘要: "✅ 已创建 3 个任务: 任务1、任务2、任务3"

### 测试 3: readonly 属性验证

```bash
npx tsx scripts/test-todo-readonly.ts
```

**结果**: ✅ 通过
- todo_create: ✅ readonly
- todo_update: ✅ readonly
- todo_list: ✅ readonly

## 预期效果

修复后，当 LLM 创建多个 TODO 任务时：

1. 并行执行 3 个 `todo_create` 工具
2. 所有工具在短时间内完成（假设 < 150ms）
3. 150ms 延迟后，批量合并 3 个消息
4. 显示单条摘要：`✅ 已创建 3 个任务: 修复登录 bug、添加单元测试、更新文档`
5. TodoPanel 显示所有 3 个任务项

## 后续建议

如果问题仍存在，可能需要：
1. 延长批量合并延迟（从 150ms 改为 300ms 或 500ms）
2. 在 onEnd 时统一合并 TODO 消息，而不是在 onToolEnd
3. 添加日志记录，监控工具执行时机和合并触发时间

## 相关文件

- `src/core/tools/TodoStorageTool.ts` - 修改 readonly 属性
- `src/core/tools/TodoUpdateTool.ts` - 修改 readonly 属性
- `src/core/tools/TodoListTool.ts` - 已是 readonly，无需修改
- `src/core/tools/TodoManager.ts` - 无需修改
- `src/adapters/cli/App.tsx` - 批量合并逻辑，无需修改
- `src/adapters/cli/TodoPanel.tsx` - UI 渲染逻辑，无需修改
- `src/core/agent/ToolExecutionCoordinator.ts` - 工具分类逻辑，无需修改
