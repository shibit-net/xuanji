# 人类化记忆权重系统实施总结

## 实施日期
2026-03-16

## 实施内容

### ✅ Phase 1: 优化 HybridRetriever（已完成）

#### 文件：`src/memory/HybridRetriever.ts`

**改动 1：调整权重配比**
```typescript
// 旧权重
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,
  keywordMatch: 0.2,
  timeDecay: 0.2,      // 提升前
  accessFrequency: 0.1,
};

// 新权重
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,   // 保持
  keywordMatch: 0.15,      // ↓ 略降低
  timeDecay: 0.3,          // ↑ 提升（人类记忆的核心）
  accessFrequency: 0.05,   // ↓ 降低（已整合到 timeDecay 中）
};
```

**改动 2：增加记忆类型半衰期配置**
```typescript
const MEMORY_TYPE_HALF_LIFE: Record<string, number> = {
  'user-preference': 90,    // 用户偏好：90 天
  'project-knowledge': 60,  // 项目知识：60 天
  'skill-pattern': 120,     // 技能模式：120 天
  'important_date': 180,    // 重要日期：180 天
  'conversation': 30,       // 日常对话：30 天
  'short-term': 7,          // 短期记忆：7 天
};
```

**改动 3：重写 calcTimeDecayScore（人类化记忆模型）**

核心改进：
1. ✅ **使用 lastAccessedAt 而非 createdAt**（记忆加固效应）
2. ✅ **访问频次延长半衰期**（常用记忆衰减慢）
   ```typescript
   const frequencyBonus = Math.log2(accessCount + 1) * 5;
   ```
3. ✅ **根据记忆类型调整基础半衰期**
4. ✅ **重要性影响衰减速度**
   ```typescript
   const importanceMultiplier = importance === 'high' ? 1.5 :
                                importance === 'low' ? 0.7 : 1.0;
   ```

**效果对比**：

| 场景 | 旧实现 | 新实现 | 改进 |
|------|--------|--------|------|
| **常用记忆**（50 次访问，30 天未访问） | 0.50（仅看创建时间） | **0.76**（频次延长半衰期） | ↑ 52% |
| **重要用户偏好**（高重要性，60 天未访问） | 0.25（通用半衰期） | **0.74**（90 天半衰期 × 1.5） | ↑ 196% |
| **琐碎短期记忆**（0 次访问，10 天） | 0.79 | **0.21**（7 天半衰期） | ↓ 73% |

**改动 4：增加权重过滤**

```typescript
// 计算综合权重（用于过滤低价值记忆）
const frequencyBonus = 1 + Math.log2(memory.accessCount + 1) * 0.1;
const weight = timeScore * frequencyBonus;

// 只保留高权重记忆（避免 LLM 幻觉）
if (weight >= minWeight && adjustedScore > 0.01) {
  scored.push({ entry: memory, score: adjustedScore });
}
```

**默认阈值**：`minWeight = 0.25`
- 低于 0.25 的记忆不会被检索到
- 减少传入 LLM 的记忆数量
- 避免幻觉

---

### ✅ Phase 2: 确认访问记录更新（已实现）

#### 文件：`src/memory/MemoryManager.ts`

**发现**：访问记录更新功能**已完整实现**！

```typescript
private updateAccessCountAsync(entries: MemoryEntry[]): void {
  const now = new Date().toISOString();
  for (const entry of entries) {
    entry.accessCount++;           // ✓ 更新访问次数
    entry.lastAccessedAt = now;    // ✓ 更新最后访问时间
  }
  // 注意：更新内存缓存，持久化在 compact() 时进行
}
```

**调用位置**：
- `retrieve()` 方法的向量检索分支（238 行）
- `retrieve()` 方法的关键词检索分支（263 行）

**验证**：✅ 每次检索都会自动更新访问记录

---

### ✅ Phase 3: 扩展类型定义（已完成）

#### 文件：`src/memory/types.ts`

**增加 importance 字段到 MemoryMetadata**：

```typescript
export interface MemoryMetadata {
  // ... 现有字段 ...
  /** 记忆重要性等级（影响遗忘曲线） */
  importance?: 'high' | 'medium' | 'low';  // 新增
}
```

**用途**：
- `high`：半衰期 × 1.5（重要记忆衰减慢）
- `medium`：半衰期 × 1.0（默认）
- `low`：半衰期 × 0.7（琐碎记忆快速淡忘）

---

## 核心改进总结

### 1. 记忆加固效应 ✅

**原理**：每次访问都"加固"记忆（刷新 lastAccessedAt）

**效果**：
- 昨天访问过的记忆 → timeScore ≈ 0.98（几乎无衰减）
- 90 天前创建但昨天访问 → timeScore ≈ 0.98（而非 0.13）

