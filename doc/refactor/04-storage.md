# 统一存储接口方案

## 一、现状分析

### 当前存储接口（不统一）

```typescript
// 1. MemoryStore
interface IMemoryStore {
  save(entry: MemoryEntry): Promise<void>;
  retrieve(options: RetrieveOptions): Promise<MemoryEntry[]>;
  // 没有 delete、update、transaction
}

// 2. SessionStorage
class SessionStorage {
  save(snapshot: SessionSnapshot): Promise<void>;
  load(sessionId: string): Promise<SessionSnapshot | null>;
  list(): Promise<SessionListItem[]>;
  delete(sessionId: string): Promise<void>;
  // 方法名不一致：save/load vs save/retrieve
}

// 3. DecisionStore
class DecisionStore {
  saveDecision(info: PersistedDecisionInfo): Promise<void>;
  loadDecisions(): Promise<PersistedDecisionInfo[]>;
  clearDecisions(): Promise<void>;
  // 方法名又不一样：saveDecision/loadDecisions
}
```

### 问题
1. **接口不统一**：save/load、save/retrieve、saveDecision/loadDecisions
2. **功能不一致**：有的支持 delete，有的不支持
3. **事务支持**：只有 MemoryStore 有事务，其他没有
4. **难以切换**：无法统一替换存储后端

---

## 二、重构目标

### 统一存储抽象

```typescript
// 1. 基础存储接口
interface IStorage<T> {
  save(id: string, data: T): Promise<void>;
  load(id: string): Promise<T | null>;
  query(filter: QueryFilter): Promise<T[]>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}

// 2. 批量操作接口
interface IBatchStorage<T> extends IStorage<T> {
  saveBatch(items: Array<{ id: string; data: T }>): Promise<void>;
  loadBatch(ids: string[]): Promise<Map<string, T>>;
  deleteBatch(ids: string[]): Promise<void>;
}

// 3. 事务接口
interface ITransactionalStorage<T> extends IStorage<T> {
  transaction<R>(fn: (tx: Transaction<T>) => Promise<R>): Promise<R>;
}

// 4. 查询接口
interface IQueryableStorage<T> extends IStorage<T> {
  query(filter: QueryFilter): Promise<T[]>;
  count(filter: QueryFilter): Promise<number>;
  search(query: SearchQuery): Promise<SearchResult<T>>;
}

// 5. 完整存储接口
interface IFullStorage<T> extends 
  IBatchStorage<T>, 
  ITransactionalStorage<T>, 
  IQueryableStorage<T> {}
```

### 具体实现

```typescript
// 1. SQLite 存储实现
class SQLiteStorage<T> implements IFullStorage<T> {
  constructor(
    private db: Database,
    private tableName: string,
    private serializer: Serializer<T>
  ) {}
  
  async save(id: string, data: T): Promise<void> {
    const serialized = this.serializer.serialize(data);
    await this.db.run(
      `INSERT OR REPLACE INTO ${this.tableName} (id, data, updated_at) VALUES (?, ?, ?)`,
      [id, serialized, Date.now()]
    );
  }
  
  async load(id: string): Promise<T | null> {
    const row = await this.db.get(
      `SELECT data FROM ${this.tableName} WHERE id = ?`,
      [id]
    );
    return row ? this.serializer.deserialize(row.data) : null;
  }
  
  async query(filter: QueryFilter): Promise<T[]> {
    const { sql, params } = this.buildQuery(filter);
    const rows = await this.db.all(sql, params);
    return rows.map(row => this.serializer.deserialize(row.data));
  }
  
  async transaction<R>(fn: (tx: Transaction<T>) => Promise<R>): Promise<R> {
    await this.db.run('BEGIN TRANSACTION');
    try {
      const tx = new SQLiteTransaction(this.db, this.tableName, this.serializer);
      const result = await fn(tx);
      await this.db.run('COMMIT');
      return result;
    } catch (error) {
      await this.db.run('ROLLBACK');
      throw error;
    }
  }
}

// 2. 内存存储实现（用于测试）
class MemoryStorage<T> implements IFullStorage<T> {
  private data = new Map<string, T>();
  
  async save(id: string, data: T): Promise<void> {
    this.data.set(id, structuredClone(data));
  }
  
  async load(id: string): Promise<T | null> {
    const data = this.data.get(id);
    return data ? structuredClone(data) : null;
  }
  
  async query(filter: QueryFilter): Promise<T[]> {
    const results: T[] = [];
    for (const [id, data] of this.data) {
      if (this.matchFilter(id, data, filter)) {
        results.push(structuredClone(data));
      }
    }
    return results;
  }
  
  async transaction<R>(fn: (tx: Transaction<T>) => Promise<R>): Promise<R> {
    // 内存存储的事务是原子的（单线程）
    const tx = new MemoryTransaction(this.data);
    return await fn(tx);
  }
}

// 3. 文件存储实现
class FileStorage<T> implements IStorage<T> {
  constructor(
    private baseDir: string,
    private serializer: Serializer<T>
  ) {}
  
  async save(id: string, data: T): Promise<void> {
    const filePath = join(this.baseDir, `${id}.json`);
    const serialized = this.serializer.serialize(data);
    await writeFile(filePath, serialized, 'utf-8');
  }
  
  async load(id: string): Promise<T | null> {
    const filePath = join(this.baseDir, `${id}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return this.serializer.deserialize(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
  
  async query(filter: QueryFilter): Promise<T[]> {
    const files = await readdir(this.baseDir);
    const results: T[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.replace('.json', '');
      const data = await this.load(id);
      if (data && this.matchFilter(id, data, filter)) {
        results.push(data);
      }
    }
    
    return results;
  }
}
```

---

## 三、迁移方案

### Step 1: 定义统一接口（Day 1）

```typescript
// src/infrastructure/storage/interfaces.ts
export interface IStorage<T> {
  save(id: string, data: T): Promise<void>;
  load(id: string): Promise<T | null>;
  query(filter: QueryFilter): Promise<T[]>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}

