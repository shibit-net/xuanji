# 璇玑记忆系统 3.0 重构方案

## 一、设计理念

### 1.1 核心原则

**记忆不是为了存储，而是为了在决策点影响行为**

- **决策点驱动**：在Agent需要做出选择的时刻，自动检索和注入相关记忆
- **分级约束**：must（硬约束）> should（建议）> may（参考）
- **智能检索**：关键词 + 场景 + 语义 + 适用性评估
- **自主进化**：通过做梦机制自动提炼、压缩、去重、淘汰记忆

### 1.2 三大核心功能

1. **决策点记忆系统**：在决策点自动检索和注入记忆，影响Agent行为
2. **身份记忆系统**：持久化人格设定，每次对话自动生效
3. **做梦机制**：后台自动整理记忆（提炼、压缩、去重、淘汰）

---

## 二、架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        ChatSession                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │IdentityMgr   │  │DecisionPoint │  │DreamScheduler│     │
│  │              │  │Detector      │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        AgentLoop                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  用户消息 → 决策点检测 → 记忆检索 → 分级注入 → LLM  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Memory Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │MemoryStore   │  │MemoryRetriever│ │DreamAgent    │     │
│  │(SQLite)      │  │(SubAgent)    │  │(SubAgent)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
1. 用户输入
   ↓
2. 决策点检测（用户消息 + thinking + 工具调用）
   ↓
3. 记忆检索（MemoryRetriever Agent）
   ├─ 关键词过滤（must级别）
   ├─ 场景匹配（usageScenarios）
   ├─ 语义搜索（向量相似度）
   └─ 适用性评估（0-1分）
   ↓
4. 分级注入
   ├─ must → System Prompt（硬约束）
   ├─ should → User Message前缀（建议）
   └─ may → 仅记录使用统计
   ↓
5. LLM决策（受记忆影响）
   ↓
6. 工具执行
   ↓
7. 反馈记录（usageCount++, effectiveCount++）
   ↓
8. 会话结束 → 触发做梦（后台异步）
```

---

## 三、数据结构设计

### 3.1 MemoryEntry 扩展

**文件**：`src/memory/types.ts`

```typescript
export interface MemoryEntry {
  // ========== 现有字段 ==========
  id: string;
  content: string;
  type: MemoryType;
  scope: 'global' | 'project';
  volatility: 'permanent' | 'session' | 'temporary';
  significance: number;          // 0-1，重要性评分
  categoryLabel?: string;
  timestamp: number;

  // ========== 新增字段：决策点记忆 ==========
  usageScenarios: string[];      // 使用场景标签（LLM动态发现）
  constraint: 'must' | 'should' | 'may';  // 约束级别
  usageCount: number;            // 使用次数
  lastUsed?: number;             // 最后使用时间戳
  effectiveCount: number;        // 有效次数（被采纳）
  origin: 'user' | 'agent' | 'dream';  // 记忆来源
  relatedMemories: string[];     // 关联记忆ID列表

  // ========== 新增字段：做梦机制 ==========
  dreamGeneration: number;       // 做梦代数（0=原始，1+=衍生）
  confidence: number;            // 置信度（0-1）
  evidenceCount: number;         // 支持证据数量
  lastReviewed?: number;         // 最后复审时间戳
  
  // ========== 新增字段：软删除 ==========
  deletedAt?: number;            // 删除时间戳
  deleteReason?: string;         // 删除原因
}

// 记忆类型扩展
export type MemoryType =
  // 现有类型
  | 'user_preference'    // 用户偏好
  | 'user_fact'          // 用户事实
  | 'relationship'       // 人际关系
  | 'important_date'     // 重要日期
  | 'decision'           // 决策记录
  | 'tool_pattern'       // 工具使用模式
  | 'error_resolution'   // 错误解决方案
  // 新增类型
  | 'identity'           // 身份设定（用户称呼、助手名字）
  | 'experience'         // 经验总结（做梦生成）
  | 'lesson'             // 教训记录（做梦生成）
  | 'pattern'            // 模式识别（做梦生成）
  | 'meta_cognition';    // 元认知（做梦生成）

// 决策点定义
export interface DecisionPoint {
  type: string;           // 决策类型
  tool?: string;          // 相关工具名
  input?: any;            // 工具输入
  thinking?: string;      // 思考内容
  keywords: string[];     // 关键词列表
  timestamp: number;
}

// 检索到的记忆（带评分）
export interface RetrievedMemory extends MemoryEntry {
  applicability: number;  // 适用性评分（0-1）
  reason: string;         // 检索原因
}

// 身份记忆
export interface IdentityMemory {
  userTitle?: string;      // 用户称呼（"先生"、"女士"）
  assistantName?: string;  // 助手名字（"贾维斯"）
  persona?: string;        // 人格设定
  tone?: string;           // 语气风格
}
```

### 3.2 数据库 Schema 升级

**文件**：`src/memory/MemoryStore.ts`

```sql
-- 新增列
ALTER TABLE memories ADD COLUMN usageScenarios TEXT DEFAULT '[]';
ALTER TABLE memories ADD COLUMN constraint TEXT DEFAULT 'may';
ALTER TABLE memories ADD COLUMN usageCount INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN lastUsed INTEGER;
ALTER TABLE memories ADD COLUMN effectiveCount INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN origin TEXT DEFAULT 'user';
ALTER TABLE memories ADD COLUMN relatedMemories TEXT DEFAULT '[]';
ALTER TABLE memories ADD COLUMN dreamGeneration INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN evidenceCount INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN lastReviewed INTEGER;
ALTER TABLE memories ADD COLUMN deletedAt INTEGER;
ALTER TABLE memories ADD COLUMN deleteReason TEXT;

-- 新增索引
CREATE INDEX idx_constraint ON memories(constraint);
CREATE INDEX idx_origin ON memories(origin);
CREATE INDEX idx_dream_generation ON memories(dreamGeneration);
CREATE INDEX idx_last_used ON memories(lastUsed);
CREATE INDEX idx_deleted_at ON memories(deletedAt);
CREATE INDEX idx_usage_count ON memories(usageCount);

