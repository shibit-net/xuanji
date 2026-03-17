# 人类化记忆权重系统：真正可落地的方案

## 设计日期
2026-03-16

## 核心目标

> **像人类一样记忆：常用的记得清楚，不常用的慢慢模糊**

### 问题分析

**当前 xuanji 记忆系统存在的问题**：

1. **访问频次权重过低**（10%）
   - 即使访问 100 次的记忆，权重提升也很有限
   - 无法体现"常用记忆"的价值

2. **创建时间 vs 访问时间**
   - 当前只看创建时间（createdAt）
   - 一个 3 个月前创建但昨天刚用过的记忆，仍被认为是"旧记忆"

3. **缺少自动淘汰机制**
   - 低权重记忆一直保留
   - 检索时返回太多无关内容 → LLM 幻觉

4. **遗忘曲线单一**
   - 所有记忆用同一条曲线
   - 没有区分"重要记忆"和"日常对话"

---

## 人类记忆特征建模

### 特征 1: 记忆加固（Memory Consolidation）

人类每次回忆一个记忆，这个记忆会被**加固**（变得更清晰）。

**数学模型**：
```
每次访问 → lastAccessedAt 更新 → 遗忘曲线重置
```

**实现**：
```typescript
// ❌ 当前实现（只看创建时间）
const ageDays = (now - createdAt) / (24 * 60 * 60 * 1000);
const timeScore = Math.pow(0.5, ageDays / 30);

// ✅ 改进实现（看最近访问时间）
const daysSinceLastAccess = (now - lastAccessedAt) / (24 * 60 * 60 * 1000);
const timeScore = Math.pow(0.5, daysSinceLastAccess / 30);
```

**效果**：
- 昨天访问过的记忆 → timeScore ≈ 0.98（几乎无衰减）
- 30 天未访问的记忆 → timeScore = 0.5（衰减一半）
- 90 天未访问的记忆 → timeScore = 0.13（严重衰减）

---

### 特征 2: 访问频次决定长期保留

人类对反复使用的知识记得更牢固。

**数学模型**：
```
accessCount 越高 → 遗忘越慢（延长半衰期）
```

**实现**：
```typescript
// ❌ 当前实现（频次只占 10%，影响太小）
const accessScore = Math.log2(accessCount + 1) / 10;  // 0-1
const finalScore = 0.5 * vector + 0.2 * keyword + 0.2 * time + 0.1 * accessScore;

// ✅ 改进实现（频次影响衰减速度）
const baseHalfLife = 30; // 基础半衰期 30 天
const frequencyBonus = Math.log2(accessCount + 1) * 5; // 访问次数加成
const effectiveHalfLife = baseHalfLife + frequencyBonus;

const timeScore = Math.pow(0.5, daysSinceLastAccess / effectiveHalfLife);
```

**效果对比**：
| 访问次数 | 半衰期 | 30 天未访问的权重 |
|---------|--------|------------------|
| 0 次 | 30 天 | 0.50 |
| 5 次 | 42 天 | 0.65 |
| 15 次 | 50 天 | 0.71 |
| 50 次 | 58 天 | 0.76 |
| 100 次 | 65 天 | 0.79 |

**含义**：
- 访问 100 次的记忆，30 天未访问后仍保留 79% 权重
- 从未访问的记忆，30 天后只剩 50% 权重

---

### 特征 3: 分层遗忘（不同类型记忆衰减速度不同）

人类对不同类型记忆的保留时间不同：
- **技能知识**（骑车、编程）：几乎不忘
- **重要事件**（生日、项目决策）：慢忘
- **日常对话**：快忘

**实现**：
```typescript
interface MemoryTypeConfig {
  baseHalfLife: number;      // 基础半衰期
  importanceMultiplier: number; // 重要性乘数
}

const MEMORY_TYPE_CONFIG: Record<string, MemoryTypeConfig> = {
  'user-preference': { baseHalfLife: 90, importanceMultiplier: 1.5 },  // 用户偏好：90 天
  'project-knowledge': { baseHalfLife: 60, importanceMultiplier: 1.3 }, // 项目知识：60 天
  'skill-pattern': { baseHalfLife: 120, importanceMultiplier: 1.5 },    // 技能模式：120 天
  'important_date': { baseHalfLife: 180, importanceMultiplier: 2.0 },   // 重要日期：180 天
  'conversation': { baseHalfLife: 30, importanceMultiplier: 1.0 },      // 日常对话：30 天
  'short-term': { baseHalfLife: 7, importanceMultiplier: 0.8 },         // 短期记忆：7 天
};

function calcTimeDecayScore(memory: MemoryEntry): number {
  const config = MEMORY_TYPE_CONFIG[memory.type] || MEMORY_TYPE_CONFIG['conversation'];

  const daysSinceAccess = (Date.now() - new Date(memory.lastAccessedAt).getTime())
    / (24 * 60 * 60 * 1000);

  // 访问频次延长半衰期
  const frequencyBonus = Math.log2(memory.accessCount + 1) * 5;
  const effectiveHalfLife = config.baseHalfLife + frequencyBonus;

  // 重要性影响衰减速度
  const importance = memory.metadata?.importance === 'high' ? 1.5 :
                     memory.metadata?.importance === 'low' ? 0.7 : 1.0;

  const adjustedHalfLife = effectiveHalfLife * importance * config.importanceMultiplier;

  return Math.pow(0.5, daysSinceAccess / adjustedHalfLife);
}
```