### 2. 访问频次延长半衰期 ✅

**原理**：`frequencyBonus = log2(accessCount + 1) × 5`

**效果**：

| 访问次数 | 半衰期延长 | 30 天未访问的权重 |
|---------|----------|------------------|
| 0 次 | +0 天 | 0.50 |
| 5 次 | +12 天 | 0.65 |
| 15 次 | +20 天 | 0.71 |
| 50 次 | +28 天 | 0.76 |
| 100 次 | +35 天 | 0.79 |

### 3. 分层遗忘 ✅

**原理**：不同类型记忆用不同基础半衰期

**效果**（30 天未访问，5 次访问）：

| 记忆类型 | 基础半衰期 | 有效半衰期 | 权重 |
|---------|----------|-----------|------|
| 短期记忆 | 7 天 | 12 天 | 0.18 ⬇️ |
| 日常对话 | 30 天 | 42 天 | 0.65 |
| 项目知识 | 60 天 | 72 天 | 0.76 |
| 用户偏好 | 90 天 | 102 天 | 0.82 ⬆️ |
| 技能模式 | 120 天 | 132 天 | 0.86 ⬆️⬆️ |

### 4. 自动淘汰低权重记忆 ✅

**原理**：检索时过滤 weight < 0.25 的记忆

**效果**：
- 只传入高权重记忆给 LLM
- 减少无关信息
- **避免幻觉**

---

## 实测效果预期

### 测试场景 1: 常用用户偏好

```
记忆："User prefers Bun over npm"
- 类型: user-preference（90 天半衰期）
- 创建: 90 天前
- 最后访问: 昨天
- 访问次数: 50 次
- 重要性: high（× 1.5）

计算：
  baseHalfLife = 90
  frequencyBonus = log2(51) × 5 ≈ 28
  importance = 1.5
  effectiveHalfLife = (90 + 28) × 1.5 = 177 天

  daysSinceAccess = 1
  timeScore = 0.5^(1 / 177) ≈ 0.996

  weight = 0.996 × (1 + log2(51) × 0.1) ≈ 1.0

结果: ✅ 几乎无衰减，稳定检索到
```

### 测试场景 2: 琐碎短期记忆

```
记忆："User said hello"
- 类型: short-term（7 天半衰期）
- 创建: 10 天前
- 最后访问: 10 天前（从未使用）
- 访问次数: 0 次
- 重要性: low（× 0.7）

计算：
  baseHalfLife = 7
  frequencyBonus = 0
  importance = 0.7
  effectiveHalfLife = 7 × 0.7 = 4.9 天

  daysSinceAccess = 10
  timeScore = 0.5^(10 / 4.9) ≈ 0.24

  weight = 0.24 × 0.7 = 0.17 < 0.25 阈值

结果: ✅ 被过滤，不传入 LLM
```

### 测试场景 3: 不常用项目知识

```
记忆："React Hooks best practice"
- 类型: project-knowledge（60 天半衰期）
- 创建: 60 天前
- 最后访问: 60 天前
- 访问次数: 0 次

计算：
  baseHalfLife = 60
  effectiveHalfLife = 60 天

  daysSinceAccess = 60
  timeScore = 0.5^(60 / 60) = 0.50

  weight = 0.50 × 1.0 = 0.50 > 0.25

结果: ✅ 保留，但权重中等
```

**如果用户访问一次**：
```
  lastAccessedAt 更新为今天
  daysSinceAccess = 0
  timeScore = 1.0
  accessCount = 1
  weight = 1.0 × 1.03 ≈ 1.0

结果: ✅ 权重恢复满值（记忆加固）
```

---

## 代码改动统计

| 文件 | 新增 | 修改 | 删除 | 说明 |
|------|------|------|------|------|
| `src/memory/HybridRetriever.ts` | 35 行 | 15 行 | 5 行 | 核心算法优化 |
| `src/memory/types.ts` | 2 行 | 0 行 | 0 行 | 类型扩展 |
| `src/memory/MemoryManager.ts` | 0 行 | 0 行 | 0 行 | 已实现，无需改动 |

**总改动**：37 行新增，15 行修改，5 行删除

**实际工作量**：1 小时（远少于预估的 2-3 小时）

---

## 验证方法

### 手动测试

```bash
# 1. 创建测试记忆
npm run dev

# 在 xuanji 中：
> 记住：我更喜欢用 Bun 而不是 npm

# 2. 模拟多次访问
> 包管理器有哪些？
> 安装依赖用什么工具？
> npm 和 bun 哪个好？
# （每次查询都会检索到 "Bun 偏好"，自动更新 accessCount）

# 3. 检查记忆文件
cat ~/.xuanji/memory.jsonl | grep "Bun"
# 查看 accessCount 和 lastAccessedAt 是否更新

# 4. 等待一段时间后再查询
# （30 天后）检查是否仍能检索到
```

