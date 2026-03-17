# 记忆质量控制与管理系统设计

## 设计目标

1. **防止幻觉** - 大量记忆不会导致LLM产生错误回答
2. **可管理性** - 用户能查看、编辑、删除记忆
3. **可追溯** - 每条记忆可追溯来源和上下文
4. **自动清理** - 过时、低质量记忆自动降权或清理

---

## 核心挑战

### 问题 1: 记忆噪音导致幻觉

**场景**：
```
记忆中存在:
  [2周前] User: "我用 Vue3"
  [昨天]   User: "我改用 React 了"

当前问题: "帮我写个组件"
LLM可能混乱，不知道该用 Vue 还是 React
```

**后果**：
- 回答自相矛盾
- 使用过时的信息
- 混淆不同项目的上下文
- Token浪费在无关记忆上

### 问题 2: 记忆失控无法管理

**场景**：
- 几个月后有上万条记忆
- 用户不知道存了什么
- 错误记忆无法删除
- 无法追溯某条记忆从何而来

---

## 解决方案架构

```
用户输入
  ↓
[1] 粗筛选（向量检索 Top 50）
  ↓
[2] 质量过滤（置信度 > 0.5）
  ↓
[3] 冲突检测（发现矛盾的记忆）
  ↓
[4] 精筛选（LLM 判断相关性 Top 10）
  ↓
[5] 去重去噪（合并相似记忆）
  ↓
[6] Token预算控制（< 2000 tokens）
  ↓
注入 LLM 上下文
```

---

## 一、记忆质量评分系统

### 1.1 质量维度

每条记忆包含多维质量评分：

```typescript
interface MemoryQuality {
  // 准确性（Accuracy）- 内容是否准确
  accuracy: number;          // 0-1，默认 0.8

  // 相关性（Relevance）- 与当前任务的相关性（动态计算）
  relevance?: number;        // 0-1，查询时计算

  // 时效性（Recency）- 时间衰减分数
  recency: number;           // 0-1，随时间衰减

  // 可信度（Confidence）- 来源的可靠程度
  confidence: number;        // 0-1，用户确认的记忆=1.0，自动提取=0.6

  // 使用频率（Frequency）- 被检索和使用的次数
  useCount: number;          // 0-∞，频繁使用的记忆更重要
  lastUsed: number;          // timestamp

  // 最终分数（综合）
  finalScore?: number;       // 查询时计算
}
```

### 1.2 质量评分算法

```typescript
// src/memory/MemoryQualityScorer.ts

export class MemoryQualityScorer {
  /**
   * 计算记忆的最终分数
   */
  calculateFinalScore(
    memory: Memory,
    query: string,
    context: QueryContext
  ): number {
    const weights = {
      accuracy: 0.3,
      relevance: 0.3,
      recency: 0.2,
      confidence: 0.1,
      frequency: 0.1,
    };

    // 1. 准确性（静态，来自记忆本身）
    const accuracy = memory.quality.accuracy;

    // 2. 相关性（动态，基于向量检索分数）
    const relevance = memory.similarity || 0;

    // 3. 时效性（时间衰减）
    const recency = this.calculateRecency(memory.timestamp);

    // 4. 可信度（来源可靠性）
    const confidence = memory.quality.confidence;

    // 5. 使用频率（经验加权）
    const frequency = this.calculateFrequency(
      memory.quality.useCount,
      memory.quality.lastUsed
    );

    // 综合评分
    return (
      accuracy * weights.accuracy +
      relevance * weights.relevance +
      recency * weights.recency +
      confidence * weights.confidence +
      frequency * weights.frequency
    );
  }

  /**
   * 时间衰减（指数衰减）
   */
  private calculateRecency(timestamp: number): number {
    const now = Date.now();
    const hoursSince = (now - timestamp) / (1000 * 60 * 60);

    // 不同类型记忆的半衰期不同
    const halfLife = 168; // 7天（168小时）

    return Math.exp((-0.693 * hoursSince) / halfLife);
  }

  /**
   * 使用频率评分
   */
  private calculateFrequency(useCount: number, lastUsed: number): number {
    const now = Date.now();
    const daysSinceLastUse = (now - lastUsed) / (1000 * 60 * 60 * 24);

    // 频率分数 = log(使用次数 + 1) * 最近使用衰减
    const baseScore = Math.log10(useCount + 1) / Math.log10(101); // 归一化到0-1
    const recencyFactor = Math.exp(-daysSinceLastUse / 30); // 30天半衰期

    return baseScore * 0.7 + recencyFactor * 0.3;
  }
}
```