**效果对比**（30 天未访问，5 次访问）：
| 记忆类型 | 半衰期 | 权重 |
|---------|--------|------|
| 短期记忆 | 12 天 | 0.18 ⬇️ |
| 日常对话 | 42 天 | 0.65 |
| 项目知识 | 88 天 | 0.80 |
| 用户偏好 | 135 天 | 0.87 ⬆️ |
| 技能模式 | 180 天 | 0.90 ⬆️⬆️ |

---

### 特征 4: 自动淘汰低权重记忆

**问题**：传入 LLM 的记忆太多 → 幻觉

**方案**：检索时只返回高权重记忆

```typescript
async retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]> {
  // 1. 向量检索（过采样）
  const candidates = await this.vectorStore.search(embedding, { limit: 50 });

  // 2. 混合评分
  const scored = this.hybridRetriever.rerank(candidates, query, options);

  // 3. 权重过滤（淘汰低权重记忆）
  const minWeight = options?.minWeight ?? 0.3; // 默认阈值 0.3
  const filtered = scored.filter(entry => {
    const weight = this.calcFinalWeight(entry);
    return weight >= minWeight;
  });

  // 4. 返回 Top-K
  return filtered.slice(0, options?.maxResults ?? 10);
}

private calcFinalWeight(entry: MemoryEntry): number {
  const timeScore = this.calcTimeDecayScore(entry);
  const frequencyScore = Math.log2(entry.accessCount + 1) / 10;
  const importanceScore = entry.metadata?.importance === 'high' ? 1.2 : 1.0;

  // 综合权重（时间衰减是核心）
  return timeScore * (1 + frequencyScore) * importanceScore;
}
```

**效果**：
- 低权重记忆（< 0.3）不会被检索到
- 减少传入 LLM 的记忆数量
- 避免幻觉

---

## 实施方案

### Phase 1: 优化 HybridRetriever（1-2 天）

#### 文件：`src/memory/HybridRetriever.ts`

**改动 1：使用 lastAccessedAt 而非 createdAt**

```typescript
/** 时间衰减得分（基于最近访问时间） */
private calcTimeDecayScore(memory: MemoryEntry): number {
  // ✓ 使用 lastAccessedAt（记忆加固效应）
  const lastAccess = new Date(memory.lastAccessedAt || memory.createdAt).getTime();
  const ageMs = Date.now() - lastAccess;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // ✓ 根据记忆类型调整半衰期
  const baseHalfLife = this.getHalfLifeForType(memory.type);

  // ✓ 访问频次延长半衰期
  const frequencyBonus = Math.log2(memory.accessCount + 1) * 5;

  // ✓ 重要性调整
  const importance = memory.metadata?.importance === 'high' ? 1.5 :
                     memory.metadata?.importance === 'low' ? 0.7 : 1.0;

  const effectiveHalfLife = (baseHalfLife + frequencyBonus) * importance;

  return Math.pow(0.5, ageDays / effectiveHalfLife);
}

private getHalfLifeForType(type: string): number {
  const config: Record<string, number> = {
    'user-preference': 90,
    'project-knowledge': 60,
    'skill-pattern': 120,
    'important_date': 180,
    'conversation': 30,
    'short-term': 7,
  };
  return config[type] || 30;
}
```

**改动 2：调整权重配比**

```typescript
// ❌ 旧权重
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,
  keywordMatch: 0.2,
  timeDecay: 0.2,
  accessFrequency: 0.1, // 太低！
};

// ✅ 新权重（时间衰减是核心）
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,   // 语义相似度仍是基础
  keywordMatch: 0.15,      // 略降低
  timeDecay: 0.3,          // 提升（人类记忆的核心）
  accessFrequency: 0.05,   // 降低（已整合到 timeDecay 中）
};
```

**改动 3：增加权重过滤**

