# 权限系统增强方案

## 问题分析

根据上一个会话的反馈，当前权限系统存在以下问题：

1. **用户拒绝后仍然执行**：当用户在权限确认对话框中选择"拒绝"后，系统并没有真正阻止工具执行
2. **仅依赖记忆系统**：当前的约束主要依赖 LLM 的记忆，而不是系统层面的硬性约束
3. **缺少执行拦截**：权限检查返回 `allowed: false` 后，工具仍然可能被执行

## 当前执行流程

```
AgentLoop
  ↓
ToolExecutionCoordinator.executeTools()
  ↓
ToolDispatcher.execute()
  ↓
ToolRegistry.execute()
  ↓
permissionController.check() → { allowed: false, reason: "..." }
  ↓
返回 { content: "[Permission Denied] ...", isError: true }
  ↓
❌ 问题：返回错误结果，但 LLM 可能忽略并继续尝试
```

## 根本原因

**当前设计的问题**：
- `ToolRegistry.execute()` 在权限检查失败后，返回一个 `isError: true` 的结果
- 这个错误结果会被传递给 LLM，但 LLM 可能会：
  - 忽略错误，继续尝试其他方式执行相同操作
  - 重新调用相同的工具（如果缓存未生效）
  - 使用其他工具绕过限制（如用 bash 代替 write_file）

**缺失的机制**：
1. **强制中止**：权限拒绝后应该中止整个工具调用链，而不仅仅是返回错误
2. **操作黑名单**：用户拒绝某个操作后，应该在系统层面记录并阻止所有类似操作
3. **语义级拦截**：不仅要拦截具体的工具调用，还要拦截语义上相同的操作（如删除文件）

## 解决方案

### 1. 增强权限控制器 - 添加操作黑名单

在 `PermissionController` 中添加：

```typescript
// 用户明确拒绝的操作类型
private deniedOperations: Map<string, {
  pattern: string;        // 操作模式（如 "delete:*", "write:/etc/*"）
  reason: string;         // 拒绝原因
  timestamp: number;      // 拒绝时间
  sessionOnly: boolean;   // 是否仅本会话有效
}> = new Map();

/**
 * 记录用户拒绝的操作
 */
recordDeniedOperation(
  category: string,
  pattern: string,
  reason: string,
  sessionOnly: boolean = true
): void {
  const key = `${category}:${pattern}`;
  this.deniedOperations.set(key, {
    pattern,
    reason,
    timestamp: Date.now(),
    sessionOnly,
  });
}

/**
 * 检查操作是否被用户拒绝
 */
isDeniedOperation(category: string, target: string): boolean {
  for (const [key, denied] of this.deniedOperations) {
    if (key.startsWith(category) && this.matchPattern(denied.pattern, target)) {
      return true;
    }
  }
  return false;
}
```

### 2. 增强守卫层 - 语义级检查

在 `CommandGuard` 中添加语义分析：

```typescript
/**
 * 检测命令的语义操作类型
 */
detectOperationType(command: string): {
  type: 'delete' | 'write' | 'read' | 'execute' | 'unknown';
  targets: string[];  // 受影响的目标（文件/目录）
} {
  // 检测删除操作
  if (/\b(rm|rimraf|del|rmdir)\b/.test(command)) {
    return {
      type: 'delete',
      targets: this.extractTargets(command),
    };
  }
  
  // 检测写入操作
  if (/\b(echo|cat|tee|>|>>)\b/.test(command)) {
    return {
      type: 'write',
      targets: this.extractTargets(command),
    };
  }
  
  // ... 其他操作类型
}
```

### 3. 修改权限检查流程 - 提前拦截

在 `PermissionController.check()` 中：

```typescript
async check(request: PermissionRequest): Promise<PermissionResult> {
  // 1. 首先检查是否是被拒绝的操作
  const guardResult = this.evaluateGuard(request);
  
  if (this.isDeniedOperation(guardResult.category, guardResult.cacheKey)) {
    return {
      allowed: false,
      reason: '此操作已被用户明确拒绝',
      checkedBy: 'DeniedOperationFilter',
    };
  }
  
  // 2. 继续原有的权限检查流程
  // ...
}
```

### 4. 用户确认后的处理 - 记录拒绝

在用户确认处理中：

