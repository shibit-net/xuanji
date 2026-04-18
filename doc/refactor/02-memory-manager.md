# MemoryManager 重构方案

## 一、现状分析

### 当前架构（上帝类）
```typescript
class MemoryManager implements IMemoryStore {
  private _store: MemoryStore;                    // 存储
  private extractor: MemoryExtractor;             // 提取
  private retriever: MemoryRetriever;             // 检索
  private formatter: MemoryFormatter;             // 格式化
  private coreRuleStore: CoreRuleStore;           // 核心规则
  private vectorManager: VectorManager;           // 向量化
  private maintenanceScheduler: MemoryMaintenanceScheduler;  // 维护调度
  private shortTerm: ShortTermMemory;             // 短期记忆
  private decisionPointDetector: DecisionPointDetector;      // 决策点检测
  private decisionPointRetriever: DecisionPointMemoryRetriever;  // 决策点检索
  private identityManager: IdentityManager;       // 身份管理
  private dreamAgent: DreamAgent;                 // 梦境代理
  private dreamScheduler: DreamScheduler;         // 梦境调度
  // 13+ 个子组件！
}
```

### 问题
1. **职责过多**：存储、检索、提取、维护、向量化全在一个类
2. **依赖复杂**：13+ 个子组件，初始化顺序复杂
3. **难以测试**：Mock 困难，测试覆盖率低
4. **难以扩展**：新增功能需要修改核心类

---

## 二、重构目标

### 新架构：按职责拆分

```typescript
// 1. 存储层（Infrastructure）
interface IMemoryStorage {
  save(entry: MemoryEntry): Promise<void>;
  query(filter: MemoryFilter): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  transaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R>;
}

class MemoryStorage implements IMemoryStorage {
  constructor(private db: Database) {}
  // 纯粹的数据访问逻辑
}

// 2. 检索层（Domain）
interface IMemoryRetrieval {
  retrieve(context: RetrievalContext): Promise<MemoryEntry[]>;
  buildDecisionContext(context: DecisionContext): Promise<string>;
  searchByVector(embedding: number[], topK: number): Promise<MemoryEntry[]>;
}

class MemoryRetrieval implements IMemoryRetrieval {
  constructor(
    private storage: IMemoryStorage,
    private vectorManager: VectorManager,
    private decayHalfLife: number
  ) {}
  
  async retrieve(context: RetrievalContext): Promise<MemoryEntry[]> {
    // 混合检索：关键词 + 向量 + 时间衰减
    const keywordResults = await this.storage.query({
      keywords: context.keywords,
      limit: 20
    });
    
    const vectorResults = await this.vectorManager.search(
      context.embedding,
      20
    );
    
    return this.mergeAndRank(keywordResults, vectorResults, context);
  }
}

// 3. 提取层（Domain）
interface IMemoryExtraction {
  extractFromConversation(messages: Message[]): Promise<MemoryEntry[]>;
  extractFromDecision(decision: DecisionContext): Promise<MemoryEntry[]>;
}

class MemoryExtraction implements IMemoryExtraction {
  constructor(
    private ruleEngine: RuleEngine,
    private llmExtractor: LLMExtractor
  ) {}
  
  async extractFromConversation(messages: Message[]): Promise<MemoryEntry[]> {
    // 1. 规则提取（快速）
    const ruleResults = await this.ruleEngine.extract(messages);
    
    // 2. LLM 提取（深度）
    const llmResults = await this.llmExtractor.extract(messages);
    
    return [...ruleResults, ...llmResults];
  }
}

// 4. 维护层（Domain）
interface IMemoryMaintenance {
  compact(): Promise<void>;
  archive(before: Date): Promise<void>;
  scheduleMaintenance(interval: number): void;
}

class MemoryMaintenance implements IMemoryMaintenance {
  constructor(
    private storage: IMemoryStorage,
    private compactor: MemoryCompactor,
    private scheduler: MaintenanceScheduler
  ) {}
  
  async compact(): Promise<void> {
    const entries = await this.storage.query({ all: true });
    const compacted = await this.compactor.compact(entries);
    
    await this.storage.transaction(async (tx) => {
      for (const entry of compacted) {
        await tx.save(entry);
      }
    });
  }
}

// 5. 协调器（Application）
class MemoryCoordinator implements IMemoryStore {
  constructor(
    private storage: IMemoryStorage,
    private retrieval: IMemoryRetrieval,
    private extraction: IMemoryExtraction,
    private maintenance: IMemoryMaintenance
  ) {}
  
  // 实现 IMemoryStore 接口，委托给各个服务
  async save(entry: MemoryEntry): Promise<void> {
    return this.storage.save(entry);
  }
  
  async retrieve(options: RetrieveOptions): Promise<MemoryEntry[]> {
    return this.retrieval.retrieve(options);
  }
}
```

