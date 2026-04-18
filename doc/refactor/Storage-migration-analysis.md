# 存储层统一迁移分析

## 当前存储实现

### 1. MemoryStore
**文件**: `src/memory/MemoryStore.ts` (753 行)

**职责**:
- 记忆系统的 SQLite 存储
- 支持 CRUD、FTS5 全文检索、向量存储、事务批量写入
- 数据库路径: `~/.xuanji/memory.db`

**特点**:
- 专门为记忆系统设计
- 包含复杂的业务逻辑（自动迁移、字段迁移、向量搜索）
- 支持全局记忆和项目级记忆
- 集成 sqlite-vec 扩展

**接口**:
```typescript
class MemoryStore {
  async init(): Promise<void>
  saveEntry(entry: MemoryEntry): void
  saveBatch(entries: MemoryEntry[]): void
  getEntry(id: string): MemoryEntry | null
  queryEntries(filter: MemoryFilter): MemoryEntry[]
  deleteEntry(id: string): void
  searchByVector(embedding: number[], limit: number): VectorSearchResult[]
  // ... 20+ 个专用方法
}
```

---

### 2. DecisionStore
**文件**: `src/permission/DecisionStore.ts` (302 行)

**职责**:
- 权限决策的 SQLite 存储
- 存储用户的 Always/Never 决策和拒绝操作记录
- 数据库路径: `~/.xuanji/permission-decisions.db`

**特点**:
- 专门为权限系统设计
- 两张表：decisions（决策）、denied_operations（拒绝操作）
- 支持过期时间

**接口**:
```typescript
class DecisionStore {
  async init(): Promise<void>
  get(cacheKey: string): boolean | undefined
  set(cacheKey: string, allowed: boolean, toolName: string, expiresAt?: Date): Promise<void>
  delete(cacheKey: string): Promise<void>
  clear(): Promise<void>
  getAll(): PersistedDecisionInfo[]
  loadDeniedOperations(): Map<string, DeniedOperation>
  saveDeniedOperation(category: string, pattern: string, reason: string): Promise<void>
  // ... 其他方法
}
```

---

### 3. SessionStorage
**文件**: `src/session/SessionStorage.ts` (473 行)

**职责**:
- 会话数据的 SQLite 存储
- 存储会话元数据、消息历史、检查点
- 数据库路径: `~/.xuanji/sessions.db`

**特点**:
- 专门为会话系统设计
- 三张表：sessions（会话）、messages（消息）、checkpoints（检查点）
- 支持会话列表、消息历史、检查点恢复

**接口**:
```typescript
class SessionStorage {
  async init(): Promise<void>
  async saveSession(session: SessionMetadata): Promise<void>
  async getSession(sessionId: string): Promise<SessionMetadata | null>
  async listSessions(limit?: number): Promise<SessionMetadata[]>
  async saveMessages(sessionId: string, messages: Message[]): Promise<void>
  async getMessages(sessionId: string): Promise<Message[]>
  async saveCheckpoint(checkpoint: SessionCheckpoint): Promise<void>
  // ... 其他方法
}
```

---

## 与 IStorage<T> 的对比

### IStorage<T> 接口
**文件**: `src/infrastructure/storage/interfaces.ts`

```typescript
export interface IStorage<T> {
  save(id: string, data: T): Promise<void>;
  load(id: string): Promise<T | null>;
  query(filter: QueryFilter): Promise<T[]>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}

export interface IFullStorage<T> extends 
  IBatchStorage<T>, 
  ITransactionalStorage<T>, 
  IQueryableStorage<T> {}
```

---

## 差异分析

| 特性 | MemoryStore | DecisionStore | SessionStorage | IStorage<T> |
|------|-------------|---------------|----------------|-------------|
| 定位 | 记忆系统专用 | 权限系统专用 | 会话系统专用 | 通用存储接口 |
| 数据模型 | MemoryEntry | Decision/DeniedOp | Session/Message | 泛型 T |
| 表结构 | 复杂（多表+FTS5+向量） | 简单（2 表） | 中等（3 表） | 单表 |
| 业务逻辑 | 大量（迁移、搜索） | 中等（过期、拒绝） | 中等（检查点） | 无 |
| 接口数量 | 20+ 方法 | 10+ 方法 | 15+ 方法 | 5 个基础方法 |
| 扩展性 | 低（硬编码） | 低（硬编码） | 低（硬编码） | 高（泛型） |