### 1.3 动态置信度调整

```typescript
// src/memory/MemoryQualityManager.ts

export class MemoryQualityManager {
  /**
   * 用户反馈调整置信度
   */
  async updateFromFeedback(
    memoryId: string,
    feedback: 'helpful' | 'wrong' | 'outdated'
  ): Promise<void> {
    const memory = await this.store.get(memoryId);

    switch (feedback) {
      case 'helpful':
        // 提升准确性和可信度
        memory.quality.accuracy = Math.min(1.0, memory.quality.accuracy + 0.1);
        memory.quality.confidence = Math.min(1.0, memory.quality.confidence + 0.1);
        break;

      case 'wrong':
        // 大幅降低准确性，标记为需要审核
        memory.quality.accuracy = Math.max(0, memory.quality.accuracy - 0.3);
        memory.quality.confidence = Math.max(0, memory.quality.confidence - 0.3);
        memory.needsReview = true;
        break;

      case 'outdated':
        // 降低时效性，标记为过时
        memory.quality.accuracy = 0.3;
        memory.obsolete = true;
        break;
    }

    // 低于阈值自动隐藏
    if (memory.quality.accuracy < 0.3 || memory.quality.confidence < 0.3) {
      memory.hidden = true;
    }

    await this.store.update(memoryId, memory);
  }

  /**
   * 定期自动质量衰减
   */
  async decayUnusedMemories(): Promise<void> {
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30天

    const unused = await this.store.query({
      lastUsed: { lt: threshold },
    });

    for (const memory of unused) {
      // 未使用的记忆置信度衰减
      memory.quality.confidence *= 0.9;

      // 低于阈值隐藏
      if (memory.quality.confidence < 0.2) {
        memory.hidden = true;
      }

      await this.store.update(memory.id, memory);
    }
  }
}
```

---

## 二、冲突检测与解决

### 2.1 冲突检测

```typescript
// src/memory/ConflictDetector.ts

export class ConflictDetector {
  /**
   * 检测记忆冲突
   */
  async detectConflicts(memories: Memory[]): Promise<ConflictGroup[]> {
    const conflicts: ConflictGroup[] = [];

    // 按主题分组
    const grouped = this.groupByTopic(memories);

    for (const [topic, group] of grouped.entries()) {
      // 提取事实性陈述
      const facts = group.filter((m) => m.type === 'fact');

      if (facts.length < 2) continue;

      // 使用 LLM 检测矛盾
      const contradictions = await this.findContradictions(facts);

      if (contradictions.length > 0) {
        conflicts.push({
          topic,
          memories: facts,
          contradictions,
          severity: this.calculateSeverity(contradictions),
        });
      }
    }

    return conflicts;
  }

  /**
   * 使用 LLM 检测矛盾
   */
  private async findContradictions(facts: Memory[]): Promise<Contradiction[]> {
    const prompt = `
以下是关于同一主题的多条记忆，请检测是否存在矛盾：

${facts.map((f, i) => `[${i + 1}] ${f.content} (${new Date(f.timestamp).toLocaleDateString()})`).join('\n')}

如果存在矛盾，请返回：
{
  "contradictions": [
    {
      "memoryIds": [1, 2],
      "description": "第1条说用Vue，第2条说用React",
      "severity": "high"
    }
  ]
}