---

## 三、实施步骤

### Step 1: 定义接口（Day 1）

```typescript
// src/memory/interfaces/IMemoryStorage.ts
export interface IMemoryStorage {
  save(entry: MemoryEntry): Promise<void>;
  saveBatch(entries: MemoryEntry[]): Promise<void>;
  query(filter: MemoryFilter): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  update(id: string, updates: Partial<MemoryEntry>): Promise<void>;
  transaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R>;
}

// src/memory/interfaces/IMemoryRetrieval.ts
export interface IMemoryRetrieval {
  retrieve(context: RetrievalContext): Promise<MemoryEntry[]>;
  buildDecisionContext(context: DecisionContext): Promise<string>;
  searchByKeywords(keywords: string[], limit: number): Promise<MemoryEntry[]>;
  searchByVector(embedding: number[], topK: number): Promise<MemoryEntry[]>;
}

// src/memory/interfaces/IMemoryExtraction.ts
export interface IMemoryExtraction {
  extractFromConversation(messages: Message[]): Promise<MemoryEntry[]>;
  extractFromDecision(decision: DecisionContext): Promise<MemoryEntry[]>;
  extractFromFeedback(feedback: string): Promise<MemoryEntry[]>;
}

// src/memory/interfaces/IMemoryMaintenance.ts
export interface IMemoryMaintenance {
  compact(): Promise<CompactionResult>;
  archive(before: Date): Promise<ArchiveResult>;
  vacuum(): Promise<void>;
  scheduleMaintenance(config: MaintenanceConfig): void;
  stopMaintenance(): void;
}
```

### Step 2: 实现存储层（Day 2）

```typescript
// src/memory/storage/MemoryStorage.ts
export class MemoryStorage implements IMemoryStorage {
  constructor(private db: Database) {}
  
  async save(entry: MemoryEntry): Promise<void> {
    await this.db.run(
      `INSERT INTO memories (id, type, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [entry.id, entry.type, entry.content, JSON.stringify(entry.metadata), entry.createdAt]
    );
  }
  
  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    await this.transaction(async (tx) => {
      for (const entry of entries) {
        await tx.save(entry);
      }
    });
  }
  
  async query(filter: MemoryFilter): Promise<MemoryEntry[]> {
    const { sql, params } = this.buildQuery(filter);
    const rows = await this.db.all(sql, params);
    return rows.map(this.rowToEntry);
  }
  
  async transaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
    await this.db.run('BEGIN TRANSACTION');
    try {
      const result = await fn(this.createTransaction());
      await this.db.run('COMMIT');
      return result;
    } catch (error) {
      await this.db.run('ROLLBACK');
      throw error;
    }
  }
  
  private buildQuery(filter: MemoryFilter): { sql: string; params: any[] } {
    // 构建 SQL 查询
  }
}
```

### Step 3: 实现检索层（Day 3）

```typescript
// src/memory/retrieval/MemoryRetrieval.ts
export class MemoryRetrieval implements IMemoryRetrieval {
  constructor(
    private storage: IMemoryStorage,
    private vectorManager: VectorManager,
    private weightEngine: MemoryWeightEngine
  ) {}
  
  async retrieve(context: RetrievalContext): Promise<MemoryEntry[]> {
    // 1. 并行检索
    const [keywordResults, vectorResults] = await Promise.all([
      this.searchByKeywords(context.keywords, 20),
      this.searchByVector(context.embedding, 20)
    ]);
    
    // 2. 合并去重
    const merged = this.mergeResults(keywordResults, vectorResults);
    
    // 3. 重新排序（权重计算）
    const ranked = this.rankByRelevance(merged, context);
    
    // 4. 返回 Top-K
    return ranked.slice(0, context.limit || 10);
  }
  
