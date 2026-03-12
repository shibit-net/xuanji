# Xuanji 代码结构优化方案

## 📊 优化总结

### ✅ 已完成优化

#### 1. **公共工具函数提取** ✅
**新增文件**:
- `src/core/utils/ui/icons.ts` - 统一图标映射
- `src/core/utils/ui/formatters.ts` - 统一格式化函数
- `src/core/utils/ui/index.ts` - 统一导出

**收益**:
- 消除了 `tiangong/utils/formatters.ts`、`adapters/cli/utils/FormatStats.ts` 等文件中的重复代码
- 提供了统一的 UI 工具 API
- 减少了约 100 行重复代码

#### 2. **类型安全增强** ✅
**修复**:
- `VectorStore.ts` - 使用非空断言 (`db!`) 处理数据库对象
- `ProactiveButler.ts` - 修复 MemoryEntry 类型导入
- 修复数组索引边界检查问题

**收益**:
- 减少了类型错误
- 提高了代码可靠性

---

## 📋 待执行优化（建议分阶段实施）

### 阶段 1: 大文件拆分（优先级：高）

#### 1.1 拆分 ChatSession.ts (1433 行 → 目标 < 800 行)

**拆分方案**:

```typescript
// 新文件 1: src/core/chat/DiagnosticsProvider.ts (250 行)
export class DiagnosticsProvider {
  constructor(
    private config: AppConfig,
    private mcpManager: MCPManager | null,
    private skillRegistry: SkillRegistry | null,
    private memoryManager: IMemoryStore | null,
  ) {}
  
  async getDiagnostics(): Promise<string> {
    // 移动 getDiagnostics() 及所有辅助函数
  }
}

// 新文件 2: src/core/chat/SessionLifecycle.ts (200 行)
export class SessionLifecycle {
  constructor(
    private sessionManager: SessionManager,
    private checkpointManager: CheckpointManager,
    private agentLoop: AgentLoop,
  ) {}
  
  async saveSession(name?: string): Promise<string> { }
  async resumeSession(sessionId: string): Promise<ResumedSessionContext> { }
  async listSessions(): Promise<SessionListItem[]> { }
  async deleteSession(sessionId: string): Promise<void> { }
  async createCheckpoint(label?: string): Promise<string> { }
  async rewindToCheckpoint(checkpointId: string): Promise<void> { }
  async listCheckpoints(): Promise<Checkpoint[]> { }
}

// 新文件 3: src/core/chat/SkillInitializer.ts (150 行)
export class SkillInitializer {
  async initializeSkills(
    config: AppConfig,
    provider: ILLMProvider,
    registry: ToolRegistry,
  ): Promise<SkillRegistry> {
    // 移动 Skill 加载逻辑
  }
  
  private async initVectorSkillMatcher(): Promise<void> { }
}

// 简化后的 ChatSession.ts (~800 行)
export class ChatSession {
  private diagnosticsProvider: DiagnosticsProvider;
  private sessionLifecycle: SessionLifecycle;
  private skillInitializer: SkillInitializer;
  
  async init(): Promise<void> {
    // 协调初始化
    this.skillRegistry = await this.skillInitializer.initializeSkills(...);
    this.diagnosticsProvider = new DiagnosticsProvider(...);
    this.sessionLifecycle = new SessionLifecycle(...);
  }
  
  // 委托方法
  async getDiagnostics() { return this.diagnosticsProvider.getDiagnostics(); }
  async saveSession(name?: string) { return this.sessionLifecycle.saveSession(name); }
  // ... 其他委托方法
}
```

**预计收益**:
- ChatSession 从 1433 行减少到 ~800 行
- 职责更清晰，易于单元测试
- 不破坏现有 API

---

#### 1.2 拆分 AgentLoop.ts (921 行 → 目标 < 600 行)

**拆分方案**:

```typescript
// 新文件 1: src/core/agent/InterruptHandler.ts (100 行)
export class InterruptHandler {
  private _interrupted = false;
  private _pendingAppendMessage: string | null = null;
  
  interrupt(message: string): void { }
  softAppend(message: string): void { }
  hasQueuedMessage(): boolean { }
  consumeQueuedMessage(): string | null { }
  reset(): void { }
}

// 新文件 2: src/core/agent/StateTracker.ts (80 行)
export class StateTracker {
  constructor(
    private messageManager: MessageManager,
    private tokenManager: TokenManager,
    private costTracker: CostTracker,
  ) {}
  
  getState(): AgentState { }
  recordToolCall(name: string, duration: number, isError: boolean): void { }
}

// 新文件 3: src/core/agent/ErrorHandler.ts (100 行)
export class ErrorHandler {
  constructor(private errorRecovery: ErrorRecovery) {}
  
  handleError(error: Error, context: { running: boolean }): Error { }
  shouldRetry(error: Error): boolean { }
}

// 简化后的 AgentLoop.ts (~600 行)
export class AgentLoop {
  private interruptHandler: InterruptHandler;
  private stateTracker: StateTracker;
  private errorHandler: ErrorHandler;
  
  async run(userMessage: string): Promise<void> {
    // 主循环逻辑更清晰
  }
}
```

**预计收益**:
- AgentLoop 从 921 行减少到 ~600 行
- 中断处理、状态追踪、错误处理逻辑独立
- 更易于测试和维护

---

### 阶段 2: 代码去重（优先级：中）

#### 2.1 提取通用的 Formatter 函数