如果没有矛盾，返回空数组。
`;

    const response = await this.llm.generate(prompt);
    const result = JSON.parse(response.text);

    return result.contradictions.map((c: any) => ({
      memories: c.memoryIds.map((idx: number) => facts[idx - 1]),
      description: c.description,
      severity: c.severity as 'low' | 'medium' | 'high',
    }));
  }

  /**
   * 自动解决冲突（优先最近的、高置信度的）
   */
  async autoResolveConflicts(conflict: ConflictGroup): Promise<void> {
    const { memories } = conflict;

    // 按时间和置信度排序
    const sorted = memories.sort((a, b) => {
      const scoreA = a.timestamp * 0.6 + a.quality.confidence * 0.4;
      const scoreB = b.timestamp * 0.6 + b.quality.confidence * 0.4;
      return scoreB - scoreA;
    });

    // 保留最优的，其他降权
    const winner = sorted[0];
    const losers = sorted.slice(1);

    for (const loser of losers) {
      await this.store.update(loser.id, {
        quality: {
          ...loser.quality,
          accuracy: 0.2,
          confidence: 0.2,
        },
        supersededBy: winner.id,
        hidden: true,
      });
    }

    // 标记胜者为已验证
    await this.store.update(winner.id, {
      quality: {
        ...winner.quality,
        confidence: Math.min(1.0, winner.quality.confidence + 0.2),
      },
      verified: true,
    });
  }
}
```

### 2.2 用户参与冲突解决

```typescript
// src/memory/ConflictResolver.ts

export class ConflictResolver {
  /**
   * 生成冲突解决提示（让用户选择）
   */
  async promptUserToResolve(conflict: ConflictGroup): Promise<void> {
    // 在 GUI 中显示冲突
    const choice = await this.gui.showConflictDialog({
      title: `发现矛盾的记忆（${conflict.topic}）`,
      description: conflict.contradictions[0].description,
      options: conflict.memories.map((m) => ({
        id: m.id,
        content: m.content,
        timestamp: new Date(m.timestamp).toLocaleDateString(),
        confidence: m.quality.confidence,
      })),
      actions: ['保留第一条', '保留第二条', '都保留', '都删除', '让我编辑'],
    });

    switch (choice.action) {
      case 'keep_first':
        await this.resolveKeepOne(conflict.memories[0], conflict.memories.slice(1));
        break;

      case 'keep_second':
        await this.resolveKeepOne(conflict.memories[1], [
          conflict.memories[0],
          ...conflict.memories.slice(2),
        ]);
        break;

      case 'keep_both':
        // 标记为"已知冲突，用户确认保留"
        for (const m of conflict.memories) {
          await this.store.update(m.id, {
            hasKnownConflict: true,
            conflictResolution: 'user_keep_both',
          });
        }
        break;

      case 'delete_all':
        for (const m of conflict.memories) {
          await this.store.delete(m.id);
        }
        break;

      case 'edit':
        await this.gui.openMemoryEditor(conflict.memories[0].id);
        break;
    }
  }
}
```

---

## 三、分层过滤流程

### 3.1 五层过滤器

