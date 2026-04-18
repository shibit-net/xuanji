# 权限决策持久化机制

## 概述

xuanji 使用多层缓存机制确保用户的"总是允许"和"总是不允许"决策不会被遗忘，即使在应用重启后也能保持。

## 架构设计

### 1. 三层缓存架构

```
用户确认
    ↓
会话缓存 (Map<string, boolean>)
    ↓
持久化存储 (SQLite)
    ↓
文件系统 (~/.xuanji/permission-decisions.db)
```

### 2. 核心组件

#### DecisionStore (持久化层)
- **位置**: `src/permission/DecisionStore.ts`
- **存储**: SQLite 数据库 (`~/.xuanji/permission-decisions.db`)
- **功能**:
  - 使用 better-sqlite3 进行同步 I/O 操作
  - WAL 模式提升并发性能
  - 支持决策过期时间 (TTL)
  - 存储两类数据：
    1. `decisions` 表：总是允许/拒绝的决策
    2. `denied_operations` 表：被拒绝的操作记录

#### PermissionController (决策层)
- **位置**: `src/permission/PermissionController.ts`
- **功能**:
  - 管理会话级缓存 (内存 Map)
  - 协调持久化存储
  - 处理用户确认逻辑

## 工作流程

### 权限检查流程

```
1. 检查操作黑名单 (deniedOperations)
   ↓ 未命中
2. 检查会话缓存 (decisionCache)
   ↓ 未命中
3. 检查持久化缓存 (DecisionStore)
   ↓ 未命中
4. 触发 UI 确认
   ↓
5. 保存决策到缓存和数据库
```

### 决策保存流程

当用户选择"总是允许"或"总是不允许"时：

```typescript
// 1. 保存到会话缓存
this.decisionCache.set(guardResult.cacheKey, confirmation.allowed);

// 2. 持久化到 SQLite
if (this.decisionStore) {
  await this.decisionStore.set(
    guardResult.cacheKey,
    confirmation.allowed,
    request.toolName
  );
}

// 3. 如果是拒绝，额外记录到拒绝操作列表
if (!confirmation.allowed) {
  this.recordDeniedOperation(
    guardResult.category,
    guardResult.cacheKey,
    `用户拒绝: ${guardResult.description}`,
    false  // sessionOnly = false，表示持久化
  );
}
```

### 应用启动时的加载流程

```typescript
// PermissionController 构造函数中
constructor(config: PermissionConfig) {
  // ...
  
  // 异步初始化持久化存储
  this.initDecisionStore().catch((err) => {
    this.log.warn('Failed to load denied operations:', err);
  });
}

private async initDecisionStore(): Promise<void> {
  if (!this.config.persistDecisions) {
    return;
  }

  // 1. 初始化 SQLite 数据库
  this.decisionStore = new DecisionStore(dbPath);
  await this.decisionStore.init();

  // 2. 加载所有拒绝操作记录
  await this.loadDeniedOperations();
}
```

## 数据库结构

### decisions 表

```sql
CREATE TABLE IF NOT EXISTS decisions (
  cache_key TEXT PRIMARY KEY,      -- 决策的唯一标识
  allowed INTEGER NOT NULL,        -- 1=允许, 0=拒绝
  tool_name TEXT NOT NULL,         -- 工具名称
  timestamp TEXT NOT NULL,         -- 记录时间 (ISO 8601)
  expires_at TEXT                  -- 可选过期时间 (ISO 8601)
)
```

### denied_operations 表

```sql
CREATE TABLE IF NOT EXISTS denied_operations (
  category TEXT NOT NULL,          -- 操作类别 (fileWrite, bash, etc.)
  pattern TEXT NOT NULL,           -- 操作模式 (文件路径、命令等)
  reason TEXT NOT NULL,            -- 拒绝原因
  timestamp INTEGER NOT NULL,      -- 拒绝时间戳
  PRIMARY KEY (category, pattern)
)
```

## 缓存键 (cacheKey) 生成规则

cacheKey 由 Guard 层生成，确保相同操作使用相同的键：

### FileGuard
```typescript
// 文件路径 + 操作类型
cacheKey = `${normalizedPath}:${toolName}`
// 例如: "/path/to/file.ts:write_file"
```

### CommandGuard
```typescript
// 命令的规范化形式
cacheKey = normalizedCommand
// 例如: "rm -rf /tmp/test"
```

## 配置选项

### persistDecisions (默认: true)
```typescript
{
  persistDecisions: true,  // 启用持久化
  decisionsFile: '~/.xuanji/permission-decisions.db'  // 可选，自定义路径
}
```