-- 查询时排除已删除记忆
CREATE VIEW active_memories AS
SELECT * FROM memories WHERE deletedAt IS NULL;
```

### 3.3 数据迁移脚本

**文件**：`src/memory/migrations/001_add_decision_point_fields.ts`

```typescript
export async function migrate(db: Database): Promise<void> {
  // 1. 添加新列（带默认值）
  await db.exec(`
    ALTER TABLE memories ADD COLUMN usageScenarios TEXT DEFAULT '[]';
    ALTER TABLE memories ADD COLUMN constraint TEXT DEFAULT 'may';
    ALTER TABLE memories ADD COLUMN usageCount INTEGER DEFAULT 0;
    ALTER TABLE memories ADD COLUMN lastUsed INTEGER;
    ALTER TABLE memories ADD COLUMN effectiveCount INTEGER DEFAULT 0;
    ALTER TABLE memories ADD COLUMN origin TEXT DEFAULT 'user';
    ALTER TABLE memories ADD COLUMN relatedMemories TEXT DEFAULT '[]';
    ALTER TABLE memories ADD COLUMN dreamGeneration INTEGER DEFAULT 0;
    ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0;
    ALTER TABLE memories ADD COLUMN evidenceCount INTEGER DEFAULT 0;
    ALTER TABLE memories ADD COLUMN lastReviewed INTEGER;
    ALTER TABLE memories ADD COLUMN deletedAt INTEGER;
    ALTER TABLE memories ADD COLUMN deleteReason TEXT;
  `);

  // 2. 创建索引
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_constraint ON memories(constraint);
    CREATE INDEX IF NOT EXISTS idx_origin ON memories(origin);
    CREATE INDEX IF NOT EXISTS idx_dream_generation ON memories(dreamGeneration);
    CREATE INDEX IF NOT EXISTS idx_last_used ON memories(lastUsed);
    CREATE INDEX IF NOT EXISTS idx_deleted_at ON memories(deletedAt);
    CREATE INDEX IF NOT EXISTS idx_usage_count ON memories(usageCount);
  `);

  // 3. 创建视图
  await db.exec(`
    CREATE VIEW IF NOT EXISTS active_memories AS
    SELECT * FROM memories WHERE deletedAt IS NULL;
  `);

  // 4. 迁移现有数据（根据type推断constraint）
  await db.exec(`
    UPDATE memories
    SET constraint = CASE
      WHEN type IN ('user_preference', 'tool_pattern') THEN 'should'
      WHEN type IN ('decision', 'error_resolution') THEN 'must'
      ELSE 'may'
    END
    WHERE constraint = 'may';
  `);

  console.log('✅ 数据迁移完成');
}
```

---

## 四、核心模块实现

### 4.1 决策点检测器

**文件**：`src/memory/DecisionPointDetector.ts`

```typescript
import { DecisionPoint, ToolCall, Message } from '@/core/types';
import { logger } from '@/core/logger';

export class DecisionPointDetector {
  private log = logger.child({ module: 'DecisionPointDetector' });

  /**
   * 综合检测决策点
   */
  async detect(context: {
    toolCall?: ToolCall;
    thinking?: string;
    userMessage: string;
    conversationHistory: Message[];
  }): Promise<DecisionPoint[]> {
    const points: DecisionPoint[] = [];

    // 1. 工具调用决策点（确定性高）
    if (context.toolCall) {
      const toolPoint = this.detectFromTool(context.toolCall);
      if (toolPoint) {
        points.push(toolPoint);
        this.log.debug('检测到工具决策点', { type: toolPoint.type, tool: toolPoint.tool });
      }
    }

    // 2. Thinking决策点（语义理解）
    if (context.thinking) {
      const thinkingPoints = this.detectFromThinking(context.thinking);
      points.push(...thinkingPoints);
      if (thinkingPoints.length > 0) {
        this.log.debug('检测到思考决策点', { count: thinkingPoints.length });
      }
    }

    // 3. 用户消息决策点（隐式需求）
    const userPoints = this.detectFromUserMessage(context.userMessage);
    points.push(...userPoints);
    if (userPoints.length > 0) {
      this.log.debug('检测到用户消息决策点', { count: userPoints.length });
    }

    return points;
  }

  /**
   * 从工具调用检测决策点
   */
  private detectFromTool(toolCall: ToolCall): DecisionPoint | null {
    const decisionMap: Record<string, { type: string; keywords: string[] }> = {
      'bash': {
        type: 'command-execution',
        keywords: ['npm', 'pnpm', 'yarn', 'install', 'build', 'test', 'run']
      },
      'write': {
        type: 'file-creation',
        keywords: ['config', 'package.json', 'tsconfig', 'vite.config', '.env']
      },
      'edit': {
        type: 'code-modification',
        keywords: ['function', 'class', 'import', 'export', 'const', 'let']
      },
      'read': {
        type: 'file-reading',
        keywords: ['config', 'package', 'readme', 'doc']
      },
      'grep': {
        type: 'code-search',
        keywords: ['function', 'class', 'import', 'TODO', 'FIXME']
      }
    };

    const config = decisionMap[toolCall.name];
    if (!config) return null;

    // 提取输入中的关键词
    const inputStr = JSON.stringify(toolCall.input).toLowerCase();
    const matchedKeywords = config.keywords.filter(kw => inputStr.includes(kw));

    if (matchedKeywords.length === 0) return null;

    return {
      type: config.type,
      tool: toolCall.name,
      input: toolCall.input,
      keywords: matchedKeywords,
      timestamp: Date.now()
    };
  }

  /**
   * 从thinking检测决策点
   */
  private detectFromThinking(thinking: string): DecisionPoint[] {
    const points: DecisionPoint[] = [];

    // 决策关键词模式
    const patterns = [
      { regex: /应该用\s*(\w+)/g, type: 'tool-choice' },
      { regex: /选择\s*(\w+)/g, type: 'option-choice' },
      { regex: /考虑\s*(\w+)/g, type: 'consideration' },
      { regex: /决定\s*(\w+)/g, type: 'decision' },
      { regex: /使用\s*(\w+)/g, type: 'usage-decision' },
      { regex: /采用\s*(\w+)/g, type: 'adoption-decision' }
    ];

    for (const pattern of patterns) {
      const matches = thinking.matchAll(pattern.regex);
      for (const match of matches) {
        points.push({
          type: pattern.type,
          thinking: match[0],
          keywords: [match[1]],
          timestamp: Date.now()
        });
      }
    }

    return points;
  }

  /**
   * 从用户消息检测决策点（隐式需求）
   */
  private detectFromUserMessage(message: string): DecisionPoint[] {
    const points: DecisionPoint[] = [];

    // 识别隐式决策需求
    const implicitPatterns = [
      { regex: /帮我.*创建|新建|生成/i, type: 'creation-request' },
      { regex: /修改|改成|更新/i, type: 'modification-request' },
      { regex: /用什么|选择什么|推荐/i, type: 'recommendation-request' },
      { regex: /如何|怎么|怎样/i, type: 'how-to-request' }
    ];

    for (const pattern of implicitPatterns) {
      if (pattern.regex.test(message)) {
        points.push({
          type: pattern.type,
          keywords: this.extractKeywords(message),
          timestamp: Date.now()
        });
      }
    }

    return points;
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 中文停用词
    const stopWords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好'
    ]);

    // 分词（简单实现，实际可用jieba等）
    const words = text
      .split(/[\s，。！？、；：""''（）【】《》\[\]]+/)
      .filter(w => w.length > 1 && !stopWords.has(w));

    return words.slice(0, 5);  // 最多5个关键词
  }
}
```


### 4.2 MemoryRetriever（智能检索）

**文件**：`src/memory/MemoryRetriever.ts`

```typescript
import { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { MemoryStore } from './MemoryStore';
import { DecisionPoint, RetrievedMemory, MemoryEntry } from './types';
import { logger } from '@/core/logger';

export class MemoryRetriever {
  private subAgentFactory: SubAgentFactory;
  private memoryStore: MemoryStore;

  constructor(subAgentFactory: SubAgentFactory, memoryStore: MemoryStore) {
    this.subAgentFactory = subAgentFactory;
    this.memoryStore = memoryStore;
  }

  /**
   * 根据决策点检索相关记忆
   */
  async retrieve(context: {
    decisionPoints: DecisionPoint[];
    userMessage: string;
    conversationHistory: any[];
    currentScene: string;
  }): Promise<RetrievedMemory[]> {
    if (context.decisionPoints.length === 0) {
      return [];
    }

    logger.debug('开始记忆检索', {
      decisionPointCount: context.decisionPoints.length,
      scene: context.currentScene
    });

    const allMemories: RetrievedMemory[] = [];

    // 1. 针对每个决策点检索记忆
    for (const point of context.decisionPoints) {
      const memories = await this.retrieveForDecisionPoint(point, context);
      allMemories.push(...memories);
    }

    // 2. 去重（同一条记忆可能匹配多个决策点）
    const uniqueMemories = this.deduplicateMemories(allMemories);

    // 3. 排序（constraint > applicability > recency）
    const sorted = this.sortMemories(uniqueMemories);

    // 4. 更新使用统计
    await this.updateUsageStats(sorted);

    logger.info(`检索到 ${sorted.length} 条相关记忆`);

    return sorted;
  }

  /**
   * 针对单个决策点检索记忆
   */
  private async retrieveForDecisionPoint(
    point: DecisionPoint,
    context: any
  ): Promise<RetrievedMemory[]> {
    // 1. 关键词快速过滤（must级别优先）
    const mustMemories = await this.memoryStore.search({
      constraint: 'must',
      keywords: point.keywords,
      limit: 10
    });

    // 2. 场景匹配
    const sceneMemories = await this.memoryStore.search({
      usageScenarios: [point.type, context.currentScene],
      limit: 20
    });

    // 3. 语义搜索（向量相似度）
    const semanticQuery = point.thinking || point.keywords.join(' ');
    const semanticMemories = await this.memoryStore.vectorSearch({
      query: semanticQuery,
      limit: 10,
      threshold: 0.7
    });

    // 4. 合并候选记忆
    const allCandidates = [
      ...mustMemories,
      ...sceneMemories,
      ...semanticMemories
    ];

    // 5. 调用 MemoryRetriever SubAgent 评估适用性
    const evaluated = await this.evaluateApplicability(
      allCandidates,
      point,
      context
    );

    return evaluated;
  }

  /**
   * 评估记忆适用性（调用SubAgent）
   */
  private async evaluateApplicability(
    memories: MemoryEntry[],
    point: DecisionPoint,
    context: any
  ): Promise<RetrievedMemory[]> {
    if (memories.length === 0) return [];

    // 调用 MemoryRetriever SubAgent
    const agent = await this.subAgentFactory.create('memory-retriever', {
      maxIterations: 5,
      timeout: 30000
    });

    const prompt = `评估以下记忆对当前决策点的适用性：

决策点类型: ${point.type}
决策关键词: ${point.keywords.join(', ')}
当前场景: ${context.currentScene}
用户消息: ${context.userMessage}

记忆列表:
${memories.map((m, i) => `${i + 1}. [${m.constraint}] ${m.content}`).join('\n')}

请为每条记忆打分（0-1），并说明理由。返回JSON格式：
[
  { "index": 1, "score": 0.9, "reason": "..." },
  ...
]`;

    const result = await agent.run(prompt);

    return this.parseEvaluationResult(result, memories);
  }

  /**
   * 解析评估结果
   */
  private parseEvaluationResult(
    agentResult: any,
    memories: MemoryEntry[]
  ): RetrievedMemory[] {
    try {
      // 从Agent响应中提取JSON
      const jsonMatch = agentResult.response?.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('无法解析评估结果，使用默认评分');
        return memories.map(m => ({
          ...m,
          applicability: 0.5,
          reason: 'default'
        }));
      }

      const scores = JSON.parse(jsonMatch[0]);

      return memories.map((m, i) => {
        const score = scores.find((s: any) => s.index === i + 1);
        return {
          ...m,
          applicability: score?.score || 0.5,
          reason: score?.reason || 'unknown'
        };
      });
    } catch (error) {
      logger.error('解析评估结果失败', error);
      return memories.map(m => ({
        ...m,
        applicability: 0.5,
        reason: 'parse-error'
      }));
    }
  }

  /**
   * 去重记忆
   */
  private deduplicateMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
    const seen = new Set<string>();
    const unique: RetrievedMemory[] = [];

    for (const memory of memories) {
      if (!seen.has(memory.id)) {
        seen.add(memory.id);
        unique.push(memory);
      }
    }

    return unique;
  }

  /**
   * 排序记忆
   */
  private sortMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
    return memories.sort((a, b) => {
      // 1. constraint优先级: must > should > may
      const constraintOrder = { must: 3, should: 2, may: 1 };
      const constraintDiff =
        constraintOrder[b.constraint] - constraintOrder[a.constraint];
      if (constraintDiff !== 0) return constraintDiff;

      // 2. 适用性分数
      const applicabilityDiff = b.applicability - a.applicability;
      if (applicabilityDiff !== 0) return applicabilityDiff;

      // 3. 有效率
      const effectiveRateA = a.effectiveCount / (a.usageCount || 1);
      const effectiveRateB = b.effectiveCount / (b.usageCount || 1);
      const effectiveRateDiff = effectiveRateB - effectiveRateA;
      if (effectiveRateDiff !== 0) return effectiveRateDiff;

      // 4. 时效性
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    });
  }

  /**
   * 更新使用统计
   */
  private async updateUsageStats(memories: RetrievedMemory[]): Promise<void> {
    for (const memory of memories) {
      await this.memoryStore.update(memory.id, {
        usageCount: memory.usageCount + 1,
        lastUsed: Date.now()
      });
    }
  }
}
```

### 4.3 IdentityManager（身份记忆管理）

**文件**：`src/memory/IdentityManager.ts`

```typescript
import { MemoryStore } from './MemoryStore';
import { IdentityMemory } from './types';
import { logger } from '@/core/logger';

export class IdentityManager {
  private memoryStore: MemoryStore;
  private cachedIdentity: IdentityMemory | null = null;

  constructor(memoryStore: MemoryStore) {
    this.memoryStore = memoryStore;
  }

  /**
   * 保存身份记忆
   */
  async saveIdentity(identity: IdentityMemory): Promise<void> {
    // 删除旧的身份记忆
    const oldIdentities = await this.memoryStore.search({
      type: 'identity',
      scope: 'global'
    });

    for (const old of oldIdentities) {
      await this.memoryStore.delete(old.id);
    }

    // 保存新的身份记忆
    await this.memoryStore.store({
      type: 'identity',
      content: JSON.stringify(identity),
      scope: 'global',
      volatility: 'permanent',
      significance: 1.0,
      constraint: 'must',
      usageScenarios: ['*'],  // 所有场景
      origin: 'user',
      confidence: 1.0,
      usageCount: 0,
      effectiveCount: 0,
      dreamGeneration: 0,
      evidenceCount: 1,
      relatedMemories: []
    });

    // 更新缓存
    this.cachedIdentity = identity;

    logger.info('身份记忆已保存', identity);
  }

  /**
   * 加载身份记忆
   */
  async loadIdentity(): Promise<IdentityMemory | null> {
    // 优先使用缓存
    if (this.cachedIdentity) {
      return this.cachedIdentity;
    }

    const memories = await this.memoryStore.search({
      type: 'identity',
      scope: 'global',
      limit: 1
    });

    if (memories.length === 0) {
      return null;
    }

    try {
      this.cachedIdentity = JSON.parse(memories[0].content);
      return this.cachedIdentity;
    } catch (error) {
      logger.error('解析身份记忆失败', error);
      return null;
    }
  }

  /**
   * 检测用户是否呼叫助手名字
   */
  detectNameCall(message: string, assistantName: string): boolean {
    if (!assistantName) return false;

    const patterns = [
      new RegExp(`^${assistantName}[，,。.！!？?\\s]`),  // 开头呼叫
      new RegExp(`[，,]\\s*${assistantName}[，,。.！!？?\\s]`),  // 中间呼叫
      new RegExp(`${assistantName}$`),  // 结尾呼叫
      new RegExp(`^${assistantName}$`)  // 单独呼叫
    ];

    return patterns.some(p => p.test(message));
  }

  /**
   * 构建身份Prompt
   */
  buildIdentityPrompt(identity: IdentityMemory): string {
    const parts: string[] = [];

    if (identity.assistantName) {
      parts.push(`# 身份设定\n你的名字是 ${identity.assistantName}。`);
    }

    if (identity.userTitle) {
      parts.push(`用户希望你称呼TA为"${identity.userTitle}"。`);
    }

    if (identity.persona) {
      parts.push(`\n# 人格设定\n${identity.persona}`);
    }

    if (identity.tone) {
      parts.push(`\n# 语气风格\n${identity.tone}`);
    }

    return parts.join('\n');
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedIdentity = null;
  }
}
```


### 4.4 DreamAgent（做梦机制）

**Agent配置**：`src/core/agent/builtin/dream-agent.json5`

**实现**：`src/memory/DreamAgent.ts`

```typescript
import { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { MemoryStore } from './MemoryStore';
import { logger } from '@/core/logger';

export interface DreamResult {
  distilled: number;    // 提炼数量
  compressed: number;   // 压缩数量
  deduplicated: number; // 去重数量
  pruned: number;       // 淘汰数量
  scored: number;       // 评分更新数量
  duration: number;     // 耗时（ms）
}

export class DreamAgent {
  private subAgentFactory: SubAgentFactory;
  private memoryStore: MemoryStore;

  constructor(subAgentFactory: SubAgentFactory, memoryStore: MemoryStore) {
    this.subAgentFactory = subAgentFactory;
    this.memoryStore = memoryStore;
  }

  async dream(options: {
    memoryWindow?: number;
    dryRun?: boolean;
  } = {}): Promise<DreamResult> {
    const startTime = Date.now();
    logger.info('🌙 开始做梦（记忆整理）...');

    const memoryWindow = options.memoryWindow || 100;
    const dryRun = options.dryRun || false;

    // 1. 加载待处理的记忆
    const memories = await this.memoryStore.search({
      limit: memoryWindow,
      orderBy: 'timestamp DESC'
    });

    logger.info(`📊 加载 ${memories.length} 条记忆待处理`);

    // 2. 准备上下文
    const context = {
      memories: memories.map(m => ({
        id: m.id,
        content: m.content,
        type: m.type,
        constraint: m.constraint,
        usageCount: m.usageCount,
        effectiveCount: m.effectiveCount,
        lastUsed: m.lastUsed,
        confidence: m.confidence,
        evidenceCount: m.evidenceCount,
        timestamp: m.timestamp
      })),
      currentTime: Date.now(),
      dryRun
    };

    // 3. 调用 DreamAgent SubAgent
    const agent = await this.subAgentFactory.create('dream-agent', {
      maxIterations: 30,
      timeout: 300000
    });

    const agentResult = await agent.run(
      `请对以下记忆进行整理：\n\n${JSON.stringify(context, null, 2)}\n\n` +
      `执行任务：\n` +
      `1. 提炼相似记忆\n` +
      `2. 压缩冗长记忆\n` +
      `3. 去重重复/矛盾记忆\n` +
      `4. 淘汰低价值记忆\n` +
      `5. 更新记忆评分\n\n` +
      `${dryRun ? '【试运行模式，不实际修改】' : ''}`
    );

    // 4. 解析结果
    const result = this.parseDreamResult(agentResult);

    const duration = Date.now() - startTime;
    logger.info(
      `🌙 做梦完成：提炼${result.distilled}条、压缩${result.compressed}条、` +
      `去重${result.deduplicated}条、淘汰${result.pruned}条、` +
      `评分更新${result.scored}条，耗时${duration}ms`
    );

    return { ...result, duration };
  }

  private parseDreamResult(agentResult: any): Omit<DreamResult, 'duration'> {
    const toolCalls = agentResult.toolCalls || [];

    const distilled = toolCalls.filter((t: any) =>
      t.tool === 'memory_store' && t.input?.origin === 'dream'
    ).length;

    const compressed = toolCalls.filter((t: any) =>
      t.tool === 'memory_update' && t.input?.reason === 'compress'
    ).length;

    const deduplicated = toolCalls.filter((t: any) =>
      t.tool === 'memory_delete' && t.input?.reason === 'duplicate'
    ).length;

    const pruned = toolCalls.filter((t: any) =>
      t.tool === 'memory_delete' && t.input?.reason === 'prune'
    ).length;

    const scored = toolCalls.filter((t: any) =>
      t.tool === 'memory_update' && t.input?.reason === 'score'
    ).length;

    return { distilled, compressed, deduplicated, pruned, scored };
  }
}
```

### 4.5 DreamScheduler（做梦调度）

**文件**：`src/memory/DreamScheduler.ts`

```typescript
import { DreamAgent } from './DreamAgent';
import { MemoryStore } from './MemoryStore';
import { logger } from '@/core/logger';

export class DreamScheduler {
  private dreamAgent: DreamAgent;
  private memoryStore: MemoryStore;
  private isRunning = false;
  private lastDreamTime = 0;
  private scheduleTimer?: NodeJS.Timeout;

  constructor(dreamAgent: DreamAgent, memoryStore: MemoryStore) {
    this.dreamAgent = dreamAgent;
    this.memoryStore = memoryStore;
  }

  async shouldDream(): Promise<boolean> {
    if (this.isRunning) return false;

    const now = Date.now();
    const hoursSinceLastDream = (now - this.lastDreamTime) / (3600 * 1000);

    const triggers = {
      daily: hoursSinceLastDream >= 24,
      memoryThreshold: await this.checkMemoryThreshold(),
      userIdle: await this.checkUserIdle()
    };

    return Object.values(triggers).some(t => t);
  }

  async executeDream(options?: { dryRun?: boolean }): Promise<void> {
    if (this.isRunning) {
      logger.warn('🌙 做梦已在运行中，跳过');
      return;
    }

    this.isRunning = true;

    try {
      const result = await this.dreamAgent.dream({
        memoryWindow: 100,
        dryRun: options?.dryRun
      });

      this.lastDreamTime = Date.now();
      logger.info('🌙 做梦报告:', result);

    } catch (error) {
      logger.error('🌙 做梦失败:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async checkMemoryThreshold(): Promise<boolean> {
    const recentCount = await this.memoryStore.count({
      since: this.lastDreamTime || Date.now() - 24 * 3600 * 1000
    });
    return recentCount >= 50;
  }

  private async checkUserIdle(): Promise<boolean> {
    // 简化实现
    return false;
  }

  startSchedule(): void {
    this.scheduleTimer = setInterval(async () => {
      if (await this.shouldDream()) {
        await this.executeDream();
      }
    }, 3600 * 1000);

    logger.info('🌙 做梦调度器已启动');
  }

  stopSchedule(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = undefined;
      logger.info('🌙 做梦调度器已停止');
    }
  }
}
```

---

## 五、集成到系统

### 5.1 AgentLoop 集成

**文件**：`src/core/agent/AgentLoop.ts`

```typescript
export class AgentLoop {
  private decisionPointDetector: DecisionPointDetector;
  private memoryRetriever: MemoryRetriever;
  private identityManager: IdentityManager;

  async run(userMessage: string) {
    // 1. 检测用户消息中的决策点
    const userDecisionPoints = await this.decisionPointDetector.detect({
      userMessage,
      conversationHistory: this.messages
    });

    // 2. 检索记忆
    let memories: RetrievedMemory[] = [];
    if (userDecisionPoints.length > 0) {
      memories = await this.memoryRetriever.retrieve({
        decisionPoints: userDecisionPoints,
        userMessage,
        conversationHistory: this.messages,
        currentScene: this.scene
      });
    }

    // 3. 分级注入记忆
    const mustMemories = memories.filter(m => m.constraint === 'must');
    const shouldMemories = memories.filter(m => m.constraint === 'should');

    // 4. 构建System Prompt（包含身份和must记忆）
    const identity = await this.identityManager.loadIdentity();
    const systemPrompt = await this.promptOrchestrator.buildSystemPrompt({
      scene: this.scene,
      complexity: this.complexity,
      identity,
      mustMemories
    });

    // 5. 注入should记忆到User Message
    if (shouldMemories.length > 0) {
      const suggestions = shouldMemories
        .map(m => `- ${m.content}`)
        .join('\n');
      userMessage = `[参考建议]\n${suggestions}\n\n${userMessage}`;
    }

    // 6. 检测名字呼叫
    if (identity?.assistantName) {
      const isNameCall = this.identityManager.detectNameCall(
        userMessage,
        identity.assistantName
      );
      if (isNameCall) {
        this.shouldRespondToName = true;
      }
    }

    // 7. 开始LLM调用
    const stream = await this.provider.chat({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...this.messages,
        { role: 'user', content: userMessage }
      ],
      tools: this.tools,
      stream: true
    });

    // 8. 处理流式响应
    for await (const chunk of stream) {
      if (chunk.type === 'thinking') {
        // 监听thinking，检测新决策点
        const thinkingPoints = await this.decisionPointDetector.detectFromThinking(
          chunk.content
        );
        // 可选：实时检索记忆
      }

      if (chunk.type === 'tool_call') {
        // 工具调用前检测决策点
        const toolPoint = this.decisionPointDetector.detectFromTool(
          chunk.toolCall
        );
        // 注入记忆到工具上下文
      }
    }
  }
}
```

### 5.2 ChatSession 集成

**文件**：`src/core/chat/ChatSession.ts`

```typescript
export class ChatSession {
  private identityManager: IdentityManager;
  private dreamScheduler: DreamScheduler;

  async initialize() {
    // 加载身份记忆
    const identity = await this.identityManager.loadIdentity();
    if (identity) {
      this.identity = identity;
      logger.info(`👤 加载身份：${identity.assistantName || 'Xuanji'}`);
    }

    // 启动做梦调度器
    this.dreamScheduler.startSchedule();
  }

  async close() {
    // 会话结束时触发做梦
    if (await this.dreamScheduler.shouldDream()) {
      this.dreamScheduler.executeDream().catch(err => {
        logger.error('做梦失败', err);
      });
    }

    // 停止调度器
    this.dreamScheduler.stopSchedule();
  }
}
```

### 5.3 PromptOrchestrator 集成

**文件**：`src/core/chat/PromptOrchestrator.ts`

```typescript
export class PromptOrchestrator {
  async buildSystemPrompt(options: {
    scene: string;
    complexity: string;
    identity?: IdentityMemory;
    mustMemories?: MemoryEntry[];
  }): Promise<string> {
    const parts: string[] = [];

    // 1. 基础Prompt
    const basePrompt = await this.layeredBuilder.build({
      scene: options.scene,
      complexity: options.complexity
    });
    parts.push(basePrompt);

    // 2. 身份记忆
    if (options.identity) {
      parts.push(this.buildIdentityPrompt(options.identity));
    }

    // 3. must级别记忆（硬约束）
    if (options.mustMemories && options.mustMemories.length > 0) {
      parts.push(this.buildMustMemoriesPrompt(options.mustMemories));
    }

    return parts.join('\n\n');
  }

  private buildIdentityPrompt(identity: IdentityMemory): string {
    const parts: string[] = ['# 身份设定'];

    if (identity.assistantName) {
      parts.push(`你的名字是 ${identity.assistantName}。`);
    }

    if (identity.userTitle) {
      parts.push(`用户希望你称呼TA为"${identity.userTitle}"。`);
    }

    if (identity.persona) {
      parts.push(`\n## 人格设定\n${identity.persona}`);
    }

    if (identity.tone) {
      parts.push(`\n## 语气风格\n${identity.tone}`);
    }

    return parts.join('\n');
  }

  private buildMustMemoriesPrompt(memories: MemoryEntry[]): string {
    const constraints = memories
      .map(m => `- ${m.content}`)
      .join('\n');

    return `# 硬性约束（必须遵守）\n${constraints}`;
  }
}
```

---

## 六、工具升级

### 6.1 新增工具

**MemoryUpdateTool**：`src/core/tools/MemoryUpdateTool.ts`

```typescript
export class MemoryUpdateTool extends Tool {
  name = 'memory_update';
  description = '更新现有记忆的字段';

  inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '记忆ID' },
      updates: {
        type: 'object',
        description: '要更新的字段',
        properties: {
          content: { type: 'string' },
          significance: { type: 'number' },
          confidence: { type: 'number' },
          constraint: { type: 'string', enum: ['must', 'should', 'may'] }
        }
      },
      reason: { type: 'string', description: '更新原因' }
    },
    required: ['id', 'updates', 'reason']
  };

  async execute(input: any): Promise<any> {
    await this.memoryStore.update(input.id, input.updates);
    return { success: true, message: `记忆已更新（${input.reason}）` };
  }
}
```

**MemoryDeleteTool**：`src/core/tools/MemoryDeleteTool.ts`

```typescript
export class MemoryDeleteTool extends Tool {
  name = 'memory_delete';
  description = '删除记忆（软删除）';

  inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '记忆ID' },
      reason: { type: 'string', description: '删除原因' }
    },
    required: ['id', 'reason']
  };

  async execute(input: any): Promise<any> {
    await this.memoryStore.update(input.id, {
      deletedAt: Date.now(),
      deleteReason: input.reason
    });
    return { success: true, message: `记忆已删除（${input.reason}）` };
  }
}
```

### 6.2 升级现有工具

**MemoryStoreTool**：支持新字段

```typescript
// 添加新字段到inputSchema
usageScenarios: {
  type: 'array',
  items: { type: 'string' },
  description: '使用场景标签'
},
constraint: {
  type: 'string',
  enum: ['must', 'should', 'may'],
  description: '约束级别'
}
```

**RetrieveMemoryTool**：调用MemoryRetriever

```typescript
async execute(input: any): Promise<any> {
  const decisionPoints = await this.decisionPointDetector.detect({
    userMessage: input.query,
    conversationHistory: this.context.messages
  });

  const memories = await this.memoryRetriever.retrieve({
    decisionPoints,
    userMessage: input.query,
    conversationHistory: this.context.messages,
    currentScene: this.context.scene
  });

  return { memories };
}
```

---

## 七、命令行接口

### 7.1 身份设置命令

**文件**：`src/adapters/cli/commands/IdentityCommand.ts`

```typescript
export class IdentityCommand {
  name = '/identity';
  description = '设置身份记忆';