---

## 迁移评估

### 结论：不建议直接替换

**原因**:

1. **业务逻辑复杂**
   - MemoryStore 包含大量记忆系统特定的业务逻辑（753 行）
   - 自动迁移、字段迁移、向量搜索等功能无法用通用接口表达
   - 强行迁移会导致业务逻辑分散到多个地方

2. **数据模型差异**
   - 现有存储使用专门的数据模型（MemoryEntry、Decision、Session）
   - IStorage<T> 使用泛型，需要大量适配代码
   - 类型安全性降低

3. **接口不匹配**
   - 现有存储有 20+ 个专用方法
   - IStorage<T> 只有 5 个基础方法
   - 大量功能无法通过基础接口实现

4. **表结构复杂**
   - MemoryStore 使用多表 + FTS5 + 向量表
   - SessionStorage 使用 3 张关联表
   - IStorage<T> 假设单表结构

5. **迁移成本巨大**
   - 需要重写 1500+ 行代码
   - 需要适配所有调用方
   - 需要大量测试验证
   - 风险高，收益低

---

## 推荐方案

### 方案 1: 保持现状（强烈推荐）

**理由**:
- 现有存储实现职责清晰，代码稳定
- 每个存储都是为特定业务场景优化的
- 不存在重复代码问题（三个存储互不相同）
- 迁移成本远大于收益

**建议**:
- 保留现有的 MemoryStore、DecisionStore、SessionStorage
- 它们是业务逻辑类，不是基础设施类
- IStorage<T> 用于新的通用存储需求

### 方案 2: 内部优化（可选，低优先级）

如果要优化，可以提取公共的 SQLite 操作逻辑：

```typescript
// 提取公共基类
abstract class BaseSQLiteStore {
  protected db: Database | null = null;
  protected ready = false;
  
  async init(dbPath: string): Promise<void> {
    // 公共初始化逻辑
  }
  
  protected ensureReady(): void {
    if (!this.ready) throw new Error('Store not initialized');
  }
  
  protected transaction<T>(fn: () => T): T {
    return this.db!.transaction(fn)();
  }
}

// 各个存储继承基类
class MemoryStore extends BaseSQLiteStore {
  // 记忆系统特定逻辑
}

class DecisionStore extends BaseSQLiteStore {
  // 权限系统特定逻辑
}

class SessionStorage extends BaseSQLiteStore {
  // 会话系统特定逻辑
}
```

**收益**:
- 减少重复的初始化代码
- 统一事务处理逻辑
- 保持业务逻辑独立

**成本**:
- 需要重构三个存储类
- 需要测试验证
- 收益有限（重复代码不多）

---

## 决策

**选择方案 1: 保持现状**

**理由**:
1. 现有存储是业务逻辑类，不是基础设施类
2. 每个存储都有独特的业务需求和优化
3. 不存在显著的重复代码问题
4. 迁移成本 >> 收益
5. 符合"不要为了迁移而迁移"的原则

**IStorage<T> 的定位**:
- 用于新的通用存储需求
- 用于简单的键值存储场景
- 不适合替换现有的复杂业务存储

**类比**:
- MemoryStore ≈ MySQL（复杂业务数据库）
- IStorage<T> ≈ Redis（简单键值存储）
- 两者定位不同，不应该互相替换

---

## 经验总结

### 何时使用 IStorage<T>

✅ **适合使用**:
- 新的简单存储需求
- 键值对存储
- 缓存存储
- 临时数据存储
- 需要切换后端（SQLite/Memory/File）

❌ **不适合使用**:
- 复杂的业务数据存储
- 多表关联查询
- 全文检索
- 向量搜索
- 包含大量业务逻辑的存储

### 设计原则

1. **业务逻辑 vs 基础设施**
   - 业务逻辑类：保持专用实现
   - 基础设施类：使用通用接口

2. **抽象的代价**
   - 过度抽象会导致代码复杂度增加
   - 不是所有代码都需要抽象
   - 重复不一定是坏事

3. **迁移的判断标准**
   - 是否存在显著的重复代码？
   - 迁移后是否更简洁？
   - 迁移成本是否合理？
   - 是否符合业务需求？

---

**分析日期**: 2026-04-18  
**结论**: 不迁移  
**原因**: 业务逻辑类，迁移成本远大于收益
