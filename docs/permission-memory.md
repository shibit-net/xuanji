# 权限记忆机制说明

## 概述

当你选择"总是允许"或"总是拒绝"某个操作时，系统会将你的决策保存到两个地方：

## 存储位置

### 1. 会话内存（临时）
- **位置**：`PermissionController.decisionCache` (Map 对象)
- **生命周期**：仅在当前应用运行期间有效，关闭应用后清空
- **用途**：快速查询，避免重复弹窗

### 2. 持久化存储（永久）
- **位置**：`~/.xuanji/permission-decisions.db` (SQLite 数据库)
- **生命周期**：永久保存，重启应用后仍然有效
- **用途**：跨会话记住你的决策

## 缓存 Key 生成规则

系统根据操作类型生成唯一的缓存 key：

### 文件操作
```
格式：file:{operation}:{normalizedPath}
示例：
- file:write:/Users/kevin/project/src/index.ts
- file:delete:/Users/kevin/project/node_modules
```

### 命令操作
```
格式：cmd:{commandPattern} 或 cmd:danger:{hash}
示例：
- cmd:rm -rf *
- cmd:npm uninstall
- cmd:danger:a3f2b1c4 (危险命令的哈希值)
```

## 决策查询流程

```
用户操作请求
    ↓
1. 检查会话缓存 (decisionCache)
    ├─ 命中 → 直接返回允许/拒绝
    └─ 未命中 ↓
2. 检查持久化存储 (DecisionStore)
    ├─ 命中 → 返回允许/拒绝，并更新会话缓存
    └─ 未命中 ↓
3. 弹出确认对话框
    ├─ 用户选择"总是允许/拒绝" → 保存到两处
    └─ 用户选择"仅本次" → 不保存
```

## 数据库表结构

### decisions 表（决策记录）
```sql
CREATE TABLE decisions (
  cache_key TEXT PRIMARY KEY,      -- 缓存 key
  allowed INTEGER NOT NULL,        -- 1=允许, 0=拒绝
  tool_name TEXT NOT NULL,         -- 工具名称 (bash, write_file 等)
  timestamp TEXT NOT NULL,         -- 记录时间 (ISO 8601)
  expires_at TEXT                  -- 过期时间 (可选)
)
```

### denied_operations 表（拒绝操作记录）
```sql
CREATE TABLE denied_operations (
  category TEXT NOT NULL,          -- 操作类别 (file, cmd)
  pattern TEXT NOT NULL,           -- 操作模式
  reason TEXT NOT NULL,            -- 拒绝原因
  timestamp INTEGER NOT NULL,      -- 拒绝时间戳
  PRIMARY KEY (category, pattern)
)
```

## 管理你的决策

### 查看所有决策
```typescript
const store = new DecisionStore();
await store.init();
const allDecisions = store.getAll();
console.log(allDecisions);
```

### 删除特定决策
```typescript
await store.delete('file:delete:/path/to/file');
```

### 清空所有决策
```typescript
await store.clear();
```

### 查看拒绝操作记录
```typescript
const deniedOps = store.loadDeniedOperations();
for (const [key, op] of deniedOps) {
  console.log(`${op.category}:${op.pattern} - ${op.reason}`);
}
```

## 批量操作中止机制（新增）

当你在批量操作中拒绝某个操作时，系统现在会：

1. **立即终止后续所有操作**
2. 为未执行的操作标记为 `[Cancelled] Previous operation was denied by user.`
3. 记录日志：`Permission denied detected, aborting remaining operations`

### 示例场景

```
任务：卸载项目
1. rm -rf project/     → 用户拒绝 ✗
2. npm uninstall       → 自动取消 ✗ (不再执行)
3. git clean -fd       → 自动取消 ✗ (不再执行)
```

### 检测关键词

系统通过以下关键词判断权限拒绝：
- 中文：`操作被拒绝`、`用户拒绝`、`缓存拒绝`、`策略禁止`
- 英文：`Operation denied`、`User denied`、`Cached denial`、`Policy denied`

## 注意事项

1. **缓存大小限制**：会话缓存最多保存 1000 条记录，超出后会清空重建
2. **持久化存储无限制**：SQLite 数据库可以保存任意数量的决策
3. **过期机制**：支持为决策设置过期时间（目前未启用）
4. **WAL 模式**：数据库使用 WAL (Write-Ahead Logging) 模式，提升并发性能

## 相关文件

- `src/permission/PermissionController.ts` - 权限控制器
- `src/permission/DecisionStore.ts` - 持久化存储
- `src/core/agent/ToolDispatcher.ts` - 工具调度器（批量操作中止逻辑）
- `src/core/i18n/messages.ts` - 国际化消息