  async execute(args: string[]) {
    if (args.length === 0) {
      // 显示当前身份
      const identity = await identityManager.loadIdentity();
      if (identity) {
        console.log('当前身份设定:');
        if (identity.assistantName) {
          console.log(`  助手名字: ${identity.assistantName}`);
        }
        if (identity.userTitle) {
          console.log(`  用户称呼: ${identity.userTitle}`);
        }
      } else {
        console.log('未设置身份');
      }
      return;
    }

    // 解析参数
    const identity: IdentityMemory = {};

    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];

      if (key === '--name') {
        identity.assistantName = value;
      } else if (key === '--title') {
        identity.userTitle = value;
      } else if (key === '--persona') {
        identity.persona = value;
      } else if (key === '--tone') {
        identity.tone = value;
      }
    }

    await identityManager.saveIdentity(identity);
    console.log('✅ 身份设定已保存');
  }
}
```

### 7.2 做梦命令

**文件**：`src/adapters/cli/commands/DreamCommand.ts`

```typescript
export class DreamCommand {
  name = '/dream';
  description = '手动触发记忆整理';

  async execute(args: string[]) {
    const dryRun = args.includes('--dry-run');

    console.log('🌙 开始做梦...');

    const result = await dreamScheduler.executeDream({ dryRun });

    console.log('🌙 做梦完成:');
    console.log(`  - 提炼: ${result.distilled} 条`);
    console.log(`  - 压缩: ${result.compressed} 条`);
    console.log(`  - 去重: ${result.deduplicated} 条`);
    console.log(`  - 淘汰: ${result.pruned} 条`);
    console.log(`  - 评分更新: ${result.scored} 条`);
    console.log(`  - 耗时: ${result.duration}ms`);
  }
}
```

---

## 八、实施计划

### Phase 1: 数据层升级（2天）

**任务**：
- [ ] 扩展 MemoryEntry 接口
- [ ] 升级 MemoryStore 数据库schema
- [ ] 编写数据迁移脚本
- [ ] 向后兼容性测试

**产出**：
- `src/memory/types.ts`（更新）
- `src/memory/MemoryStore.ts`（更新）
- `src/memory/migrations/001_add_decision_point_fields.ts`（新增）

### Phase 2: 决策点检测（2天）

**任务**：
- [ ] 实现 DecisionPointDetector
- [ ] 集成到 AgentLoop
- [ ] 单元测试

**产出**：
- `src/memory/DecisionPointDetector.ts`（新增）
- 测试用例

### Phase 3: 智能检索（3天）

**任务**：
- [ ] 创建 memory-retriever.json5 配置
- [ ] 实现 MemoryRetriever
- [ ] 升级 RetrieveMemoryTool
- [ ] 集成测试

**产出**：
- `src/core/agent/builtin/memory-retriever.json5`（新增）
- `src/memory/MemoryRetriever.ts`（新增）
- `src/core/tools/RetrieveMemoryTool.ts`（更新）

### Phase 4: 身份记忆（2天）

**任务**：
- [ ] 实现 IdentityManager
- [ ] 集成到 PromptOrchestrator
- [ ] 实现名字检测
- [ ] 添加 /identity 命令

**产出**：
- `src/memory/IdentityManager.ts`（新增）
- `src/core/chat/PromptOrchestrator.ts`（更新）
- `src/adapters/cli/commands/IdentityCommand.ts`（新增）

### Phase 5: 做梦机制（3天）

**任务**：
- [ ] 创建 dream-agent.json5 配置
- [ ] 实现 DreamAgent
- [ ] 实现 DreamScheduler
- [ ] 添加 /dream 命令
- [ ] 集成到 ChatSession

**产出**：
- `src/core/agent/builtin/dream-agent.json5`（新增）
- `src/memory/DreamAgent.ts`（新增）
- `src/memory/DreamScheduler.ts`（新增）
- `src/adapters/cli/commands/DreamCommand.ts`（新增）

### Phase 6: 工具升级（1天）

**任务**：
- [ ] 实现 MemoryUpdateTool
- [ ] 实现 MemoryDeleteTool
- [ ] 升级 MemoryStoreTool
- [ ] 注册新工具

**产出**：
- `src/core/tools/MemoryUpdateTool.ts`（新增）
- `src/core/tools/MemoryDeleteTool.ts`（新增）
- `src/core/tools/MemoryStoreTool.ts`（更新）

### Phase 7: 集成测试（2天）

**任务**：
- [ ] 端到端测试
- [ ] 性能测试
- [ ] 文档完善

**产出**：
- 测试报告
- 用户文档

**总计：15天**

---

## 九、使用示例

### 9.1 身份设置

```bash
# 设置身份
$ /identity --name 贾维斯 --title 先生