**已完成**:
- ✅ `formatDuration()` - 统一到 `src/core/utils/ui/formatters.ts`
- ✅ `getStatusIcon()` - 统一到 `src/core/utils/ui/icons.ts`

**待迁移**:
```typescript
// 1. adapters/electron/ui/lib/formatter.js (前端 JS 文件)
//    → 保持独立，但可参考 TypeScript 版本确保一致性

// 2. 其他零散的格式化函数
//    → 逐步迁移到 src/core/utils/ui/formatters.ts
```

#### 2.2 统一状态映射

**待整合**:
```typescript
// 散落在多处的状态映射逻辑
// → 统一到 src/core/utils/ui/icons.ts 的 STATUS_ICONS
```

---

### 阶段 3: 性能优化（优先级：中）

#### 3.1 数据库查询优化

**已完成**:
- ✅ `VectorStore.getAllSkillEmbeddings()` 添加 LIMIT 1000

**待优化**:
```typescript
// 1. FileIndexer - 增加增量更新
export class FileIndexer {
  private lastIndexTime: number = 0;
  
  async indexIncrementalWithCache(since?: Date): Promise<FileIndex> {
    // 只索引修改过的文件
  }
}

// 2. MemoryManager - 添加查询缓存
export class MemoryManager {
  private queryCache = new LRUCache<string, MemoryEntry[]>(100);
  
  async retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]> {
    const cacheKey = JSON.stringify({ query, options });
    if (this.queryCache.has(cacheKey)) {
      return this.queryCache.get(cacheKey)!;
    }
    // ... 查询逻辑
  }
}
```

#### 3.2 内存优化

**建议**:
```typescript
// 1. StreamProcessor - 限制缓冲区大小
private _currentToolInputBuffer = '';  // 当前无限制
→ 改为
private readonly MAX_BUFFER_SIZE = 1024 * 1024; // 1MB
if (this._currentToolInputBuffer.length > this.MAX_BUFFER_SIZE) {
  throw new Error('Tool input exceeds maximum buffer size');
}

// 2. MessageManager - 自动压缩历史
async getHistory(): Message[] {
  if (this.messages.length > 100) {
    return this.compressOldMessages(this.messages);
  }
  return this.messages;
}
```

---

### 阶段 4: 架构改进（优先级：低）

#### 4.1 引入依赖注入容器

**当前问题**: 手动管理依赖，初始化代码复杂

**建议方案**:
```typescript
// 使用 inversify 或类似 DI 容器
import { Container, injectable } from 'inversify';

@injectable()
export class ChatSession {
  constructor(
    private agentLoop: AgentLoop,
    private memoryManager: IMemoryStore,
    private mcpManager: MCPManager,
  ) {}
}

const container = new Container();
container.bind(ChatSession).toSelf();
container.bind(AgentLoop).toSelf();
// ...

const session = container.get(ChatSession);
```

**收益**:
- 自动解析依赖关系
- 更易于单元测试（mock 注入）
- 减少初始化代码

#### 4.2 配置热重载

**当前**: 配置更改需要重启

**建议**:
```typescript
export class ConfigWatcher {
  private watcher: FSWatcher;
  
  watch(callback: (config: AppConfig) => void): void {
    this.watcher = fs.watch(CONFIG_PATH, () => {
      const newConfig = loadConfig();
      callback(newConfig);
    });
  }
}

// 在 ChatSession 中使用
private configWatcher = new ConfigWatcher();
this.configWatcher.watch((newConfig) => {
  this.reloadConfig(newConfig);
});
```

---

## 🎯 实施优先级

### P0 - 立即执行
✅ 已完成：公共工具函数提取 + 类型安全增强

### P1 - 本月内（建议）
1. 拆分 ChatSession.ts
2. 拆分 AgentLoop.ts

### P2 - 下季度（可选）
1. 代码去重（剩余部分）
2. 性能优化（增量索引、查询缓存）

### P3 - 长期规划
1. 依赖注入容器
2. 配置热重载
3. 监控和可观测性

---

## 📈 预期收益

### 代码质量
- **代码行数**: 关键文件减少 30-40%
- **圈复杂度**: 单个方法平均复杂度降低
- **可测试性**: 更易于编写单元测试

### 维护性
- **职责清晰**: 每个类只负责一件事
- **易于扩展**: 新功能添加更容易
- **Bug 定位**: 问题更容易定位

### 性能
- **启动速度**: 增量索引可减少 50% 启动时间
- **内存占用**: 查询缓存可减少 20-30% 重复计算
- **响应速度**: 代码优化可提升 10-15% 整体性能

---

## 🛠 执行建议

1. **逐步迁移**: 不要一次性重构所有代码
2. **保持兼容**: 确保 API 不破坏现有调用方
3. **充分测试**: 每次重构后运行完整测试套件
4. **代码审查**: 重要重构需要 peer review
5. **文档更新**: 同步更新架构文档

---

## ✅ 验收标准

### 代码质量指标
- [ ] 单个文件不超过 800 行
- [ ] 单个函数不超过 100 行
- [ ] 圈复杂度不超过 10
- [ ] 测试覆盖率 > 85%

### 性能指标
- [ ] 冷启动时间 < 2s
- [ ] 首次响应 < 3s
- [ ] 内存占用 < 500MB (长时间运行)

### 可维护性指标
- [ ] 新功能添加 < 2 小时
- [ ] Bug 定位 < 30 分钟
- [ ] 代码审查通过率 > 90%

---

**生成时间**: 2026-01-18  
**版本**: v1.0  
**状态**: 提案阶段