### 决策过期时间
```typescript
// 设置决策时可指定 TTL（天数）
await decisionStore.set(cacheKey, allowed, toolName, 30);  // 30天后过期
```

## 会话级 vs 持久化决策

### 会话级决策 (sessionOnly = true)
- 仅存储在内存中
- 应用重启后失效
- 用于临时决策

### 持久化决策 (sessionOnly = false)
- 存储在 SQLite 数据库
- 应用重启后仍然有效
- 用于"总是允许"/"总是不允许"

## 决策管理

### 查看所有决策
```typescript
const decisions = permissionController.listDecisions();
// 返回: PersistedDecisionInfo[]
```

### 删除特定决策
```typescript
await permissionController.deleteDecision(cacheKey);
```

### 清空所有决策
```typescript
await permissionController.clearDecisions();
```

### 查看拒绝操作
```typescript
const deniedOps = permissionController.listDeniedOperations();
// 返回: DeniedOperationInfo[]
```

## 意图跟踪机制

为了防止 AI 在同一任务中反复尝试被拒绝的操作类型，xuanji 引入了意图跟踪：

### 工作原理

```typescript
// 1. 用户发送新消息时，设置当前意图
permissionController.setCurrentUserIntent(userMessage);

// 2. 用户拒绝操作时，记录操作类型
if (!confirmation.allowed && guardResult.context?.operationType) {
  this.deniedIntentOperations.add(operationType);
  // 例如: 'delete', 'write', 'execute'
}

// 3. 后续检查时，阻止同类操作
if (this.deniedIntentOperations.has(operationType)) {
  return {
    allowed: false,
    reason: `您已拒绝当前任务中的${operationType}操作`,
    checkedBy: 'DeniedIntentFilter',
  };
}

// 4. 新用户消息会清空意图记录
setCurrentUserIntent(newIntent) {
  if (intent !== this.currentUserIntent) {
    this.deniedIntentOperations.clear();
  }
}
```

### 操作类型分类

- `delete`: 删除操作 (rm, unlink, etc.)
- `write`: 写入操作 (write_file, edit_file, etc.)
- `read`: 读取操作 (read_file, cat, etc.)
- `execute`: 执行操作 (bash, npm run, etc.)

## 最佳实践

### 1. 启用持久化
```typescript
const config: PermissionConfig = {
  persistDecisions: true,  // 推荐开启
  // ...
};
```

### 2. 定期清理过期决策
```typescript
// DecisionStore 会自动检查过期时间
// 访问时如果发现过期会自动删除
```

### 3. 备份决策数据库
```bash
# 数据库位置
~/.xuanji/permission-decisions.db
~/.xuanji/permission-decisions.db-wal
~/.xuanji/permission-decisions.db-shm
```

### 4. 重置所有决策
```typescript
// 通过 UI 或 API
await permissionController.clearDecisions();
await permissionController.clearDeniedOperations();
```

## 故障恢复

### 数据库损坏
如果数据库文件损坏，DecisionStore 会：
1. 记录警告日志
2. 将 `decisionStore` 设为 null
3. 降级为仅使用会话缓存

### 初始化失败
```typescript
try {
  await this.decisionStore.init();
} catch (err) {
  this.log.warn('Decision store init failed:', err);
  this.decisionStore = null;  // 降级处理
}
```

## 性能优化

### 1. 会话缓存优先
- 首先检查内存缓存，避免数据库查询
- 命中率高的操作响应时间 < 1ms

### 2. WAL 模式
- SQLite 使用 WAL (Write-Ahead Logging) 模式
- 提升并发读写性能

### 3. 缓存容量限制
```typescript
private static readonly MAX_DECISION_CACHE = 500;

// 超过限制时清空重建
if (this.decisionCache.size >= MAX_DECISION_CACHE) {
  this.decisionCache.clear();
}
```

### 4. 异步持久化
```typescript
// 持久化操作不阻塞主流程
this.decisionStore.set(...).catch((err) => {
  this.log.warn('Failed to persist decision:', err);
});
```

## 总结

xuanji 通过以下机制确保权限决策不会被遗忘：

1. **双层缓存**: 会话缓存 + SQLite 持久化
2. **自动加载**: 应用启动时自动加载历史决策
3. **回填机制**: 持久化缓存命中时回填会话缓存
4. **意图跟踪**: 防止 AI 在同一任务中反复尝试
5. **降级处理**: 数据库故障时降级为会话缓存
6. **性能优化**: 多级缓存 + WAL 模式

这套机制确保了用户的决策既能被可靠保存，又能高效访问。