✅ 身份设定已保存

# 下次对话自动生效
用户: 贾维斯，帮我写个函数
贾维斯: 好的，先生。我来帮您写这个函数...
```

### 9.2 决策点记忆

```bash
# 第一次：用户告知偏好
用户: 我们项目统一用 pnpm，不要用 npm
Xuanji: 好的，我已记住。[保存记忆: constraint=must, usageScenarios=['package-management']]

# 第二次：自动应用记忆
用户: 帮我安装 axios
Xuanji: [检测决策点: command-execution]
        [检索记忆: "项目统一用pnpm"]
        [注入到System Prompt]
        好的，我用 pnpm 安装：
        $ pnpm add axios
```

### 9.3 做梦机制

```bash
# 手动触发
$ /dream

🌙 开始做梦...
📊 加载 100 条记忆待处理
🌙 做梦完成:
  - 提炼: 5 条
  - 压缩: 12 条
  - 去重: 3 条
  - 淘汰: 8 条
  - 评分更新: 45 条
  - 耗时: 23456ms

# 自动触发（后台）
[凌晨2点]
🌙 触发做梦条件: { daily: true }
🌙 开始做梦（记忆整理）...
🌙 做梦完成：提炼5条、压缩12条、去重3条、淘汰8条、评分更新45条
```

---

## 十、性能指标

### 10.1 检索性能

- **关键词过滤**：< 10ms
- **场景匹配**：< 50ms
- **语义搜索**：< 100ms
- **适用性评估**：< 2s（SubAgent调用）
- **总检索时间**：< 3s

### 10.2 做梦性能

- **处理100条记忆**：< 5分钟
- **后台异步执行**：不影响用户交互
- **触发频率**：每24小时或50条新记忆

### 10.3 存储开销

- **单条记忆**：< 1KB
- **100条记忆**：< 100KB
- **SQLite数据库**：< 10MB（1万条记忆）

---

## 十一、关键优势

1. **LLM驱动**：所有决策由Agent自主完成，无硬编码规则
2. **决策点驱动**：记忆在需要时自动检索，影响实际行为
3. **分级约束**：must/should/may三级，精确控制影响力
4. **自主进化**：做梦机制持续优化记忆质量
5. **身份一致性**：人格设定持久化，每次对话自动生效
6. **向后兼容**：现有记忆自动迁移，无缝升级

---

## 十二、风险与对策

### 12.1 性能风险

**风险**：记忆检索可能影响响应速度

**对策**：
- 关键词快速过滤（must级别优先）
- 异步检索（不阻塞主流程）
- 缓存热门记忆
- 限制检索数量（最多20条）

### 12.2 准确性风险

**风险**：决策点检测可能误判

**对策**：
- 多层检测机制（工具+thinking+用户消息）
- 适用性评估（SubAgent打分）
- 用户反馈机制（effectiveCount）
- 做梦时淘汰低效记忆

### 12.3 存储风险

**风险**：记忆数量膨胀

**对策**：
- 做梦机制定期清理
- 软删除（可恢复）
- 按volatility自动淘汰
- 压缩冗长记忆

---

## 十三、后续优化方向

1. **多模态记忆**：支持图片、代码片段等
2. **记忆共享**：团队级记忆库
3. **记忆导出**：支持导出为Markdown/JSON
4. **记忆可视化**：Web界面查看记忆图谱
5. **A/B测试**：对比不同记忆策略的效果

---

**文档版本**：v1.0  
**创建日期**：2026-04-17  
**作者**：Xuanji Team

---

## 六、工具升级

### 6.1 新增工具

#### MemoryUpdateTool

**文件**：`src/core/tools/MemoryUpdateTool.ts`

```typescript
export class MemoryUpdateTool extends Tool {
  name = 'memory_update';
  description = '更新现有记忆的字段（用于压缩、评分更新等）';

  inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '记忆ID' },
      updates: {
        type: 'object',
        description: '要更新的字段',
        properties: {
          content: { type: 'string' },
          significance: { type: 'number' },
          confidence: { type: 'number' },
          constraint: { type: 'string', enum: ['must', 'should', 'may'] },
          usageScenarios: { type: 'array', items: { type: 'string' } }
        }
      },
      reason: { type: 'string', description: '更新原因' }
    },
    required: ['id', 'updates', 'reason']
  };

  async execute(input: any): Promise<any> {
    await this.memoryStore.update(input.id, input.updates);
    return { success: true, message: `记忆已更新（${input.reason}）` };
  }
}
```

#### MemoryDeleteTool

**文件**：`src/core/tools/MemoryDeleteTool.ts`

```typescript
export class MemoryDeleteTool extends Tool {
  name = 'memory_delete';
  description = '删除记忆（软删除）';

  inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '记忆ID' },
      reason: { type: 'string', description: '删除原因' }
    },
    required: ['id', 'reason']
  };

  async execute(input: any): Promise<any> {
    await this.memoryStore.update(input.id, {
      deletedAt: Date.now(),
      deleteReason: input.reason
    });
    return { success: true, message: `记忆已删除（${input.reason}）` };
  }
}
```

### 6.2 升级现有工具

#### MemoryStoreTool 升级

```typescript
// 支持新字段
async execute(input: any): Promise<any> {
  const entry: MemoryEntry = {
    id: generateId(),
    content: input.content,
    type: input.type,
    scope: input.scope || 'global',
    volatility: input.volatility || 'permanent',
    significance: input.significance || 0.5,
    timestamp: Date.now(),
    
    // 新增字段
    usageScenarios: input.usageScenarios || [],
    constraint: input.constraint || 'may',
    usageCount: 0,
    effectiveCount: 0,
    origin: input.origin || 'user',
    relatedMemories: input.relatedMemories || [],
    dreamGeneration: input.dreamGeneration || 0,
    confidence: input.confidence || 1.0,
    evidenceCount: input.evidenceCount || 1
  };

  await this.memoryStore.store(entry);
  return { success: true, id: entry.id };
}
```

#### RetrieveMemoryTool 重构

```typescript
// 调用 MemoryRetriever 而不是直接查询
async execute(input: any): Promise<any> {
  const decisionPoints = await this.decisionPointDetector.detect({
    userMessage: input.query,
    conversationHistory: this.context.messages,
    currentScene: this.context.scene
  });

  const memories = await this.memoryRetriever.retrieve({
    decisionPoints,
    userMessage: input.query,
    conversationHistory: this.context.messages,
    currentScene: this.context.scene
  });

  return {
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      constraint: m.constraint,
      applicability: m.applicability,
      reason: m.reason
    }))
  };
}
```

---

## 七、使用示例

### 7.1 身份设置

```bash
用户: 请称呼我为先生，你的名字叫贾维斯
Xuanji: 好的，先生。我现在的名字是贾维斯，很高兴为您服务。

# 下次对话自动生效
用户: 贾维斯，帮我写个函数
贾维斯: 好的，先生。我来帮您写这个函数...
```

### 7.2 决策点记忆

```bash
# 第一次：用户设置偏好
用户: 我们项目统一用 pnpm，不要用 npm
Xuanji: 好的，我已记住。以后会使用 pnpm。

# 第二次：自动应用记忆
用户: 帮我安装 axios
Xuanji: [检测到决策点: command-execution]
        [检索到记忆: "项目统一用pnpm" (must)]
        [注入到System Prompt]
        好的，我用 pnpm 安装：
        $ pnpm add axios
```

### 7.3 做梦机制

```bash
# 后台自动运行
[凌晨2点，DreamScheduler触发]
🌙 开始做梦（记忆整理）...
📊 加载 100 条记忆待处理
💡 提炼: 合并3条关于"用pnpm"的记忆
💡 压缩: 精简5条冗长记忆
💡 去重: 删除2条重复记忆
💡 淘汰: 删除8条过时记忆
🌙 做梦完成，耗时23456ms