  async buildDecisionContext(context: DecisionContext): Promise<string> {
    // 1. 检索相关记忆
    const memories = await this.retrieve({
      keywords: context.keywords,
      embedding: context.embedding,
      limit: 5
    });
    
    // 2. 格式化为文本
    return this.formatMemories(memories);
  }
  
  private rankByRelevance(entries: MemoryEntry[], context: RetrievalContext): MemoryEntry[] {
    return entries
      .map(entry => ({
        entry,
        score: this.weightEngine.calculate(entry, context)
      }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.entry);
  }
}
```

### Step 4: 实现提取层（Day 4）

```typescript
// src/memory/extraction/MemoryExtraction.ts
export class MemoryExtraction implements IMemoryExtraction {
  constructor(
    private ruleEngine: RuleEngine,
    private llmExtractor: LLMExtractor,
    private classifier: MemoryClassifier
  ) {}
  
  async extractFromConversation(messages: Message[]): Promise<MemoryEntry[]> {
    // 1. 规则提取（快速，低成本）
    const ruleResults = await this.ruleEngine.extract(messages);
    
    // 2. 判断是否需要 LLM 提取
    const needsLLM = this.shouldUseLLM(messages, ruleResults);
    
    if (!needsLLM) {
      return ruleResults;
    }
    
    // 3. LLM 提取（深度，高成本）
    const llmResults = await this.llmExtractor.extract(messages);
    
    // 4. 合并结果
    const merged = [...ruleResults, ...llmResults];
    
    // 5. 分类和去重
    return this.classifier.classify(merged);
  }
  
  private shouldUseLLM(messages: Message[], ruleResults: MemoryEntry[]): boolean {
    // 启发式判断：
    // - 消息包含决策关键词
    // - 规则提取结果少于 3 条
    // - 消息长度超过阈值
    return (
      this.hasDecisionKeywords(messages) ||
      ruleResults.length < 3 ||
      this.getTotalLength(messages) > 1000
    );
  }
}
```

### Step 5: 实现维护层（Day 5）

```typescript
// src/memory/maintenance/MemoryMaintenance.ts
export class MemoryMaintenance implements IMemoryMaintenance {
  constructor(
    private storage: IMemoryStorage,
    private compactor: MemoryCompactor,
    private scheduler: MaintenanceScheduler
  ) {}
  
  async compact(): Promise<CompactionResult> {
    const startTime = Date.now();
    
    // 1. 查询所有记忆
    const entries = await this.storage.query({ all: true });
    
    // 2. 压缩
    const compacted = await this.compactor.compact(entries);
    
    // 3. 保存
    await this.storage.transaction(async (tx) => {
      // 删除旧记忆
      for (const entry of entries) {
        await tx.delete(entry.id);
      }
      // 保存新记忆
      await tx.saveBatch(compacted);
    });
    
    return {
      originalCount: entries.length,
      compactedCount: compacted.length,
      duration: Date.now() - startTime
    };
  }
  
  async archive(before: Date): Promise<ArchiveResult> {
    // 归档旧记忆到文件
    const entries = await this.storage.query({
      createdBefore: before
    });
    
    // 写入归档文件
    await this.writeArchive(entries);
    
    // 从数据库删除
    await this.storage.transaction(async (tx) => {
      for (const entry of entries) {
        await tx.delete(entry.id);
      }
    });
    
    return {
      archivedCount: entries.length,
      archiveFile: this.getArchiveFilePath(before)
    };
  }
  
  scheduleMaintenance(config: MaintenanceConfig): void {
    this.scheduler.schedule({
      compact: {
        interval: config.compactInterval || 24 * 60 * 60 * 1000, // 24h
        task: () => this.compact()
      },
      archive: {
        interval: config.archiveInterval || 7 * 24 * 60 * 60 * 1000, // 7d
        task: () => this.archive(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      }
    });
  }
}
```

### Step 6: 实现协调器（Day 6）

```typescript
// src/memory/MemoryCoordinator.ts
export class MemoryCoordinator implements IMemoryStore {
  constructor(
    private storage: IMemoryStorage,
    private retrieval: IMemoryRetrieval,
    private extraction: IMemoryExtraction,
    private maintenance: IMemoryMaintenance
  ) {}
  
