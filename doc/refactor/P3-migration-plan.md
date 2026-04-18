# P3 阶段迁移计划 - 现有代码迁移到新架构

## 目标
将现有代码迁移到 P0/P1/P2 创建的新架构，消除所有重复代码，统一架构风格。

## 迁移优先级

### 优先级 1：基础设施层（无依赖）
1. **ConfigManager → ConfigService**
   - 文件：`src/core/config/ConfigManager.ts`
   - 替换为：`src/infrastructure/config/ConfigService.ts`
   - 影响范围：全局配置访问

2. **存储层统一**
   - MemoryStore → SQLiteStorage/MemoryStorage
   - SessionStorage → SQLiteStorage
   - DecisionStore → SQLiteStorage
   - 影响范围：所有持久化逻辑

### 优先级 2：消息和事件（中间层）
3. **AgentLoop → MessageBus**
   - 文件：`src/core/agent/AgentLoop.ts`
   - 迁移：消息历史管理 → MessageBus
   - 影响范围：对话流程

4. **PermissionController → EventBus**
   - 文件：`src/permission/PermissionController.ts`
   - 迁移：审计日志 → EventBus
   - 影响范围：权限系统

### 优先级 3：工具执行（应用层）
5. **ToolRegistry → MiddlewarePipeline**
   - 文件：`src/core/tools/ToolRegistry.ts`
   - 迁移：权限检查、日志、错误处理 → 中间件
   - 影响范围：所有工具执行

### 优先级 4：清理和优化
6. **删除旧代码**
   - 标记 @deprecated 的类
   - 重复的工具函数
   - 未使用的导入

7. **更新测试**
   - 单元测试适配新接口
   - 集成测试验证迁移

---

## 详细迁移步骤

### 1. ConfigManager → ConfigService

#### 当前代码分析
```bash
# 查找 ConfigManager 使用位置
grep -r "ConfigManager" src/ --include="*.ts"
```

#### 迁移步骤
1. 创建 ConfigService 实例替换 ConfigManager
2. 更新所有 `config.get()` 调用
3. 迁移配置文件加载逻辑
4. 更新配置监听器

#### 影响文件（预估）
- `src/core/chat/ChatSession.ts`
- `src/core/agent/AgentLoop.ts`
- `src/core/providers/ProviderManager.ts`
- `src/permission/PermissionController.ts`
- 其他使用配置的模块

---

### 2. 存储层统一

#### 当前存储实现
- `src/memory/store/MemoryStore.ts` - 记忆存储
- `src/session/SessionStorage.ts` - 会话存储
- `src/permission/DecisionStore.ts` - 决策存储

#### 迁移策略
```typescript
// 旧代码
import { MemoryStore } from '@/memory/store';
const store = new MemoryStore(dbPath);

// 新代码
import { StorageFactory } from '@/infrastructure/storage';
const store = StorageFactory.create<MemoryEntry>('sqlite', {
  path: dbPath,
  tableName: 'memories'
});
```

#### 迁移步骤
1. 为每个存储类型定义数据模型接口
2. 使用 StorageFactory 创建存储实例
3. 更新所有 CRUD 操作调用
4. 迁移事务逻辑
5. 测试数据迁移脚本

---

### 3. AgentLoop → MessageBus

#### 当前消息管理
```typescript
// src/core/agent/AgentLoop.ts
export class AgentLoop {
  private messages: Message[] = [];
  
  addMessage(message: Message) {
    this.messages.push(message);
  }
  
  getHistory(): Message[] {
    return [...this.messages];
  }
}
```

#### 迁移后
```typescript
import { MessageBus } from '@/infrastructure/messaging';

export class AgentLoop {
  private messageBus: MessageBus;
  
  constructor() {
    this.messageBus = new MessageBus();
  }
  
  addMessage(message: Message) {
    this.messageBus.publish(message);
  }
  
  getHistory(): Message[] {
    return this.messageBus.getHistory();
  }
}
```

#### 迁移步骤
1. 在 AgentLoop 构造函数中初始化 MessageBus
2. 替换所有 `this.messages` 访问为 `this.messageBus` 调用
3. 删除 `messages` 数组和相关方法
4. 更新消息持久化逻辑（通过 MessageBus 订阅）

---

### 4. PermissionController → EventBus

#### 当前审计逻辑
```typescript
// src/permission/PermissionController.ts
async checkPermission(request: PermissionRequest): Promise<boolean> {
  const decision = await this.policy.evaluate(request);
  
  // 直接调用审计
  await this.audit.log({
    action: request.action,
    decision,
    timestamp: new Date()
  });
  
  return decision === 'granted';
}
```

#### 迁移后
```typescript
import { EventBus } from '@/infrastructure/messaging';

async checkPermission(request: PermissionRequest): Promise<boolean> {
  const decision = await this.policy.evaluate(request);
  
  // 发布事件，审计服务订阅
  await this.eventBus.emit('permission:evaluated', {
    request,
    decision,
    timestamp: new Date()
  });
  
  return decision === 'granted';
}
```

#### 迁移步骤
1. 在 PermissionController 中注入 EventBus
2. 将所有 `audit.log()` 调用替换为事件发布
3. 在 PermissionAudit 中订阅权限事件
4. 测试审计日志完整性