# 手动触发
$ /dream
🌙 开始做梦...
🌙 做梦完成:
  - 提炼: 3 条
  - 压缩: 5 条
  - 去重: 2 条
  - 淘汰: 8 条
  - 评分更新: 45 条
  - 耗时: 23456ms
```

---

## 八、实现计划

### Phase 1: 数据结构升级（1天）

**任务**：
- [ ] 扩展 `MemoryEntry` 接口（types.ts）
- [ ] 升级 `MemoryStore` 数据库 schema
- [ ] 编写数据迁移脚本
- [ ] 向后兼容性测试

**验收标准**：
- 现有记忆可以正常读取
- 新字段有合理的默认值
- 迁移脚本可以重复执行

### Phase 2: 决策点检测（1天）

**任务**：
- [ ] 实现 `DecisionPointDetector` 类
- [ ] 支持三种检测方式（工具/thinking/用户消息）
- [ ] 集成到 `AgentLoop`
- [ ] 单元测试

**验收标准**：
- 能正确识别常见决策点
- 误报率 < 10%
- 漏报率 < 20%

### Phase 3: 智能检索（2天）

**任务**：
- [ ] 创建 `memory-retriever.json5` Agent配置
- [ ] 实现 `MemoryRetriever` 类
- [ ] 实现混合检索（关键词+场景+语义）
- [ ] 实现适用性评估
- [ ] 重构 `RetrieveMemoryTool`

**验收标准**：
- 检索延迟 < 500ms
- 相关性准确率 > 80%
- 支持分级排序

### Phase 4: 身份记忆（1天）

**任务**：
- [ ] 实现 `IdentityManager` 类
- [ ] 集成到 `PromptOrchestrator`
- [ ] 实现名字检测和响应
- [ ] 添加 `/identity` 命令

**验收标准**：
- 身份设定持久化
- 每次对话自动注入
- 名字呼叫能正确响应

### Phase 5: 做梦机制（2-3天）

**任务**：
- [ ] 创建 `dream-agent.json5` Agent配置
- [ ] 实现 `DreamAgent` 类
- [ ] 实现 `DreamScheduler` 调度器
- [ ] 实现四大任务（提炼/压缩/去重/淘汰）
- [ ] 添加 `/dream` 命令

**验收标准**：
- 能自动触发做梦
- 记忆数量保持稳定
- 记忆质量提升

### Phase 6: 工具升级（1天）

**任务**：
- [ ] 实现 `MemoryUpdateTool`
- [ ] 实现 `MemoryDeleteTool`
- [ ] 升级 `MemoryStoreTool`
- [ ] 升级 `MemoryFlushAgent`

**验收标准**：
- 所有工具支持新字段
- 向后兼容

### Phase 7: 集成测试（1天）

**任务**：
- [ ] 端到端测试（身份+检索+做梦）
- [ ] 性能测试
- [ ] 压力测试
- [ ] 文档完善

**验收标准**：
- 所有功能正常工作
- 性能符合预期
- 文档完整

---

## 九、性能指标

### 9.1 检索性能

- **关键词过滤**：< 10ms
- **场景匹配**：< 50ms
- **语义搜索**：< 100ms
- **适用性评估**：< 500ms
- **总延迟**：< 1s

### 9.2 做梦性能

- **处理100条记忆**：< 60s
- **提炼相似记忆**：< 10s
- **压缩冗长记忆**：< 15s
- **去重记忆**：< 5s
- **淘汰记忆**：< 5s
- **评分更新**：< 10s

### 9.3 存储性能

- **单条记忆大小**：< 1KB
- **100条记忆**：< 100KB
- **1000条记忆**：< 1MB
- **数据库大小**：< 10MB（1万条记忆）

---

## 十、风险与挑战

### 10.1 技术风险

1. **LLM调用成本**：MemoryRetriever 和 DreamAgent 频繁调用LLM
   - **缓解**：使用较小模型（Haiku）、批量处理、缓存结果

2. **检索延迟**：语义搜索可能较慢
   - **缓解**：关键词预过滤、异步检索、结果缓存

3. **记忆膨胀**：记忆数量持续增长
   - **缓解**：做梦机制定期清理、设置记忆上限

### 10.2 产品风险

1. **误删重要记忆**：做梦机制可能删除有用记忆
   - **缓解**：软删除、保留must级别记忆、提供恢复功能

2. **记忆冲突**：新旧记忆矛盾
   - **缓解**：时间戳优先、置信度评估、用户确认

3. **隐私问题**：记忆包含敏感信息
   - **缓解**：本地存储、加密、用户可删除

---

## 十一、后续优化

### 11.1 短期优化（1-2周）

- [ ] 记忆可视化界面（查看/编辑/删除）
- [ ] 记忆导入/导出功能
- [ ] 记忆统计和分析
- [ ] 做梦报告推送

### 11.2 中期优化（1-2月）

- [ ] 多模态记忆（图片、代码片段）
- [ ] 记忆分享（团队协作）
- [ ] 记忆推荐（主动提醒）
- [ ] A/B测试（评估记忆效果）

### 11.3 长期优化（3-6月）

- [ ] 联邦学习（跨用户记忆聚合）
- [ ] 知识图谱（记忆关系网络）
- [ ] 自适应学习（根据反馈调整策略）
- [ ] 记忆市场（共享优质记忆）

---

## 十二、总结

本方案基于**决策点驱动**的理念，将记忆系统从被动存储升级为主动影响决策的智能系统。通过三大核心功能（决策点记忆、身份记忆、做梦机制），实现了：

1. **智能化**：LLM驱动的记忆检索和整理，无硬编码规则
2. **自动化**：决策点自动检测、记忆自动注入、后台自动整理
3. **个性化**：身份设定持久化、记忆分级约束、场景化检索
4. **可进化**：做梦机制持续优化记忆质量，越用越聪明

预计总开发时间：**7-9天**，可分阶段上线，逐步验证效果。


---

## 附录A：分批处理机制

### A.1 为什么需要分批处理

当记忆数量达到数千条时，一次性处理会导致：
- **Token超限**：LLM上下文窗口不足
- **耗时过长**：用户感知明显延迟
- **内存占用**：加载大量数据到内存
- **成本过高**：单次LLM调用费用高

### A.2 分批策略

**文件**：`src/memory/DreamAgent.ts`（增强版）

```typescript
export class DreamAgent {
  private readonly BATCH_SIZE = 100;      // 每批处理100条
  private readonly MAX_BATCHES = 10;      // 最多10批（共1000条）
  private readonly BATCH_INTERVAL = 5000; // 批次间隔5秒

  async dream(options: {
    memoryWindow?: number;
    batchSize?: number;
    dryRun?: boolean;
  } = {}): Promise<DreamResult> {
    const batchSize = options.batchSize || this.BATCH_SIZE;
    const memoryWindow = options.memoryWindow || 1000;
    
    logger.info('🌙 开始做梦（分批处理）...');

    // 1. 获取待处理记忆总数
    const totalCount = await this.memoryStore.count({
      deletedAt: null
    });

    logger.info(`📊 共 ${totalCount} 条记忆，将分批处理`);

    // 2. 计算批次数
    const batchCount = Math.min(
      Math.ceil(Math.min(totalCount, memoryWindow) / batchSize),
      this.MAX_BATCHES
    );

    // 3. 分批处理
    const aggregatedResult: DreamResult = {
      distilled: 0,
      compressed: 0,
      deduplicated: 0,
      pruned: 0,
      scored: 0,
      duration: 0
    };

    for (let i = 0; i < batchCount; i++) {
      logger.info(`🌙 处理第 ${i + 1}/${batchCount} 批...`);

      const batchResult = await this.processBatch({
        offset: i * batchSize,
        limit: batchSize,
        dryRun: options.dryRun
      });

      // 聚合结果
      aggregatedResult.distilled += batchResult.distilled;
      aggregatedResult.compressed += batchResult.compressed;
      aggregatedResult.deduplicated += batchResult.deduplicated;
      aggregatedResult.pruned += batchResult.pruned;
      aggregatedResult.scored += batchResult.scored;
      aggregatedResult.duration += batchResult.duration;

      // 批次间隔（避免LLM限流）
      if (i < batchCount - 1) {
        await this.sleep(this.BATCH_INTERVAL);
      }
    }

    logger.info(
      `🌙 做梦完成（${batchCount}批）：` +
      `提炼${aggregatedResult.distilled}条、` +
      `压缩${aggregatedResult.compressed}条、` +
      `去重${aggregatedResult.deduplicated}条、` +
      `淘汰${aggregatedResult.pruned}条、` +
      `评分更新${aggregatedResult.scored}条，` +
      `总耗时${aggregatedResult.duration}ms`
    );

    return aggregatedResult;
  }

