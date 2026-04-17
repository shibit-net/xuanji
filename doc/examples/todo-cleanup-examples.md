# Todo 任务清理 - 完整示例

## 场景 1：LLM 自动检测并归档

### 用户操作
```
用户：帮我重构 auth 模块
LLM：创建 4 个任务...
... 完成所有任务 ...

用户：现在帮我写测试
```

### LLM 看到的 System Prompt（自动注入）
```
# 当前任务状态

- 总任务数：4
- 进行中：0
- 待处理：0
- 已完成：4
- 失败：0

⚠️ 用户似乎开始了新的工作。当前还有旧任务未清理。

建议流程：
1. 先调用 todo_list 查看旧任务状态
2. 如果旧任务已完成，调用 todo_archive {"strategy": "completed"} 归档
3. 如果旧任务无关，调用 todo_clear {"status": "all"} 清空
4. 然后为新工作创建任务
```

### LLM 的响应
```
检测到 4 个已完成的旧任务，先归档它们。

[调用工具] todo_archive {"strategy": "completed"}
✅ 已归档 4 个任务

现在为测试工作创建新任务：
[调用工具] todo_create {"title": "编写单元测试", ...}
```

---

## 场景 2：任务列表过长自动提示

### 用户操作
```
用户：继续优化性能
```

### 当前状态
- 15 个任务（8 个已完成，5 个进行中，2 个待处理）

### LLM 看到的 System Prompt
```
# 当前任务状态

- 总任务数：15
- 进行中：5
- 待处理：2
- 已完成：8
- 失败：0

⚠️ 检测到 8 个已完成任务。
在创建新任务前，建议先调用 todo_archive 工具归档旧任务，保持列表清爽。

⚠️ 当前任务列表过长（15 个任务）。
建议归档已完成任务或清理无关任务。

建议操作：
- 归档已完成任务：todo_archive {"strategy": "completed"}
- 清理失败任务：todo_clear {"status": "failed"}
- 查看任务列表：todo_list
```

### LLM 的响应
```
任务列表较长，先归档已完成的 8 个任务。

[调用工具] todo_archive {"strategy": "completed"}
✅ 已归档 8 个任务

现在继续优化性能工作...
```

---

## 场景 3：孤儿任务检测

### 用户操作
```
用户：帮我实现新功能 X
```

### 当前状态
- 3 个任务（2 个 pending 已 7 天无更新，1 个新任务）

### LLM 看到的 System Prompt
```
# 当前任务状态

- 总任务数：3
- 进行中：0
- 待处理：2
- 已完成：1
- 失败：0

⚠️ 检测到 2 个孤儿任务（7天无更新）：修复登录 bug, 优化数据库查询。
建议询问用户是否继续这些任务，或调用 todo_clear 清理。
```

### LLM 的响应
```
检测到 2 个长期未更新的任务：
1. 修复登录 bug
2. 优化数据库查询

这些任务是否还需要继续？如果不需要，我可以清理它们。
```

### 用户回复
```
用户：不需要了，清理掉吧
```

### LLM 执行
```
[调用工具] todo_clear {"status": "pending"}
✅ 已清空 2 个任务

现在开始实现新功能 X...
```

---

## 场景 4：用户手动归档（GUI）

### 用户操作
1. 打开 xuanji Desktop
2. 看到 TodoPanel 显示："8/10 已完成"
3. 点击"归档"按钮

### 系统行为
```
前端：调用 window.electron.todoArchiveCompleted()
  ↓
主进程：转发到 agent-bridge
  ↓
agent-bridge：调用 getTodoManager().archiveCompleted()
  ↓
TodoManager：
  - 将 8 个 completed 任务移动到 ~/.xuanji/todos-archive.jsonl
  - 从 todos.jsonl 中删除
  - 返回 { success: true, count: 8 }
  ↓
前端：更新显示
  - todos 列表减少 8 个
  - 归档计数 +8
  - 显示："2/2 已完成 · 8 已归档"
```

---

## 场景 5：定时自动归档（未来功能）

### 配置
```json
{
  "todoAutoArchive": {
    "enabled": true,
    "thresholdHours": 24,
    "schedule": "0 2 * * *"  // 每天凌晨 2 点
  }
}
```

### 执行流程
```
Cron Job 触发
  ↓
调用 TodoManager.autoArchive(24)
  ↓
检测所有 completed 且超过 24 小时的任务
  ↓
归档到 todos-archive.jsonl
  ↓
记录日志：已归档 12 个任务
```

---

## 调试技巧

### 查看任务状态
```bash
# 活跃任务
cat ~/.xuanji/todos.jsonl | jq -r '.title + " (" + .status + ")"'

# 归档任务
cat ~/.xuanji/todos-archive.jsonl | jq -r '.title + " (" + .updated_at + ")"'
```

### 手动触发归档
```bash
# 在 xuanji CLI 中
> /skill todo_archive {"strategy": "completed"}
```

### 清空所有任务（重新开始）
```bash
rm ~/.xuanji/todos.jsonl
rm ~/.xuanji/todos-archive.jsonl
```

---

## 配置选项（未来扩展）

```typescript
// ~/.xuanji/config.json
{
  "todo": {
    // 自动归档阈值
    "autoArchiveThresholdHours": 24,
    
    // 孤儿任务检测阈值
    "staleTaskThresholdDays": 7,
    
    // 触发清理提示的阈值
    "thresholds": {
      "completedTasks": 5,
      "failedTasks": 3,
      "totalTasks": 15
    },
    
    // 新工作检测关键词
    "newWorkKeywords": ["现在", "接下来", "然后", "新的"],
    
    // 是否在 System Prompt 中注入提示
    "enableContextInjection": true
  }
}
```