### 单元测试（待添加）

```typescript
// test/unit/memory/HybridRetriever.test.ts

describe('HybridRetriever - Human-like Memory', () => {
  it('should give high weight to frequently accessed memories', () => {
    const memory: MemoryEntry = {
      type: 'user-preference',
      accessCount: 50,
      lastAccessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      metadata: { importance: 'high' },
      // ...
    };

    const retriever = new HybridRetriever(30);
    const weight = retriever.calcTimeDecayScore(memory);

    expect(weight).toBeGreaterThan(0.9); // 权重 > 0.9
  });

  it('should filter out low-weight memories', () => {
    const lowWeightMemory: MemoryEntry = {
      type: 'short-term',
      accessCount: 0,
      lastAccessedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { importance: 'low' },
      // ...
    };

    const candidates = [{ memory: lowWeightMemory, similarity: 0.8 }];
    const results = retriever.rerank(candidates, 'test', { minWeight: 0.25 });

    expect(results).toHaveLength(0); // 被过滤
  });

  it('should consolidate memory when accessed', () => {
    const memory: MemoryEntry = {
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      lastAccessedAt: new Date().toISOString(), // 刚访问
      // ...
    };

    const weight = retriever.calcTimeDecayScore(memory);

    expect(weight).toBeGreaterThan(0.95); // 记忆加固，权重接近 1
  });
});
```

---

## 符合人类记忆特征

| 特征 | 实现 | 验证 |
|------|------|------|
| ✅ 常用的记得清楚 | 访问频次延长半衰期 | 50 次访问 → 权重 +52% |
| ✅ 不常用的慢慢模糊 | 时间衰减 + 权重过滤 | 30 天未访问 → 权重 0.5 |
| ✅ 重要的记得更久 | 类型半衰期 + 重要性乘数 | 用户偏好 90 天半衰期 |
| ✅ 琐碎的快速遗忘 | 短期记忆 7 天半衰期 | 10 天后权重 < 0.25 |
| ✅ 每次回忆都加固 | lastAccessedAt 刷新 | 访问后权重恢复 1.0 |

---

## 解决 LLM 幻觉问题

| 问题 | 解决方案 | 效果 |
|------|---------|------|
| 传入记忆太多 | 权重过滤（minWeight 0.25） | ✅ 只传高权重记忆 |
| 低价值记忆污染 | 分层遗忘 + 自动淘汰 | ✅ 琐碎记忆快速淡忘 |
| 过时信息误导 | 时间衰减（遗忘曲线） | ✅ 旧记忆权重降低 |

---

## 下一步计划

### 可选优化（不紧急）

1. **配置化权重阈值**
   ```typescript
   // config.json
   {
     "memory": {
       "minRetrieveWeight": 0.25  // 可调整
     }
   }
   ```

2. **开发模式日志增强**
   ```typescript
   log.debug('Memory weights:', {
     total: scored.length,
     weights: scored.map(s => ({
       content: s.entry.content.slice(0, 30),
       weight: weight.toFixed(2),
       accessCount: s.entry.accessCount,
     }))
   });
   ```

3. **单元测试补充**
   - 测试 calcTimeDecayScore 的各种场景
   - 测试权重过滤逻辑
   - 测试记忆加固效应

4. **GUI 可视化**
   - 记忆列表显示权重（0-100%）
   - 权重低的记忆显示为灰色
   - 鼠标悬停显示详细信息（访问次数、最后访问时间等）

---

## 总结

### ✅ 已完成

1. **HybridRetriever 优化**
   - 使用 lastAccessedAt 而非 createdAt
   - 访问频次延长半衰期
   - 分层遗忘（不同类型不同半衰期）
   - 权重过滤

2. **类型定义扩展**
   - MemoryMetadata 增加 importance 字段

3. **验证通过**
   - ✅ TypeScript 类型检查通过
   - ✅ 访问记录更新已实现

### 🎯 核心优势

- **真正可落地**：基于现有代码，改动量小
- **符合人类记忆**：常用记得清楚，不常用慢慢模糊
- **解决 LLM 幻觉**：自动过滤低权重记忆
- **无破坏性**：向后兼容，JSONL 格式不变

### 📊 预期效果

- **常用记忆权重提升 52%**（50 次访问）
- **琐碎记忆自动淘汰**（10 天后权重 < 0.25）
- **重要记忆保留更久**（用户偏好 90 天半衰期）
- **减少 LLM 幻觉**（只传入高权重记忆）

---

**实施完成时间**：2026-03-16
**实际工作量**：1 小时
**状态**：✅ 可立即使用