```typescript
rerank(candidates, query, options) {
  // ... 现有评分逻辑 ...

  // ✓ 新增：计算最终权重并过滤
  const minWeight = options?.minWeight ?? 0.25;

  for (const candidate of candidates) {
    // ... 计算 finalScore ...

    // 计算综合权重（包含衰减）
    const timeScore = this.calcTimeDecayScore(candidate.memory);
    const frequencyBonus = 1 + Math.log2(candidate.memory.accessCount + 1) * 0.1;
    const weight = timeScore * frequencyBonus;

    // 只保留高权重记忆
    if (weight >= minWeight && adjustedScore > 0.01) {
      scored.push({
        entry: candidate.memory,
        score: adjustedScore,
        weight  // 新增字段，用于日志和调试
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map(s => s.entry);
}
```

---

### Phase 2: 更新 MemoryEntry 类型（5 分钟）

#### 文件：`src/memory/types.ts`

**确保 lastAccessedAt 字段存在**：

```typescript
export interface MemoryEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  keywords: string[];
  source: string;
  confidence: number;
  createdAt: string;
  lastAccessedAt: string;  // ✓ 已存在，确保所有地方都更新此字段
  accessCount: number;      // ✓ 已存在
  projectPath?: string;
  metadata?: MemoryMetadata;
}
```

---

### Phase 3: 更新访问计数（10 分钟）

#### 文件：`src/memory/MemoryManager.ts`

**在 retrieve() 时自动更新 lastAccessedAt 和 accessCount**：

```typescript
async retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]> {
  await this.init();

  let results: MemoryEntry[];

  if (this.vectorReady && this.vectorStore) {
    // 向量检索
    const embedding = await this.embeddingService!.embed(query);
    const candidates = await this.vectorStore.search(embedding, { limit: 50 });
    results = this.hybridRetriever.rerank(candidates, query, options);
  } else {
    // 降级到关键词检索
    results = this.retriever.retrieve(this.cachedEntries, query, options);
  }

  // ✓ 新增：更新访问记录（异步，不阻塞）
  this.updateAccessRecords(results.map(r => r.id)).catch(err => {
    log.warn('Failed to update access records:', err);
  });

  return results;
}

/** 更新访问记录（批量） */
private async updateAccessRecords(ids: string[]): Promise<void> {
  const now = new Date().toISOString();

  for (const id of ids) {
    const entry = this.cachedEntries.find(e => e.id === id);
    if (entry) {
      entry.lastAccessedAt = now;
      entry.accessCount += 1;
    }
  }

  // 持久化到磁盘（批量更新）
  await this.longTerm.updateBatch(this.cachedEntries.filter(e => ids.includes(e.id)));
}
```

---

### Phase 4: 配置参数（2 分钟）

#### 文件：`src/core/config/defaults.ts`

```typescript
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  shortTermMaxEntries: 50,
  longTermMaxEntries: 2000,
  retrieveMaxResults: 10,
  maxEntryLength: 2000,
  maxPromptLength: 8000,
  compactionThreshold: 100,

  // ✓ 遗忘曲线配置
  decayHalfLifeDays: 30,  // 基础半衰期（conversation 类型）

  // ✓ 新增：权重过滤阈值
  minRetrieveWeight: 0.25, // 最低权重阈值（低于此值不返回）

  // ✓ 新增：分层半衰期
  typeHalfLifeDays: {
    'user-preference': 90,
    'project-knowledge': 60,
    'skill-pattern': 120,
    'important_date': 180,
    'conversation': 30,
    'short-term': 7,
  },
};
```

---

## 效果预期

### 测试场景 1: 常用记忆保持高权重

```
记忆 A: "User prefers Bun over npm"
- 类型: user-preference
- 创建时间: 90 天前
- 最后访问: 昨天
- 访问次数: 50 次

计算权重:
  baseHalfLife = 90 天（用户偏好类型）
  frequencyBonus = log2(51) * 5 ≈ 28 天
  effectiveHalfLife = (90 + 28) * 1.5（高重要性）= 177 天

  daysSinceAccess = 1 天
  timeScore = 0.5^(1 / 177) ≈ 0.996 ✓

最终权重: 0.996 × 1.5（频次加成）≈ 1.0

结果: 几乎无衰减，稳定检索到
```

### 测试场景 2: 不常用记忆快速衰减

```
记忆 B: "Fixed a typo in README"
- 类型: conversation
- 创建时间: 60 天前
- 最后访问: 60 天前（从未访问）
- 访问次数: 0 次

计算权重:
  baseHalfLife = 30 天（日常对话）
  frequencyBonus = 0
  effectiveHalfLife = 30 天

  daysSinceAccess = 60 天
  timeScore = 0.5^(60 / 30) = 0.25 ⬇️

最终权重: 0.25 × 1.0 = 0.25

结果: 刚好在阈值边缘，可能被过滤
```

### 测试场景 3: 低价值记忆被淘汰