export interface QueryFilter {
  where?: Record<string, any>;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
}

export interface Transaction<T> {
  save(id: string, data: T): Promise<void>;
  load(id: string): Promise<T | null>;
  delete(id: string): Promise<void>;
}

export interface Serializer<T> {
  serialize(data: T): string;
  deserialize(str: string): T;
}
```

### Step 2: 实现基础存储（Day 2）

```typescript
// src/infrastructure/storage/SQLiteStorage.ts
export class SQLiteStorage<T> implements IFullStorage<T> {
  // 实现代码见上方
}

// src/infrastructure/storage/MemoryStorage.ts
export class MemoryStorage<T> implements IFullStorage<T> {
  // 实现代码见上方
}

// src/infrastructure/storage/FileStorage.ts
export class FileStorage<T> implements IStorage<T> {
  // 实现代码见上方
}
```

### Step 3: 迁移 MemoryStore（Day 3）

```typescript
// src/memory/MemoryStorage.ts（新）
export class MemoryStorage implements IFullStorage<MemoryEntry> {
  private storage: SQLiteStorage<MemoryEntry>;
  
  constructor(dbPath: string) {
    const db = new Database(dbPath);
    this.storage = new SQLiteStorage(db, 'memories', new MemorySerializer());
  }
  
  async save(id: string, data: MemoryEntry): Promise<void> {
    return this.storage.save(id, data);
  }
  
  async load(id: string): Promise<MemoryEntry | null> {
    return this.storage.load(id);
  }
  
  async query(filter: QueryFilter): Promise<MemoryEntry[]> {
    return this.storage.query(filter);
  }
  
  // 保持向后兼容的旧接口
  async retrieve(options: RetrieveOptions): Promise<MemoryEntry[]> {
    return this.query(this.convertOptions(options));
  }
  
  private convertOptions(options: RetrieveOptions): QueryFilter {
    return {
      where: {
        type: options.type,
        scope: options.scope
      },
      limit: options.limit
    };
  }
}
```

### Step 4: 迁移 SessionStorage（Day 4）

```typescript
// src/session/SessionStorage.ts（重构）
export class SessionStorage implements IStorage<SessionSnapshot> {
  private storage: FileStorage<SessionSnapshot>;
  
  constructor(baseDir: string) {
    this.storage = new FileStorage(baseDir, new SessionSerializer());
  }
  
  async save(id: string, data: SessionSnapshot): Promise<void> {
    return this.storage.save(id, data);
  }
  
  async load(id: string): Promise<SessionSnapshot | null> {
    return this.storage.load(id);
  }
  
  async list(): Promise<SessionListItem[]> {
    const sessions = await this.storage.query({});
    return sessions.map(s => ({
      id: s.id,
      title: s.metadata.title,
      createdAt: s.metadata.createdAt,
      updatedAt: s.metadata.updatedAt
    }));
  }
}
```

### Step 5: 迁移 DecisionStore（Day 5）

```typescript
// src/permission/DecisionStorage.ts（新）
export class DecisionStorage implements IStorage<PersistedDecisionInfo> {
  private storage: FileStorage<PersistedDecisionInfo>;
  
  constructor(baseDir: string) {
    this.storage = new FileStorage(baseDir, new DecisionSerializer());
  }
  
  async save(id: string, data: PersistedDecisionInfo): Promise<void> {
    return this.storage.save(id, data);
  }
  
  async load(id: string): Promise<PersistedDecisionInfo | null> {
    return this.storage.load(id);
  }
  
  async loadAll(): Promise<PersistedDecisionInfo[]> {
    return this.storage.query({});
  }
  
  async clear(): Promise<void> {
    const all = await this.loadAll();
    for (const item of all) {
      await this.storage.delete(item.cacheKey);
    }
  }
}
```

---

## 四、收益

### 1. 接口统一
- 所有存储使用相同的方法名：save/load/query/delete
- 便于理解和使用

### 2. 易于切换
- 可以轻松切换存储后端（SQLite → PostgreSQL → Redis）
- 只需实现 IStorage 接口

### 3. 易于测试
- 使用 MemoryStorage 进行单元测试
- 无需真实数据库

### 4. 功能完整
- 统一支持批量操作、事务、查询
- 避免功能不一致

---

## 五、向后兼容

### 保留旧接口

```typescript
// src/memory/MemoryStore.ts（保留）
export class MemoryStore implements IMemoryStore {
  private storage: MemoryStorage;
  
  constructor(dbPath: string) {
    this.storage = new MemoryStorage(dbPath);
  }
  
  // 旧接口委托给新实现
  async save(entry: MemoryEntry): Promise<void> {
    return this.storage.save(entry.id, entry);
  }
  
  async retrieve(options: RetrieveOptions): Promise<MemoryEntry[]> {
    return this.storage.retrieve(options);
  }
}
```

### 渐进式迁移
1. 新代码使用新接口
2. 旧代码保持不变
3. 逐步迁移旧代码
4. 2 个版本后删除旧接口