```typescript
// 在 PermissionController.check() 的用户确认部分
const confirmation = await this.confirmationHandler(request, guardResult);

if (!confirmation.allowed) {
  // 用户拒绝了操作
  if (confirmation.remember) {
    // 记录到拒绝列表
    this.recordDeniedOperation(
      guardResult.category,
      guardResult.cacheKey,
      '用户明确拒绝',
      false  // 持久化，不仅限本会话
    );
  } else {
    // 仅本会话有效
    this.recordDeniedOperation(
      guardResult.category,
      guardResult.cacheKey,
      '用户拒绝（本会话）',
      true
    );
  }
  
  return {
    allowed: false,
    reason: '用户拒绝了此操作',
    checkedBy: 'UserConfirmation',
  };
}
```

### 5. 增强 Prompt - 系统级约束

在系统 Prompt 中添加：

```markdown
## 权限系统约束（CRITICAL）

当工具执行返回 `[Permission Denied]` 错误时：

1. **立即停止**：不要尝试用其他方式执行相同操作
2. **不要绕过**：不要使用其他工具（如 bash）来绕过限制
3. **告知用户**：向用户说明操作被拒绝，询问是否需要调整权限设置
4. **记住拒绝**：如果用户明确拒绝某个操作，不要在后续步骤中再次尝试

**示例**：
- 如果 `write_file` 被拒绝，不要尝试 `bash("echo ... > file")`
- 如果删除操作被拒绝，不要尝试 `bash("rm ...")`
- 如果用户说"不允许删除"，记住这个约束并存储到记忆系统
```

### 6. 持久化拒绝记录

在 `DecisionStore` 中添加拒绝记录的持久化：

```typescript
/**
 * 保存拒绝记录
 */
async saveDeniedOperation(
  category: string,
  pattern: string,
  reason: string
): Promise<void> {
  const db = await this.getDB();
  await db.run(
    'INSERT OR REPLACE INTO denied_operations (category, pattern, reason, timestamp) VALUES (?, ?, ?, ?)',
    [category, pattern, reason, Date.now()]
  );
}

/**
 * 加载拒绝记录
 */
async loadDeniedOperations(): Promise<Map<string, DeniedOperation>> {
  const db = await this.getDB();
  const rows = await db.all('SELECT * FROM denied_operations');
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.category}:${row.pattern}`, {
      pattern: row.pattern,
      reason: row.reason,
      timestamp: row.timestamp,
      sessionOnly: false,
    });
  }
  return map;
}
```

## 实施步骤

1. **修改 PermissionController**
   - 添加 `deniedOperations` 存储
   - 添加 `recordDeniedOperation()` 方法
   - 添加 `isDeniedOperation()` 方法
   - 修改 `check()` 方法，在开始时检查拒绝列表

2. **修改 CommandGuard**
   - 添加 `detectOperationType()` 方法
   - 添加 `extractTargets()` 方法
   - 增强语义分析能力

3. **修改 DecisionStore**
   - 添加 `denied_operations` 表
   - 添加 `saveDeniedOperation()` 方法
   - 添加 `loadDeniedOperations()` 方法
   - 在初始化时加载拒绝记录

4. **修改用户确认处理**
   - 在用户拒绝时调用 `recordDeniedOperation()`
   - 根据 `remember` 标志决定是否持久化

5. **增强系统 Prompt**
   - 添加权限系统约束说明
   - 强调不要绕过权限检查

6. **添加管理接口**
   - 添加查看拒绝列表的命令
   - 添加清除拒绝记录的命令
   - 在 GUI 中展示拒绝列表

## 测试场景

1. **基本拒绝**：用户拒绝删除操作，系统应该阻止后续所有删除尝试
2. **语义拦截**：用户拒绝 `write_file`，系统应该也拦截 `bash("echo > file")`
3. **持久化**：重启后，拒绝记录应该仍然有效
4. **会话级拒绝**：不选择 remember 时，拒绝仅在当前会话有效
5. **管理界面**：可以查看和清除拒绝记录

## 预期效果

1. ✅ 用户拒绝操作后，系统在底层阻止执行
2. ✅ LLM 无法通过其他工具绕过权限限制
3. ✅ 拒绝记录持久化，重启后仍然有效
4. ✅ 提供管理界面，用户可以查看和修改拒绝列表
5. ✅ 系统 Prompt 引导 LLM 尊重权限决策