```typescript
// src/memory/MemoryFilterPipeline.ts

export class MemoryFilterPipeline {
  /**
   * 执行分层过滤
   */
  async filter(query: string, context: QueryContext): Promise<Memory[]> {
    // [1] 粗筛选：向量检索 Top 50
    let candidates = await this.vectorSearch(query, 50);
    console.log(`[Filter] Vector search: ${candidates.length} candidates`);

    // [2] 质量过滤：去除低质量记忆
    candidates = this.filterByQuality(candidates, {
      minAccuracy: 0.5,
      minConfidence: 0.3,
      excludeHidden: true,
    });
    console.log(`[Filter] Quality filter: ${candidates.length} candidates`);

    // [3] 冲突检测：标记冲突的记忆
    const conflicts = await this.conflictDetector.detectConflicts(candidates);
    candidates = this.excludeConflictingMemories(candidates, conflicts);
    console.log(`[Filter] Conflict filter: ${candidates.length} candidates`);

    // [4] 精筛选：LLM 判断相关性 Top 10
    candidates = await this.llmRerank(query, candidates, 10);
    console.log(`[Filter] LLM rerank: ${candidates.length} candidates`);

    // [5] 去重去噪：合并相似记忆
    candidates = this.deduplicateAndMerge(candidates);
    console.log(`[Filter] Dedup: ${candidates.length} candidates`);

    // [6] Token 预算控制
    candidates = this.enforceTokenBudget(candidates, 2000);
    console.log(`[Filter] Token budget: ${candidates.length} candidates`);

    return candidates;
  }

  /**
   * [2] 质量过滤
   */
  private filterByQuality(
    memories: Memory[],
    threshold: { minAccuracy: number; minConfidence: number; excludeHidden: boolean }
  ): Memory[] {
    return memories.filter((m) => {
      if (threshold.excludeHidden && m.hidden) return false;
      if (m.quality.accuracy < threshold.minAccuracy) return false;
      if (m.quality.confidence < threshold.minConfidence) return false;
      return true;
    });
  }

  /**
   * [3] 排除冲突记忆（保留最新的）
   */
  private excludeConflictingMemories(
    memories: Memory[],
    conflicts: ConflictGroup[]
  ): Memory[] {
    const excludeIds = new Set<string>();

    for (const conflict of conflicts) {
      // 自动解决：保留最新的、高置信度的
      const sorted = conflict.memories.sort((a, b) => {
        const scoreA = a.timestamp * 0.6 + a.quality.confidence * 0.4;
        const scoreB = b.timestamp * 0.6 + b.quality.confidence * 0.4;
        return scoreB - scoreA;
      });

      // 排除其他的
      for (let i = 1; i < sorted.length; i++) {
        excludeIds.add(sorted[i].id);
      }
    }

    return memories.filter((m) => !excludeIds.has(m.id));
  }

  /**
   * [4] LLM 重排序（精筛选）
   */
  private async llmRerank(
    query: string,
    memories: Memory[],
    topK: number
  ): Promise<Memory[]> {
    // 构建评分 prompt
    const prompt = `
用户问题: ${query}

以下是检索到的记忆，请判断每条记忆与问题的相关性（0-10分）：

${memories.map((m, i) => `[${i}] ${m.content}`).join('\n\n')}

返回 JSON 格式：
{
  "scores": [9, 2, 7, ...]  // 对应每条记忆的分数
}
`;

    const response = await this.llm.generate(prompt);
    const result = JSON.parse(response.text);

    // 按分数排序
    const scored = memories.map((m, i) => ({
      memory: m,
      score: result.scores[i] || 0,
    }));

    scored.sort((a, b) => b.score - a.score);

    // 返回 Top K
    return scored.slice(0, topK).map((s) => s.memory);
  }

  /**
   * [5] 去重（合并相似记忆）
   */
  private deduplicateAndMerge(memories: Memory[]): Memory[] {
    const clusters = this.clusterSimilarMemories(memories, 0.9);

    return clusters.map((cluster) => {
      if (cluster.length === 1) return cluster[0];

      // 合并为一条记忆
      return {
        ...cluster[0],
        content: this.mergeContent(cluster),
        quality: {
          ...cluster[0].quality,
          confidence: Math.max(...cluster.map((m) => m.quality.confidence)),
        },
        mergedFrom: cluster.map((m) => m.id),
      };
    });
  }

  /**
   * [6] Token 预算控制
   */
  private enforceTokenBudget(memories: Memory[], maxTokens: number): Memory[] {
    const result: Memory[] = [];
    let totalTokens = 0;

    for (const memory of memories) {
      const tokens = this.estimateTokens(memory.content);

      if (totalTokens + tokens > maxTokens) break;

      result.push(memory);
      totalTokens += tokens;
    }

    return result;
  }
}
```

---

## 四、记忆溯源与验证

### 4.1 记忆来源追踪

```typescript
interface MemoryProvenance {
  // 来源类型
  source: 'user_explicit' | 'conversation' | 'file_analysis' | 'web_search';

  // 原始上下文
  originalContext: {
    sessionId?: string;        // 来自哪个会话
    messageId?: string;        // 来自哪条消息
    filePath?: string;         // 来自哪个文件
    url?: string;              // 来自哪个网页
    timestamp: number;         // 何时创建
  };

  // 提取方法
  extractionMethod: 'llm_extract' | 'user_command' | 'rule_based';

  // 可追溯性
  traceable: boolean;          // 是否可追溯到原始对话
  verifiable: boolean;         // 是否可验证（如文件是否仍存在）
}
```