---

### 5. ToolRegistry → MiddlewarePipeline

#### 当前工具执行
```typescript
// src/core/tools/ToolRegistry.ts
async executeTool(name: string, args: any): Promise<ToolResult> {
  // 权限检查
  const allowed = await this.permissionController.checkPermission({...});
  if (!allowed) throw new PermissionDeniedError();
  
  // 日志
  logger.info(`[${name}] 开始执行`);
  
  // 执行
  try {
    const result = await tool.execute(args);
    logger.info(`[${name}] 执行成功`);
    return result;
  } catch (error) {
    logger.error(`[${name}] 执行失败`, error);
    throw error;
  }
}
```

#### 迁移后
```typescript
import { 
  MiddlewarePipeline, 
  PermissionMiddleware, 
  LoggingMiddleware,
  ErrorHandlingMiddleware 
} from '@/infrastructure/middleware';

export class ToolRegistry {
  private pipeline: MiddlewarePipeline<ToolContext, ToolResult>;
  
  constructor(permissionController: IPermissionController) {
    this.pipeline = new MiddlewarePipeline();
    this.pipeline
      .use(new ErrorHandlingMiddleware())
      .use(new LoggingMiddleware())
      .use(new PermissionMiddleware(permissionController));
  }
  
  async executeTool(name: string, args: any): Promise<ToolResult> {
    const context = { toolName: name, args, timestamp: new Date() };
    return this.pipeline.execute(context, async () => {
      return await tool.execute(args);
    });
  }
}
```

#### 迁移步骤
1. 在 ToolRegistry 构造函数中初始化 MiddlewarePipeline
2. 配置中间件链（ErrorHandling → Logging → Permission）
3. 重构 `executeTool` 方法使用管道
4. 删除重复的权限检查、日志、错误处理代码
5. 测试所有工具执行流程

---

## 迁移检查清单

### 代码迁移
- [ ] ConfigManager → ConfigService
- [ ] MemoryStore → SQLiteStorage
- [ ] SessionStorage → SQLiteStorage
- [ ] DecisionStore → SQLiteStorage
- [ ] AgentLoop 消息管理 → MessageBus
- [ ] PermissionController 审计 → EventBus
- [ ] ToolRegistry 执行逻辑 → MiddlewarePipeline

### 导入路径更新
- [ ] 更新所有 `@/memory/store` 导入
- [ ] 更新所有 `@/core/config` 导入
- [ ] 更新所有 `@/permission` 导入
- [ ] 添加 `@/infrastructure` 导入

### 代码清理
- [ ] 删除 `ConfigManager.ts`（标记 @deprecated）
- [ ] 删除旧的存储实现
- [ ] 删除重复的工具执行逻辑
- [ ] 删除未使用的导入和类型

### 测试更新
- [ ] 更新 ConfigService 单元测试
- [ ] 更新存储层单元测试
- [ ] 更新 MessageBus 集成测试
- [ ] 更新 ToolRegistry 集成测试
- [ ] 端到端测试验证

### 文档更新
- [ ] 更新 CLAUDE.md 架构说明
- [ ] 更新 API 文档
- [ ] 创建迁移指南
- [ ] 更新示例代码

---

## 风险评估

### 高风险项
1. **存储层迁移** - 可能导致数据丢失
   - 缓解：先备份数据，提供迁移脚本
   
2. **消息管理迁移** - 可能影响对话流程
   - 缓解：充分测试，保持接口兼容

### 中风险项
3. **配置管理迁移** - 可能导致配置丢失
   - 缓解：配置文件格式保持兼容
   
4. **工具执行迁移** - 可能影响所有工具
   - 缓解：逐个工具测试

### 低风险项
5. **事件总线集成** - 新增功能，不影响现有逻辑
6. **中间件管道** - 可选功能，渐进式迁移

---

## 回滚计划

如果迁移出现问题：

1. **Git 分支策略**
   - 在 `refactor/architecture-v2` 分支进行迁移
   - 保持 `master` 分支稳定
   - 每个迁移步骤单独提交

2. **功能开关**
   - 使用环境变量控制新旧实现切换
   - `USE_NEW_STORAGE=true/false`
   - `USE_MESSAGE_BUS=true/false`

3. **数据备份**
   - 迁移前自动备份所有数据库
   - 提供数据回滚脚本

---

## 时间估算

| 任务 | 预估时间 | 优先级 |
|------|---------|--------|
| ConfigManager 迁移 | 2 小时 | P0 |
| 存储层迁移 | 4 小时 | P0 |
| AgentLoop 迁移 | 2 小时 | P1 |
| PermissionController 迁移 | 2 小时 | P1 |
| ToolRegistry 迁移 | 3 小时 | P1 |
| 测试更新 | 3 小时 | P0 |
| 文档更新 | 2 小时 | P2 |
| **总计** | **18 小时** | - |

---

## 成功标准

1. ✅ 所有单元测试通过
2. ✅ 所有集成测试通过
3. ✅ 端到端测试通过
4. ✅ 代码覆盖率 > 80%
5. ✅ 无重复代码（DRY 原则）
6. ✅ 所有 @deprecated 代码已删除
7. ✅ 文档完整更新
8. ✅ 性能无回归（响应时间 < 原来的 110%）