  // === IMemoryStore 接口实现 ===
  
  async save(entry: MemoryEntry): Promise<void> {
    return this.storage.save(entry);
  }
  
  async retrieve(options: RetrieveOptions): Promise<MemoryEntry[]> {
    return this.retrieval.retrieve(options);
  }
  
  async extractAndSave(messages: Message[]): Promise<void> {
    const entries = await this.extraction.extractFromConversation(messages);
    await this.storage.saveBatch(entries);
  }
  
  async compact(): Promise<void> {
    await this.maintenance.compact();
  }
  
  // === 高级功能 ===
  
  async buildDecisionContext(context: DecisionContext): Promise<string> {
    return this.retrieval.buildDecisionContext(context);
  }
  
  scheduleMaintenance(config: MaintenanceConfig): void {
    this.maintenance.scheduleMaintenance(config);
  }
}
```

### Step 7: 迁移和测试（Day 7）

```typescript
// 迁移策略：Feature Flag
const USE_NEW_MEMORY = process.env.XUANJI_USE_NEW_MEMORY === 'true';

export function createMemoryManager(config: MemoryConfig): IMemoryStore {
  if (USE_NEW_MEMORY) {
    // 新实现
    const storage = new MemoryStorage(db);
    const retrieval = new MemoryRetrieval(storage, vectorManager, weightEngine);
    const extraction = new MemoryExtraction(ruleEngine, llmExtractor, classifier);
    const maintenance = new MemoryMaintenance(storage, compactor, scheduler);
    
    return new MemoryCoordinator(storage, retrieval, extraction, maintenance);
  } else {
    // 旧实现
    return new MemoryManager(config);
  }
}
```

---

## 四、测试策略

### 单元测试
```typescript
describe('MemoryStorage', () => {
  it('should save and query entries', async () => {
    const storage = new MemoryStorage(mockDb);
    await storage.save(mockEntry);
    const results = await storage.query({ id: mockEntry.id });
    expect(results).toHaveLength(1);
  });
  
  it('should support transactions', async () => {
    const storage = new MemoryStorage(mockDb);
    await storage.transaction(async (tx) => {
      await tx.save(entry1);
      await tx.save(entry2);
    });
    // 验证事务提交
  });
});

describe('MemoryRetrieval', () => {
  it('should merge keyword and vector results', async () => {
    const retrieval = new MemoryRetrieval(mockStorage, mockVectorManager, mockWeightEngine);
    const results = await retrieval.retrieve({
      keywords: ['test'],
      embedding: [0.1, 0.2],
      limit: 10
    });
    expect(results).toBeDefined();
  });
});
```

### 集成测试
```typescript
describe('MemoryCoordinator Integration', () => {
  it('should extract and save memories from conversation', async () => {
    const coordinator = createMemoryCoordinator();
    await coordinator.extractAndSave(mockMessages);
    
    const results = await coordinator.retrieve({
      keywords: ['test'],
      limit: 10
    });
    
    expect(results.length).toBeGreaterThan(0);
  });
});
```

---

## 五、迁移计划

### 阶段 1：并行运行（1 周）
- 新旧实现同时运行
- 通过 Feature Flag 控制
- 对比结果，验证正确性

### 阶段 2：灰度发布（1 周）
- 10% 流量使用新实现
- 监控性能和错误率
- 逐步提升到 100%

### 阶段 3：清理旧代码（1 周）
- 删除旧实现
- 更新文档
- 清理 Feature Flag

---

## 六、收益评估

| 指标 | 旧实现 | 新实现 | 提升 |
|------|--------|--------|------|
| 类复杂度 | 500+ 行 | 4 个类，各 100-150 行 | -60% |
| 测试覆盖率 | 30% | 85% | +183% |
| 新增功能耗时 | 4h | 1h | -75% |
| 单元测试耗时 | 5s | 0.5s | -90% |