### 4.2 记忆验证

```typescript
// src/memory/MemoryVerifier.ts

export class MemoryVerifier {
  /**
   * 定期验证记忆是否仍然准确
   */
  async verifyMemories(): Promise<VerificationReport> {
    const memories = await this.store.query({
      type: 'fact',
      lastVerified: { lt: Date.now() - 7 * 24 * 60 * 60 * 1000 }, // 7天未验证
    });

    const report: VerificationReport = {
      total: memories.length,
      verified: 0,
      outdated: 0,
      errors: [],
    };

    for (const memory of memories) {
      try {
        const isValid = await this.verifyMemory(memory);

        if (isValid) {
          await this.store.update(memory.id, {
            lastVerified: Date.now(),
            quality: {
              ...memory.quality,
              confidence: Math.min(1.0, memory.quality.confidence + 0.05),
            },
          });
          report.verified++;
        } else {
          await this.store.update(memory.id, {
            obsolete: true,
            quality: {
              ...memory.quality,
              accuracy: 0.2,
            },
          });
          report.outdated++;
        }
      } catch (err) {
        report.errors.push({ memoryId: memory.id, error: err.message });
      }
    }

    return report;
  }

  /**
   * 验证单条记忆
   */
  private async verifyMemory(memory: Memory): Promise<boolean> {
    switch (memory.provenance.source) {
      case 'file_analysis':
        // 检查文件是否仍存在
        const filePath = memory.provenance.originalContext.filePath;
        if (!filePath) return false;

        const exists = await this.fileSystem.exists(filePath);
        if (!exists) return false;

        // 重新分析文件，检查内容是否一致
        const currentContent = await this.fileSystem.read(filePath);
        const isConsistent = await this.checkConsistency(memory.content, currentContent);
        return isConsistent;

      case 'conversation':
        // 对话类记忆无法验证，使用时间衰减
        return true;

      case 'web_search':
        // 重新访问 URL（可选）
        const url = memory.provenance.originalContext.url;
        if (!url) return true;

        // 简单验证：URL 是否仍可访问
        const accessible = await this.web.isAccessible(url);
        return accessible;

      default:
        return true;
    }
  }
}
```

---

## 五、用户记忆管理界面

### 5.1 记忆浏览器（GUI）

```typescript
// desktop/renderer/views/MemoryBrowser.tsx

export default function MemoryBrowser() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<MemoryFilter>({
    type: 'all',
    timeRange: 'all',
    minQuality: 0,
    showHidden: false,
  });
  const [searchQuery, setSearchQuery] = useState('');

  // 加载记忆
  useEffect(() => {
    loadMemories();
  }, [filter]);

  const loadMemories = async () => {
    const result = await window.electron.memorySearch({
      query: searchQuery,
      filter,
      limit: 100,
    });
    setMemories(result.memories);
  };

  return (
    <div className="memory-browser">
      {/* 工具栏 */}
      <div className="toolbar">
        <input
          type="text"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <FilterDropdown value={filter} onChange={setFilter} />
        <button onClick={() => window.electron.memoryExport()}>导出</button>
        <button onClick={() => window.electron.memoryImport()}>导入</button>
      </div>

      {/* 记忆列表 */}
      <div className="memory-list">
        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onEdit={(id) => openEditor(id)}
            onDelete={(id) => deleteMemory(id)}
            onFeedback={(id, feedback) => sendFeedback(id, feedback)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 5.2 记忆卡片组件

```typescript
// desktop/renderer/components/MemoryCard.tsx

interface MemoryCardProps {
  memory: Memory;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onFeedback: (id: string, feedback: 'helpful' | 'wrong' | 'outdated') => void;
}