  /**
   * 处理单个批次
   */
  private async processBatch(options: {
    offset: number;
    limit: number;
    dryRun?: boolean;
  }): Promise<DreamResult> {
    const startTime = Date.now();

    // 1. 加载本批次记忆
    const memories = await this.memoryStore.search({
      offset: options.offset,
      limit: options.limit,
      orderBy: 'lastUsed DESC, timestamp DESC',  // 优先处理常用的
      deletedAt: null
    });

    if (memories.length === 0) {
      return {
        distilled: 0,
        compressed: 0,
        deduplicated: 0,
        pruned: 0,
        scored: 0,
        duration: Date.now() - startTime
      };
    }

    // 2. 准备上下文（精简版，减少token）
    const context = {
      memories: memories.map(m => ({
        id: m.id,
        content: m.content.substring(0, 200),  // 截断长内容
        type: m.type,
        constraint: m.constraint,
        usageCount: m.usageCount,
        effectiveCount: m.effectiveCount,
        confidence: m.confidence
      })),
      batchInfo: {
        offset: options.offset,
        limit: options.limit,
        total: memories.length
      },
      dryRun: options.dryRun
    };

    // 3. 调用 DreamAgent SubAgent
    const agent = await this.subAgentFactory.create('dream-agent', {
      maxIterations: 20,  // 减少迭代次数
      timeout: 120000     // 2分钟超时
    });

    const agentResult = await agent.run(
      `处理本批次记忆（${options.offset}-${options.offset + options.limit}）：\n\n` +
      `${JSON.stringify(context, null, 2)}\n\n` +
      `任务：提炼、压缩、去重、淘汰、评分\n` +
      `${options.dryRun ? '【试运行】' : ''}`
    );

    // 4. 解析结果
    const result = this.parseDreamResult(agentResult);

    return {
      ...result,
      duration: Date.now() - startTime
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### A.3 优先级策略

不同类型的记忆有不同的处理优先级：

```typescript
/**
 * 按优先级排序记忆
 */
private async loadMemoriesWithPriority(
  limit: number
): Promise<MemoryEntry[]> {
  // 优先级规则：
  // 1. 高频使用但低有效率 → 需要优化
  // 2. 长时间未使用 → 可能淘汰
  // 3. 内容冗长 → 需要压缩
  // 4. 相似度高 → 可能去重

  const memories = await this.memoryStore.query(`
    SELECT *,
      -- 计算优先级分数
      CASE
        WHEN usageCount > 10 AND (effectiveCount * 1.0 / usageCount) < 0.3
          THEN 100  -- 高频低效，优先优化
        WHEN lastUsed < ? 
          THEN 90   -- 长期未用，考虑淘汰
        WHEN length(content) > 500
          THEN 80   -- 内容冗长，需要压缩
        ELSE 50     -- 普通记忆
      END as priority
    FROM memories
    WHERE deletedAt IS NULL
    ORDER BY priority DESC, lastUsed DESC
    LIMIT ?
  `, [Date.now() - 90 * 24 * 3600 * 1000, limit]);

  return memories;
}
```

### A.4 增量处理

避免重复处理已优化的记忆：

```typescript
export interface MemoryEntry {
  // ... 现有字段
  
  // 新增：做梦处理记录
  lastDreamed?: number;      // 最后做梦处理时间
  dreamCount: number;        // 被做梦处理次数
  dreamVersion: number;      // 做梦版本号（算法升级时重置）
}

// 查询时排除最近已处理的
const memories = await this.memoryStore.search({
  lastDreamed: { $lt: Date.now() - 7 * 24 * 3600 * 1000 },  // 7天前
  limit: batchSize
});
```

### A.5 断点续传

支持做梦中断后继续：

```typescript
export class DreamScheduler {
  private dreamState?: {
    startTime: number;
    currentBatch: number;
    totalBatches: number;
    processedCount: number;
  };

  async executeDream(options?: {
    resume?: boolean;  // 是否恢复上次中断的做梦
  }): Promise<void> {
    // 1. 检查是否有未完成的做梦
    if (options?.resume && this.dreamState) {
      logger.info(`🌙 恢复做梦（从第${this.dreamState.currentBatch}批开始）`);
      
      await this.dreamAgent.dream({
        startBatch: this.dreamState.currentBatch,
        totalBatches: this.dreamState.totalBatches
      });
      
      this.dreamState = undefined;
    } else {
      // 2. 开始新的做梦
      await this.dreamAgent.dream();
    }
  }

  // 保存做梦状态（用于中断恢复）
  private async saveDreamState(state: any): Promise<void> {
    this.dreamState = state;
    // 可选：持久化到文件
    await fs.writeFile(
      path.join(this.configDir, 'dream-state.json'),
      JSON.stringify(state)
    );
  }
}
```

### A.6 性能优化

**并行处理**（谨慎使用，避免LLM限流）：

```typescript
async dreamParallel(options: {
  concurrency?: number;  // 并发数
}): Promise<DreamResult> {
  const concurrency = options.concurrency || 2;
  const batchSize = this.BATCH_SIZE;
  
  // 分批加载
  const batches = await this.prepareBatches(batchSize);
  
  // 并行处理（限制并发数）
  const results: DreamResult[] = [];
  
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    
    const chunkResults = await Promise.all(
      chunk.map(batch => this.processBatch(batch))
    );
    
    results.push(...chunkResults);
    
    // 批次间隔
    if (i + concurrency < batches.length) {
      await this.sleep(this.BATCH_INTERVAL);
    }
  }
  
  // 聚合结果
  return this.aggregateResults(results);
}
```

### A.7 监控和日志

```typescript
// 做梦进度回调
async dream(options: {
  onProgress?: (progress: DreamProgress) => void;
}): Promise<DreamResult> {
  for (let i = 0; i < batchCount; i++) {
    // 处理批次...
    
    // 报告进度
    options.onProgress?.({
      currentBatch: i + 1,
      totalBatches: batchCount,
      processedCount: (i + 1) * batchSize,
      totalCount: totalCount,
      percentage: ((i + 1) / batchCount) * 100,
      currentResult: aggregatedResult
    });
  }
}

// 使用示例
await dreamAgent.dream({
  onProgress: (progress) => {
    logger.info(
      `🌙 进度: ${progress.percentage.toFixed(1)}% ` +
      `(${progress.currentBatch}/${progress.totalBatches})`
    );
  }
});
```

### A.8 配置示例

```typescript
// ~/.xuanji/config.json
{
  "memory": {
    "dream": {
      "enabled": true,
      "batchSize": 100,           // 每批处理数量
      "maxBatches": 10,           // 最多批次数
      "batchInterval": 5000,      // 批次间隔（ms）
      "concurrency": 1,           // 并发数（1=串行）
      "schedule": "0 2 * * *",    // 每天凌晨2点
      "priority": "smart",        // smart/fifo/lifo
      "incremental": true,        // 增量处理
      "resumeOnError": true       // 错误后恢复
    }
  }
}
```

---

## 附录B：大规模记忆优化

### B.1 记忆分层存储

```typescript
// 热记忆（SQLite）：最近使用的1000条
// 温记忆（SQLite）：1-3个月内的5000条
// 冷记忆（文件）：3个月以上的，归档到JSON文件

class TieredMemoryStore {
  async store(entry: MemoryEntry): Promise<void> {
    // 新记忆进入热层
    await this.hotStore.insert(entry);
    
    // 定期降温
    await this.coolDown();
  }
  
  private async coolDown(): Promise<void> {
    // 热→温：30天未使用
    const toWarm = await this.hotStore.query({
      lastUsed: { $lt: Date.now() - 30 * 24 * 3600 * 1000 }
    });
    
    for (const memory of toWarm) {
      await this.warmStore.insert(memory);
      await this.hotStore.delete(memory.id);
    }
    
    // 温→冷：90天未使用
    const toCold = await this.warmStore.query({
      lastUsed: { $lt: Date.now() - 90 * 24 * 3600 * 1000 }
    });
    
    for (const memory of toCold) {
      await this.coldStore.archive(memory);
      await this.warmStore.delete(memory.id);
    }
  }
}
```

### B.2 索引优化

```sql
-- 复合索引（常用查询组合）
CREATE INDEX idx_constraint_scene ON memories(constraint, usageScenarios);
CREATE INDEX idx_used_effective ON memories(lastUsed DESC, effectiveCount DESC);
CREATE INDEX idx_dream_priority ON memories(lastDreamed, usageCount, length(content));

-- 部分索引（只索引活跃记忆）
CREATE INDEX idx_active_memories ON memories(lastUsed DESC) 
WHERE deletedAt IS NULL AND lastUsed > strftime('%s', 'now', '-90 days') * 1000;
```


---

## 附录C：无上限记忆处理

### C.1 设计原则

**记忆处理不应该有数量上限**，系统应该能够处理任意数量的记忆。

### C.2 游标分页处理

**文件**：`src/memory/DreamAgent.ts`（无上限版本）

```typescript
export class DreamAgent {
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_INTERVAL = 5000;

  /**
   * 处理所有记忆（无上限）
   */
  async dream(options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (progress: DreamProgress) => void;
  } = {}): Promise<DreamResult> {
    const batchSize = options.batchSize || this.BATCH_SIZE;
    
    logger.info('🌙 开始做梦（无上限处理）...');

    // 1. 获取待处理记忆总数
    const totalCount = await this.memoryStore.count({
      deletedAt: null,
      // 只处理7天前做过梦的，或从未做过梦的
      $or: [
        { lastDreamed: null },
        { lastDreamed: { $lt: Date.now() - 7 * 24 * 3600 * 1000 } }
      ]
    });

    logger.info(`📊 共 ${totalCount} 条记忆待处理`);

    if (totalCount === 0) {
      logger.info('🌙 没有需要处理的记忆');
      return {
        distilled: 0,
        compressed: 0,
        deduplicated: 0,
        pruned: 0,
        scored: 0,
        duration: 0
      };
    }

    // 2. 计算总批次数
    const totalBatches = Math.ceil(totalCount / batchSize);

    // 3. 使用游标遍历所有记忆
    const aggregatedResult: DreamResult = {
      distilled: 0,
      compressed: 0,
      deduplicated: 0,
      pruned: 0,
      scored: 0,
      duration: 0
    };

    let cursor: string | null = null;
    let batchIndex = 0;

    // 无限循环，直到处理完所有记忆
    while (true) {
      batchIndex++;
      
      logger.info(`🌙 处理第 ${batchIndex}/${totalBatches} 批...`);

      // 4. 获取下一批记忆（使用游标）
      const { memories, nextCursor } = await this.memoryStore.fetchBatch({
        cursor,
        limit: batchSize,
        filter: {
          deletedAt: null,
          $or: [
            { lastDreamed: null },
            { lastDreamed: { $lt: Date.now() - 7 * 24 * 3600 * 1000 } }
          ]
        },
        orderBy: 'priority DESC, lastUsed DESC'
      });

      // 5. 如果没有更多记忆，退出循环
      if (memories.length === 0) {
        logger.info('🌙 所有记忆处理完成');
        break;
      }

      // 6. 处理本批次
      const batchResult = await this.processBatch({
        memories,
        batchIndex,
        totalBatches,
        dryRun: options.dryRun
      });

      // 7. 聚合结果
      aggregatedResult.distilled += batchResult.distilled;
      aggregatedResult.compressed += batchResult.compressed;
      aggregatedResult.deduplicated += batchResult.deduplicated;
      aggregatedResult.pruned += batchResult.pruned;
      aggregatedResult.scored += batchResult.scored;
      aggregatedResult.duration += batchResult.duration;

      // 8. 进度回调
      if (options.onProgress) {
        options.onProgress({
          currentBatch: batchIndex,
          totalBatches,
          processedCount: batchIndex * batchSize,
          totalCount,
          result: aggregatedResult
        });
      }

      // 9. 更新游标
      cursor = nextCursor;

      // 10. 如果没有下一页，退出循环
      if (!nextCursor) {
        logger.info('🌙 已到达最后一批');
        break;
      }

      // 11. 批次间隔
      await this.sleep(this.BATCH_INTERVAL);
    }

    logger.info(
      `🌙 做梦完成（${batchIndex}批，${totalCount}条）：` +
      `提炼${aggregatedResult.distilled}条、` +
      `压缩${aggregatedResult.compressed}条、` +
      `去重${aggregatedResult.deduplicated}条、` +
      `淘汰${aggregatedResult.pruned}条、` +
      `评分更新${aggregatedResult.scored}条，` +
      `总耗时${aggregatedResult.duration}ms`
    );

    return aggregatedResult;
  }

  /**
   * 处理单个批次
   */
  private async processBatch(options: {
    memories: MemoryEntry[];
    batchIndex: number;
    totalBatches: number;
    dryRun?: boolean;
  }): Promise<DreamResult> {
    const startTime = Date.now();

    // 准备上下文
    const context = {
      memories: options.memories.map(m => ({
        id: m.id,
        content: m.content.substring(0, 200),
        type: m.type,
        constraint: m.constraint,
        usageCount: m.usageCount,
        effectiveCount: m.effectiveCount,
        confidence: m.confidence
      })),
      batchInfo: {
        current: options.batchIndex,
        total: options.totalBatches
      },
      dryRun: options.dryRun
    };

    // 调用 DreamAgent SubAgent
    const agent = await this.subAgentFactory.create('dream-agent', {
      maxIterations: 20,
      timeout: 120000
    });

    const agentResult = await agent.run(
      `处理本批次记忆（${options.batchIndex}/${options.totalBatches}）：\n\n` +
      `${JSON.stringify(context, null, 2)}\n\n` +
      `任务：提炼、压缩、去重、淘汰、评分\n` +
      `${options.dryRun ? '【试运行】' : ''}`
    );

    // 解析结果
    const result = this.parseDreamResult(agentResult);

    // 标记本批次记忆已处理
    for (const memory of options.memories) {
      await this.memoryStore.update(memory.id, {
        lastDreamed: Date.now(),
        dreamCount: (memory.dreamCount || 0) + 1
      });
    }

    return {
      ...result,
      duration: Date.now() - startTime
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface DreamProgress {
  currentBatch: number;
  totalBatches: number;
  processedCount: number;
  totalCount: number;
  result: DreamResult;
}
```

### C.3 游标分页实现

**文件**：`src/memory/MemoryStore.ts`

```typescript
export class MemoryStore {
  /**
   * 游标分页获取记忆
   */
  async fetchBatch(options: {
    cursor?: string | null;
    limit: number;
    filter?: any;
    orderBy?: string;
  }): Promise<{ memories: MemoryEntry[]; nextCursor: string | null }> {
    const { cursor, limit, filter, orderBy } = options;

    // 1. 解析游标（游标 = 上一批最后一条记忆的ID）
    const lastId = cursor ? parseInt(cursor, 10) : 0;

    // 2. 构建查询
    let query = 'SELECT * FROM memories WHERE id > ?';
    const params: any[] = [lastId];

    // 3. 添加过滤条件
    if (filter) {
      if (filter.deletedAt === null) {
        query += ' AND deletedAt IS NULL';
      }
      
      if (filter.$or) {
        const orConditions = filter.$or.map((cond: any) => {
          if (cond.lastDreamed === null) {
            return 'lastDreamed IS NULL';
          }
          if (cond.lastDreamed?.$lt) {
            params.push(cond.lastDreamed.$lt);
            return `lastDreamed < ?`;
          }
          return '';
        }).filter(Boolean);
        
        if (orConditions.length > 0) {
          query += ` AND (${orConditions.join(' OR ')})`;
        }
      }
    }

    // 4. 排序
    query += ` ORDER BY ${orderBy || 'id ASC'}`;

    // 5. 限制数量（多取1条用于判断是否有下一页）
    query += ` LIMIT ?`;
    params.push(limit + 1);

    // 6. 执行查询
    const rows = await this.db.all(query, params);

    // 7. 判断是否有下一页
    const hasMore = rows.length > limit;
    const memories = hasMore ? rows.slice(0, limit) : rows;

    // 8. 生成下一个游标
    const nextCursor = hasMore && memories.length > 0
      ? memories[memories.length - 1].id.toString()
      : null;

    return {
      memories: memories.map(row => this.rowToEntry(row)),
      nextCursor
    };
  }

  /**
   * 计算优先级（用于排序）
   */
  async addPriorityColumn(): Promise<void> {
    await this.db.exec(`
      -- 添加虚拟列（计算优先级）
      ALTER TABLE memories ADD COLUMN priority INTEGER GENERATED ALWAYS AS (
        CASE
          WHEN usageCount > 10 AND (effectiveCount * 1.0 / usageCount) < 0.3
            THEN 100
          WHEN lastUsed < (strftime('%s', 'now') - 90 * 24 * 3600) * 1000
            THEN 90
          WHEN length(content) > 500
            THEN 80
          ELSE 50
        END
      ) VIRTUAL;

      -- 为优先级创建索引
      CREATE INDEX idx_priority ON memories(priority DESC, id ASC);
    `);
  }
}
```

### C.4 流式进度显示

**文件**：`src/adapters/cli/commands/DreamCommand.ts`

```typescript
export class DreamCommand {
  name = '/dream';
  description = '手动触发记忆整理（做梦）';

  async execute(args: string[]) {
    const dryRun = args.includes('--dry-run');

    console.log('🌙 开始做梦...\n');

    // 进度条
    let progressBar: any;

    const result = await dreamScheduler.executeDream({
      dryRun,
      onProgress: (progress) => {
        // 初始化进度条
        if (!progressBar) {
          progressBar = new ProgressBar(
            '处理中 [:bar] :percent :current/:total 批 | ' +
            '提炼:distilled 压缩:compressed 去重:deduplicated 淘汰:pruned',
            {
              total: progress.totalBatches,
              width: 40
            }
          );
        }

        // 更新进度
        progressBar.tick({
          distilled: progress.result.distilled,
          compressed: progress.result.compressed,
          deduplicated: progress.result.deduplicated,
          pruned: progress.result.pruned
        });
      }
    });

    console.log('\n🌙 做梦完成:');
    console.log(`  - 提炼: ${result.distilled} 条`);
    console.log(`  - 压缩: ${result.compressed} 条`);
    console.log(`  - 去重: ${result.deduplicated} 条`);
    console.log(`  - 淘汰: ${result.pruned} 条`);
    console.log(`  - 评分更新: ${result.scored} 条`);
    console.log(`  - 耗时: ${(result.duration / 1000).toFixed(2)}s`);
  }
}
```

### C.5 后台处理优化

对于超大量记忆（10万+），可以采用后台任务队列：

```typescript
export class DreamScheduler {
  /**
   * 启动后台做梦任务
   */
  async startBackgroundDream(): Promise<string> {
    // 创建后台任务
    const taskId = generateId();

    // 异步执行（不阻塞）
    this.executeBackgroundDream(taskId).catch(err => {
      logger.error('后台做梦失败', err);
    });

    return taskId;
  }

  private async executeBackgroundDream(taskId: string): Promise<void> {
    logger.info(`🌙 后台做梦任务启动: ${taskId}`);

    // 低优先级处理（避免影响用户交互）
    await this.dreamAgent.dream({
      batchSize: 50,  // 更小的批次
      onProgress: (progress) => {
        // 保存进度到数据库
        this.saveProgress(taskId, progress);
      }
    });

    logger.info(`🌙 后台做梦任务完成: ${taskId}`);
  }

  /**
   * 查询后台任务进度
   */
  async getTaskProgress(taskId: string): Promise<DreamProgress | null> {
    return await this.loadProgress(taskId);
  }
}
```

### C.6 性能保证

即使处理百万级记忆，也能保证：

- **内存占用**：恒定（每批100条，约100KB）
- **处理时间**：线性增长（每批2分钟，100万条约14天）
- **可中断性**：随时可以停止，下次继续
- **可观测性**：实时进度反馈
- **无数据丢失**：每批处理后立即持久化

### C.7 极限场景

| 记忆数量 | 批次数 | 预计耗时 | 内存占用 |
|---------|-------|---------|---------|
| 1,000 | 10 | 20分钟 | 100KB |
| 10,000 | 100 | 3.3小时 | 100KB |
| 100,000 | 1,000 | 33小时 | 100KB |
| 1,000,000 | 10,000 | 14天 | 100KB |

**结论**：无论记忆数量多少，系统都能稳定处理，只是时间长短的问题。