```
记忆 C: "User said hello"
- 类型: short-term
- 创建时间: 10 天前
- 最后访问: 10 天前
- 访问次数: 0 次

计算权重:
  baseHalfLife = 7 天（短期记忆）
  effectiveHalfLife = 7 天

  daysSinceAccess = 10 天
  timeScore = 0.5^(10 / 7) ≈ 0.37

最终权重: 0.37 × 0.8（低重要性）= 0.30

但 metadata.importance = 'low' → 额外 × 0.7
最终权重: 0.30 × 0.7 = 0.21 < 0.25 阈值

结果: 被过滤，不会传入 LLM ✓
```

---

## 代码改动清单

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `src/memory/HybridRetriever.ts` | 1. calcTimeDecayScore 使用 lastAccessedAt<br>2. 增加 getHalfLifeForType<br>3. 调整 HYBRID_WEIGHTS<br>4. 增加 weight 过滤 | 1-2 小时 |
| `src/memory/MemoryManager.ts` | 1. retrieve() 后更新 accessCount<br>2. 新增 updateAccessRecords() | 30 分钟 |
| `src/memory/LongTermMemory.ts` | 1. 新增 updateBatch() 方法 | 20 分钟 |
| `src/core/config/defaults.ts` | 1. 增加 typeHalfLifeDays 配置<br>2. 增加 minRetrieveWeight | 5 分钟 |
| `src/memory/types.ts` | 1. MemoryConfig 增加新字段 | 5 分钟 |

**总工作量：2-3 小时**

---

## 验证方法

### 测试 1: 常用记忆权重验证

```typescript
// 创建测试记忆
const memory = await memoryManager.store({
  content: 'User prefers Bun',
  type: 'user-preference',
  importance: 'high',
});

// 模拟 50 次访问
for (let i = 0; i < 50; i++) {
  await memoryManager.retrieve('package manager');
}

// 90 天后检查权重
// 预期：权重仍 > 0.9
```

### 测试 2: 低价值记忆淘汰验证

```typescript
// 创建低价值记忆
await memoryManager.store({
  content: 'User said hello',
  type: 'short-term',
  importance: 'low',
});

// 10 天后检索
const results = await memoryManager.retrieve('hello');

// 预期：此记忆不在结果中
```

### 测试 3: 记忆加固验证

```typescript
// 创建记忆
const memory = await memoryManager.store({
  content: 'React Hooks best practice',
  type: 'project-knowledge',
});

// 30 天后第一次检索
await sleep(30_days);
const results1 = await memoryManager.retrieve('React Hooks');
// 权重约 0.5

// 立即第二次检索（模拟使用）
const results2 = await memoryManager.retrieve('React Hooks');
// lastAccessedAt 更新，权重恢复到 ~0.98
```

---

## 与用户沟通的日志

```typescript
// 在检索时显示权重信息（开发模式）
log.debug('Memory retrieval:', {
  query,
  total: candidates.length,
  filtered: scored.length,
  weights: scored.map(s => ({
    content: s.entry.content.slice(0, 30),
    weight: s.weight.toFixed(2),
    timeScore: calcTimeDecayScore(s.entry).toFixed(2),
    accessCount: s.entry.accessCount,
  })),
});
```

**输出示例**：
```
Memory retrieval: {
  query: 'package manager',
  total: 50,
  filtered: 8,
  weights: [
    { content: 'User prefers Bun over npm', weight: '0.98', timeScore: '0.99', accessCount: 50 },
    { content: 'npm install timeout issue', weight: '0.65', timeScore: '0.60', accessCount: 5 },
    { content: 'Yarn vs pnpm comparison', weight: '0.42', timeScore: '0.40', accessCount: 2 },
    // ... 低于 0.25 的记忆已被过滤
  ]
}
```

---

## 总结

### 核心改进

1. **lastAccessedAt 驱动** - 每次访问都"加固"记忆
2. **访问频次延长半衰期** - 常用记忆几乎不衰减
3. **分层遗忘** - 不同类型记忆用不同衰减速度
4. **自动淘汰** - 低权重记忆不传入 LLM

### 符合人类记忆特征

- ✅ 常用的记得清楚（高 accessCount → 高权重）
- ✅ 不常用的慢慢模糊（低权重 → 被过滤）
- ✅ 重要的记得更久（user-preference 半衰期 90 天）
- ✅ 琐碎的快速遗忘（short-term 半衰期 7 天）

### 解决 LLM 幻觉问题

- ✅ 只传入高权重记忆（> 0.25 阈值）
- ✅ 自动过滤低价值内容
- ✅ 记忆数量可控（Top-K）

### 真正可落地

- ✅ 基于现有代码
- ✅ 改动量小（2-3 小时）
- ✅ 向后兼容（JSONL 格式不变）
- ✅ 可配置（config.json）