export default function MemoryCard({ memory, onEdit, onDelete, onFeedback }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`memory-card ${memory.hidden ? 'hidden' : ''}`}>
      {/* 头部 */}
      <div className="header">
        <span className="type-badge">{getTypeBadge(memory.type)}</span>
        <span className="timestamp">{formatDate(memory.timestamp)}</span>
        <QualityIndicator quality={memory.quality} />
      </div>

      {/* 内容 */}
      <div className="content">
        <p>{memory.content}</p>
      </div>

      {/* 元数据（展开） */}
      {expanded && (
        <div className="metadata">
          <div className="quality-details">
            <QualityBar label="准确性" value={memory.quality.accuracy} />
            <QualityBar label="可信度" value={memory.quality.confidence} />
            <QualityBar label="时效性" value={memory.quality.recency} />
          </div>

          <div className="provenance">
            <h4>来源</h4>
            <p>类型: {memory.provenance.source}</p>
            {memory.provenance.originalContext.sessionId && (
              <p>
                会话:{' '}
                <a
                  href="#"
                  onClick={() =>
                    window.electron.sessionJump(memory.provenance.originalContext.sessionId)
                  }
                >
                  查看原始对话
                </a>
              </p>
            )}
          </div>

          {memory.hasKnownConflict && (
            <div className="conflict-warning">
              ⚠️ 此记忆与其他记忆存在冲突
              <button onClick={() => window.electron.memoryShowConflict(memory.id)}>
                查看详情
              </button>
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="actions">
        <button onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : '展开'}
        </button>
        <button onClick={() => onEdit(memory.id)}>编辑</button>
        <button onClick={() => onDelete(memory.id)}>删除</button>
        <button onClick={() => onFeedback(memory.id, 'helpful')} title="有帮助">
          👍
        </button>
        <button onClick={() => onFeedback(memory.id, 'wrong')} title="不准确">
          👎
        </button>
        <button onClick={() => onFeedback(memory.id, 'outdated')} title="过时">
          ⏰
        </button>
      </div>
    </div>
  );
}
```

### 5.3 记忆编辑器

```typescript
// desktop/renderer/components/MemoryEditor.tsx

export default function MemoryEditor({ memoryId }: { memoryId: string }) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    loadMemory();
  }, [memoryId]);

  const loadMemory = async () => {
    const result = await window.electron.memoryGet(memoryId);
    setMemory(result.memory);
  };

  const saveChanges = async () => {
    await window.electron.memoryUpdate(memoryId, memory);
    setEditing(false);
  };

  if (!memory) return <div>Loading...</div>;

  return (
    <div className="memory-editor">
      <h3>编辑记忆</h3>

      {/* 内容编辑 */}
      <div className="field">
        <label>内容</label>
        {editing ? (
          <textarea
            value={memory.content}
            onChange={(e) => setMemory({ ...memory, content: e.target.value })}
            rows={5}
          />
        ) : (
          <p>{memory.content}</p>
        )}
      </div>

      {/* 质量调整 */}
      <div className="field">
        <label>质量评分</label>
        <div className="quality-sliders">
          <QualitySlider
            label="准确性"
            value={memory.quality.accuracy}
            onChange={(v) =>
              setMemory({
                ...memory,
                quality: { ...memory.quality, accuracy: v },
              })
            }
            disabled={!editing}
          />
          <QualitySlider
            label="可信度"
            value={memory.quality.confidence}
            onChange={(v) =>
              setMemory({
                ...memory,
                quality: { ...memory.quality, confidence: v },
              })
            }
            disabled={!editing}
          />
        </div>
      </div>

      {/* 标签编辑 */}
      <div className="field">
        <label>标签</label>
        <TagEditor
          tags={memory.metadata?.topics || []}
          onChange={(tags) =>
            setMemory({
              ...memory,
              metadata: { ...memory.metadata, topics: tags },
            })
          }
          disabled={!editing}
        />
      </div>

      {/* 按钮 */}
      <div className="actions">
        {editing ? (
          <>
            <button onClick={saveChanges}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}>编辑</button>
        )}
      </div>
    </div>
  );
}
```

### 5.4 冲突解决对话框

```typescript
// desktop/renderer/components/ConflictDialog.tsx

export default function ConflictDialog({ conflict }: { conflict: ConflictGroup }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleResolve = async (action: 'keep_selected' | 'keep_all' | 'delete_all') => {
    switch (action) {
      case 'keep_selected':
        await window.electron.memoryResolveConflict({
          conflictId: conflict.id,
          keepMemoryId: selectedId,
        });
        break;

      case 'keep_all':
        await window.electron.memoryResolveConflict({
          conflictId: conflict.id,
          action: 'keep_both',
        });
        break;

      case 'delete_all':
        await window.electron.memoryResolveConflict({
          conflictId: conflict.id,
          action: 'delete_all',
        });
        break;
    }
  };

  return (
    <div className="conflict-dialog">
      <h3>⚠️ 发现矛盾的记忆</h3>
      <p>{conflict.contradictions[0].description}</p>

      <div className="conflict-memories">
        {conflict.memories.map((memory) => (
          <div
            key={memory.id}
            className={`conflict-option ${selectedId === memory.id ? 'selected' : ''}`}
            onClick={() => setSelectedId(memory.id)}
          >
            <input type="radio" checked={selectedId === memory.id} readOnly />
            <div className="memory-preview">
              <p>{memory.content}</p>
              <div className="metadata">
                <span>{formatDate(memory.timestamp)}</span>
                <QualityBadge quality={memory.quality} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <button onClick={() => handleResolve('keep_selected')} disabled={!selectedId}>
          保留选中的
        </button>
        <button onClick={() => handleResolve('keep_all')}>都保留（标记冲突）</button>
        <button onClick={() => handleResolve('delete_all')}>都删除</button>
      </div>
    </div>
  );
}
```

---

## 六、后端 IPC API

### 6.1 记忆管理 API

```typescript
// desktop/main/memory-bridge.ts

export function registerMemoryHandlers() {
  // 搜索记忆
  ipcMain.handle('memory:search', async (event, options) => {
    const { query, filter, limit } = options;
    const memories = await memoryCoordinator.search(query, filter, limit);
    return { success: true, memories };
  });

  // 获取单条记忆
  ipcMain.handle('memory:get', async (event, memoryId) => {
    const memory = await memoryStore.get(memoryId);
    return { success: true, memory };
  });

  // 更新记忆
  ipcMain.handle('memory:update', async (event, memoryId, updates) => {
    await memoryStore.update(memoryId, updates);
    return { success: true };
  });

  // 删除记忆
  ipcMain.handle('memory:delete', async (event, memoryId) => {
    await memoryStore.delete(memoryId);
    return { success: true };
  });

  // 反馈记忆质量
  ipcMain.handle('memory:feedback', async (event, memoryId, feedback) => {
    await memoryQualityManager.updateFromFeedback(memoryId, feedback);
    return { success: true };
  });

  // 解决冲突
  ipcMain.handle('memory:resolve-conflict', async (event, options) => {
    await conflictResolver.resolve(options);
    return { success: true };
  });

  // 导出记忆
  ipcMain.handle('memory:export', async () => {
    const filePath = await dialog.showSaveDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (filePath.canceled) return { success: false };

    const memories = await memoryStore.getAll();
    await fs.writeFile(filePath.filePath, JSON.stringify(memories, null, 2));
    return { success: true };
  });

  // 导入记忆
  ipcMain.handle('memory:import', async () => {
    const filePath = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (filePath.canceled) return { success: false };

    const data = await fs.readFile(filePath.filePaths[0], 'utf-8');
    const memories = JSON.parse(data);

    for (const memory of memories) {
      await memoryStore.add(memory);
    }

    return { success: true, count: memories.length };
  });
}
```

---

## 七、自动化维护任务

### 7.1 定时任务

```typescript
// src/memory/MemoryMaintenance.ts

export class MemoryMaintenance {
  /**
   * 启动自动维护任务
   */
  start() {
    // 每日凌晨 2 点：压缩记忆
    cron.schedule('0 2 * * *', async () => {
      console.log('[Maintenance] Compressing memories...');
      await this.compressor.compressDailyMemories();
    });

    // 每周日凌晨 3 点：验证记忆
    cron.schedule('0 3 * * 0', async () => {
      console.log('[Maintenance] Verifying memories...');
      const report = await this.verifier.verifyMemories();
      console.log(`[Maintenance] Verified: ${report.verified}, Outdated: ${report.outdated}`);
    });

    // 每月 1 号凌晨 4 点：清理低质量记忆
    cron.schedule('0 4 1 * *', async () => {
      console.log('[Maintenance] Cleaning up low-quality memories...');
      await this.cleanupLowQuality();
    });

    // 每小时：衰减未使用记忆
    cron.schedule('0 * * * *', async () => {
      await this.qualityManager.decayUnusedMemories();
    });

    // 每 10 分钟：检测冲突
    cron.schedule('*/10 * * * *', async () => {
      const conflicts = await this.conflictDetector.detectConflicts();
      if (conflicts.length > 0) {
        console.log(`[Maintenance] Found ${conflicts.length} conflicts`);
        // 通知用户
        this.notifyUser('发现记忆冲突，请查看');
      }
    });
  }

  /**
   * 清理低质量记忆
   */
  private async cleanupLowQuality(): Promise<void> {
    const lowQuality = await this.store.query({
      'quality.accuracy': { lt: 0.2 },
      'quality.confidence': { lt: 0.2 },
      obsolete: true,
    });

    for (const memory of lowQuality) {
      // 归档而非删除（保留 30 天）
      await this.archive(memory);
    }

    console.log(`[Maintenance] Archived ${lowQuality.length} low-quality memories`);
  }
}
```

---

## 八、实施计划

### Phase 1: 核心质量控制（2-3周）

**目标**：防止幻觉的基础能力

- [ ] MemoryQualityScorer - 质量评分系统
- [ ] MemoryFilterPipeline - 分层过滤
- [ ] ConflictDetector - 冲突检测
- [ ] Token 预算控制

**验证**：
- 检索 1000 条记忆时，只返回最相关的 10 条
- 冲突记忆能正确识别并排除

### Phase 2: 用户管理界面（2-3周）

**目标**：用户可管理记忆

- [ ] MemoryBrowser - 记忆浏览器
- [ ] MemoryCard - 记忆卡片
- [ ] MemoryEditor - 记忆编辑器
- [ ] ConflictDialog - 冲突解决对话框
- [ ] IPC API - 后端接口

**验证**：
- 用户能搜索、查看、编辑、删除记忆
- 冲突记忆能手动解决

### Phase 3: 自动化维护（1-2周）

**目标**：系统自动维护记忆质量

- [ ] MemoryCompressor - 自动压缩
- [ ] MemoryVerifier - 自动验证
- [ ] MemoryMaintenance - 定时任务
- [ ] 质量衰减

**验证**：
- 每日自动压缩昨天的记忆
- 每周验证文件类记忆是否过时
- 低质量记忆自动隐藏

### Phase 4: 高级功能（1-2周）

**目标**：增强记忆系统

- [ ] 记忆导出/导入
- [ ] 记忆统计面板
- [ ] 智能推荐（"你可能想知道..."）
- [ ] 记忆可视化（时间线、知识图谱）

---

## 总结

### 核心机制

1. **质量评分** - 5 维度评分（准确性、相关性、时效性、可信度、频率）
2. **分层过滤** - 6 层过滤（向量检索 → 质量 → 冲突 → LLM → 去重 → Token预算）
3. **冲突检测** - 自动检测 + 用户解决
4. **记忆溯源** - 每条记忆可追溯到原始对话/文件
5. **用户管理** - 完整的 GUI（浏览、搜索、编辑、删除、反馈）
6. **自动维护** - 定时压缩、验证、清理、衰减

### 防幻觉保证

✅ **Token 预算控制** - 最多 2000 tokens 上下文
✅ **质量阈值** - 低于 0.5 准确性的记忆不注入
✅ **冲突排除** - 矛盾的记忆自动排除或标记
✅ **LLM 精筛选** - 最后一道关卡，确保相关性
✅ **用户监督** - 用户可随时纠正错误记忆

### 预计工作量

- **Phase 1**（核心质量控制）：2-3 周
- **Phase 2**（用户管理界面）：2-3 周
- **Phase 3**（自动化维护）：1-2 周
- **Phase 4**（高级功能）：1-2 周
- **总计**：6-10 周
