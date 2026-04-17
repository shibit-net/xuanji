# Xuanji 记忆系统升级方案

## 一、现状分析

### 当前系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     当前记忆系统                              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  MemoryStore (SQLite)                                        │
│  ├── 存储：MemoryEntry (type, content, keywords, M5字段)     │
│  ├── 检索：FTS5全文检索 + 向量搜索                            │
│  └── 维护：MemoryCompactor + MemoryRefiner                   │
│                                                               │
│  MemoryFlushAgent                                            │
│  ├── 会话结束时提取记忆                                       │
│  ├── 使用 memory-extractor SubAgent                          │
│  └── 提取：memories + lessons + patterns                     │
│                                                               │
│  工具层                                                       │
│  ├── MemoryStoreTool：主动存储记忆                            │
│  ├── RetrieveMemoryTool：检索记忆                             │
│  ├── MemorySearchTool：搜索记忆                               │
│  └── builtin/：MemoryQuery/Stats/Merge/Upgrade               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 现有优势

1. **完整的存储层**：SQLite + FTS5 + 向量搜索
2. **M5 字段支持**：scope, volatility, significance, categoryLabel
3. **自动维护**：定期压缩、提炼、升级
4. **SubAgent 架构**：memory-extractor 专门提取记忆
5. **工具系统**：LLM 可主动存储和检索记忆

### 现有问题

1. **被动检索**：只在 SubAgent 中使用 RetrieveMemoryTool，主 Agent 不主动检索
2. **缺少场景标签**：按 type 分类，不按使用场景组织
3. **缺少约束级别**：没有 must/should/may 区分
4. **缺少反馈循环**：不记录记忆的使用效果
5. **提取时机单一**：只在会话结束时提取，不在决策点提取
6. **缺少智能检索 Agent**：RetrieveMemoryTool 只是简单搜索，没有语义理解

## 二、升级目标

### 核心目标

**让记忆系统从"被动存储"变为"主动决策支持"**

### 具体目标

1. **决策驱动**：主 Agent 在决策点主动检索记忆
2. **场景组织**：按使用场景标签组织记忆
3. **智能检索**：MemoryRetriever Agent 理解语义，评估适用性
4. **约束分级**：must/should/may 三级约束
5. **反馈优化**：记录使用效果，淘汰无效记忆
6. **全场景支持**：编码、生活、工作、人际关系等

## 三、升级方案

### Phase 1：核心功能（2-3天）

#### 1.1 扩展 MemoryEntry 数据结构

**文件**：`src/memory/types.ts`

```typescript
export interface MemoryEntry {
  // ... 现有字段 ...
  
  // 新增：使用场景标签（核心）
  usageScenarios?: string[];  // ["tech_stack_selection", "code_style"]
  
  // 新增：约束级别
  constraint?: 'must' | 'should' | 'may';
  
  // 新增：使用统计
  usageCount?: number;        // 被应用的次数
  lastUsed?: number;          // 最后使用时间戳
  effectiveCount?: number;    // 有效应用次数（用户接受）
  
  // 新增：来源标记
  origin?: 'user_explicit' | 'user_implicit' | 'auto_extracted';
  
  // 新增：关联记忆
  relatedMemories?: string[]; // 相关记忆的 ID
}
```

**迁移脚本**：`scripts/migrate-usage-scenarios.mjs`

```javascript
// 为现有记忆推断场景标签和约束级别
// 基于 type 和 content 的启发式规则
```

#### 1.2 创建 MemoryRetriever Agent

**文件**：`src/core/agent/builtin/memory-retriever.json5`

```json5
{
  id: "memory-retriever",
  name: "Memory Retriever",
  description: "智能记忆检索 Agent，根据决策上下文找到最相关的记忆",
  model: "sonnet",
  thinking: false,
  tools: [
    "memory_search",
    "memory_query",
    "memory_stats"
  ],
  systemPromptSuffix: `
你是一个记忆检索专家。你的任务是：

1. 理解当前决策的本质
2. 从记忆库中找到相关的经验/规则/偏好
3. 评估每条记忆的适用性
4. 给出综合建议

关键原则：
- 只返回真正相关的记忆（宁缺毋滥）
- 区分"必须遵守的规则"和"可参考的经验"
- 如果记忆之间有冲突，指出并建议如何处理
- 如果没有相关记忆，明确说明

输出格式：
{
  "relevantMemories": [
    {
      "memoryId": "mem_xxx",
      "content": "...",
      "relevanceScore": 0.95,
      "applicability": "直接适用" | "需要调整" | "仅供参考",
      "reasoning": "为什么这条记忆相关"
    }
  ],
  "recommendation": "综合建议"
}
`
}
```

#### 1.3 重构 RetrieveMemoryTool

**文件**：`src/core/tools/RetrieveMemoryTool.ts`

```typescript
/**
 * RetrieveMemoryTool — 智能记忆检索（调用 MemoryRetriever Agent）
 */
export class RetrieveMemoryTool extends BaseTool {
  readonly name = 'retrieve_memory';
  readonly description = `
Retrieve relevant memories for the current decision point.

**When to use**:
- Before making a technical choice (framework, library, architecture)
- Before deciding code style (comments, naming, structure)
- Before responding to user (tone, format, confirmation)
- Before planning task scope (refactor, test coverage)
- When user references past work ("like last time", "my usual style")

**Decision Context Examples**:
- "选择 React 状态管理方案"
- "决定是否为代码添加注释"
- "评估是否需要用户确认"
- "回应用户的社交邀请"
- "安排会议时间"

**Returns**: Relevant memories with applicability assessment and recommendation.
`;

  readonly input_schema = {
    type: 'object',
    properties: {
      decisionContext: {
        type: 'string',
        description: '当前决策的上下文描述（具体、清晰）'
      },
      currentTask: {
        type: 'string',
        description: '当前任务描述（可选）'
      }
    },
    required: ['decisionContext']
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const { decisionContext, currentTask } = input;
    
    // 调用 MemoryRetriever Agent
    const retriever = await this.subAgentFactory.create('memory-retriever', {
      maxIterations: 3,
      timeout: 10000
    });
    
    const prompt = `
决策上下文：${decisionContext}
当前任务：${currentTask || '无'}

请检索相关记忆并评估适用性。
`;
    
    const result = await retriever.run(prompt);
    
    // 解析结果
    const parsed = this.parseRetrieverOutput(result);
    
    // 更新记忆使用统计
    for (const mem of parsed.relevantMemories) {
      await this.memoryStore.incrementUsage(mem.memoryId);
    }
    
    return {
      content: this.formatResult(parsed),
      isError: false
    };
  }
}
```

#### 1.4 升级 MemoryExtractor

**文件**：`src/memory/MemoryFlushAgent.ts`

在 Prompt 中添加场景标签和约束级别的提取：

```typescript
const EXTRACTION_PROMPT = `
分析对话，提取值得记忆的信息。

对每条记忆，必须回答：
1. **这条记忆将如何改变未来的行为？**
2. **在什么场景下会用到这条记忆？**（使用场景标签）
3. **这是必须遵守的规则，还是应该考虑的偏好，还是可以参考的建议？**（约束级别）

使用场景标签示例：
- 技术决策：tech_stack_selection, library_choice, architecture_design
- 代码风格：code_style, naming_convention, comment_policy
- 交互方式：user_confirmation, error_handling, response_format
- 任务执行：task_scope, refactoring_decision, testing_strategy
- 生活场景：social_invitation_response, meeting_scheduling, purchase_decision
- 人际关系：relationship_management, birthday_reminder, gift_suggestion

约束级别：
- must：必须遵守的规则（项目约束、用户底线）
- should：应该考虑的偏好（用户习惯、团队规范）
- may：可以参考的建议（经验教训、最佳实践）

输出格式：
{
  "memories": [
    {
      "content": "...",
      "type": "...",
      "usageScenarios": ["scenario1", "scenario2"],
      "constraint": "must" | "should" | "may",
      "origin": "user_explicit" | "user_implicit" | "auto_extracted",
      "reasoning": "为什么值得记住，将如何改变未来行为"
    }
  ]
}
`;
```

#### 1.5 数据库迁移

**文件**：`src/memory/MemoryStore.ts`

```typescript
// 添加新字段
private createTables(): void {
  this.db!.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      -- ... 现有字段 ...
      
      -- 新增字段
      usage_scenarios TEXT,      -- JSON 数组：["scenario1", "scenario2"]
      constraint TEXT,           -- must/should/may
      usage_count INTEGER DEFAULT 0,
      last_used INTEGER,
      effective_count INTEGER DEFAULT 0,
      origin TEXT,               -- user_explicit/user_implicit/auto_extracted
      related_memories TEXT      -- JSON 数组：["mem_id1", "mem_id2"]
    );
    
    -- 新增索引
    CREATE INDEX IF NOT EXISTS idx_mem_usage_scenarios ON memories(usage_scenarios);
    CREATE INDEX IF NOT EXISTS idx_mem_constraint ON memories(constraint);
    CREATE INDEX IF NOT EXISTS idx_mem_usage_count ON memories(usage_count DESC);
  `);
}

// 新增方法
incrementUsage(memoryId: string, effective: boolean = true): void {
  this.ensureReady();
  this.db!.prepare(`
    UPDATE memories 
    SET usage_count = usage_count + 1,
        last_used = ?,
        effective_count = effective_count + ?
    WHERE id = ?
  `).run(Date.now(), effective ? 1 : 0, memoryId);
}

// 按场景查询
queryByScenario(scenario: string, limit: number = 10): MemoryEntry[] {
  this.ensureReady();
  const rows = this.db!.prepare(`
    SELECT * FROM memories
    WHERE usage_scenarios LIKE ?
      AND obsolete = 0
    ORDER BY 
      CASE constraint
        WHEN 'must' THEN 3
        WHEN 'should' THEN 2
        WHEN 'may' THEN 1
        ELSE 0
      END DESC,
      usage_count DESC,
      created_at DESC
    LIMIT ?
  `).all(`%"${scenario}"%`, limit);
  
  return rows.map(this.rowToEntry);
}
```

### Phase 2：集成到主 Agent（1-2天）

#### 2.1 在 AgentLoop 中集成决策点检索

**文件**：`src/core/agent/AgentLoop.ts`

```typescript
export class AgentLoop {
  // ... 现有代码 ...
  
  /**
   * 在决策点检索记忆（可选，由 LLM 主动调用）
   * 
   * 不强制在每个决策点都检索，而是让 LLM 自己判断是否需要
   */
  private async handleToolCall(toolCall: ToolCall): Promise<void> {
    // 现有的工具调用逻辑
    // ...
    
    // retrieve_memory 工具已经在 ToolRegistry 中注册
    // LLM 可以主动调用
  }
}
```

#### 2.2 在 System Prompt 中引导使用

**文件**：`src/core/prompt/components/l2-agent-rules.ts`

```typescript
export const l2AgentRules: PromptComponent = {
  id: 'l2-agent-rules',
  layer: 2,
  content: `
# 记忆系统使用指南

## 何时检索记忆

在以下决策点，考虑使用 retrieve_memory 工具：

1. **技术选择**：选择框架、库、架构方案时
2. **代码风格**：决定命名、注释、结构时
3. **交互方式**：决定是否确认、如何回复时
4. **任务范围**：评估是否重构、测试覆盖时
5. **用户引用**：用户说"像上次那样"、"我通常"时

## 如何使用

\`\`\`typescript
// 示例1：技术选择
await retrieve_memory({
  decisionContext: "为 React 组件选择状态管理方案",
  currentTask: "实现用户列表页面"
});

// 示例2：代码风格
await retrieve_memory({
  decisionContext: "决定是否为这段代码添加注释",
  currentTask: "实现数据处理函数"
});

// 示例3：生活场景
await retrieve_memory({
  decisionContext: "用户收到老王的饭局邀请，需要决定如何回应",
  currentTask: "处理社交邀请"
});
\`\`\`

## 应用记忆

检索到的记忆会标注约束级别：
- **must**：必须遵守，无条件执行
- **should**：应该考虑，优先采用（除非有特殊原因）
- **may**：可以参考，作为建议

如果记忆之间有冲突，优先级：must > should > may
`,
  condition: (ctx) => ctx.complexity === 'complex'
};
```

### Phase 3：反馈循环（1-2天）

#### 3.1 记录记忆使用效果

**文件**：`src/core/agent/AgentLoop.ts`

```typescript
/**
 * 在用户回复后，判断记忆是否有效
 */
private async evaluateMemoryEffectiveness(
  appliedMemories: string[],
  userResponse: Message
): Promise<void> {
  // 简单启发式规则
  const isPositive = this.isPositiveResponse(userResponse.content);
  
  for (const memId of appliedMemories) {
    await this.memoryStore.incrementUsage(memId, isPositive);
  }
  
  // 如果用户明确推翻了建议，降低记忆的有效性
  if (this.isRejection(userResponse.content)) {
    // 可以考虑降低 constraint 级别或标记为需要审查
  }
}

private isPositiveResponse(content: string): boolean {
  const positive = ['好的', '可以', '对', '是的', '没问题', 'ok', 'yes', 'sure'];
  const negative = ['不', '别', '不要', '不用', 'no', "don't"];
  
  const hasPositive = positive.some(w => content.includes(w));
  const hasNegative = negative.some(w => content.includes(w));
  
  return hasPositive && !hasNegative;
}
```

#### 3.2 定期评估和淘汰

**文件**：`src/memory/MemoryRefiner.ts`

```typescript
/**
 * 评估记忆有效性，淘汰无效记忆
 */
async evaluateEffectiveness(): Promise<number> {
  const memories = this.store.query({
    minUsageCount: 5,  // 至少被使用过 5 次
    includeObsolete: false
  });
  
  let obsoleted = 0;
  
  for (const mem of memories) {
    const effectiveRate = mem.effectiveCount / mem.usageCount;
    
    // 有效率低于 30%，标记为过时
    if (effectiveRate < 0.3) {
      this.store.markObsolete(mem.id, `低有效率: ${(effectiveRate * 100).toFixed(1)}%`);
      obsoleted++;
      log.info(`Obsoleted memory ${mem.id}: effective rate ${(effectiveRate * 100).toFixed(1)}%`);
    }
    
    // 有效率低于 50%，降级约束
    else if (effectiveRate < 0.5 && mem.constraint === 'must') {
      this.store.update(mem.id, { constraint: 'should' });
      log.info(`Downgraded memory ${mem.id} from must to should`);
    }
  }
  
  return obsoleted;
}
```

### Phase 4：优化体验（1-2天）

#### 4.1 场景标签自动发现

**文件**：`src/memory/ScenarioDiscovery.ts`

```typescript
/**
 * 场景标签自动发现
 * 
 * 分析记忆的使用模式，自动发现新的场景标签
 */
export class ScenarioDiscovery {
  async discoverScenarios(): Promise<string[]> {
    // 1. 收集所有现有的场景标签
    const existingScenarios = await this.collectExistingScenarios();
    
    // 2. 分析记忆的共现模式
    const cooccurrence = await this.analyzeCooccurrence();
    
    // 3. 使用 LLM 识别新场景
    const newScenarios = await this.llmDiscovery(cooccurrence);
    
    return newScenarios;
  }
}
```

#### 4.2 记忆关联分析

**文件**：`src/memory/MemoryRelationship.ts`

```typescript
/**
 * 记忆关联分析
 * 
 * 发现记忆之间的关联关系
 */
export class MemoryRelationship {
  async buildRelationships(): Promise<void> {
    const memories = this.store.queryAll();
    
    for (const mem of memories) {
      // 1. 找到语义相似的记忆
      const similar = await this.findSimilar(mem);
      
      // 2. 找到互补的记忆（一起使用的）
      const complementary = await this.findComplementary(mem);
      
      // 3. 找到冲突的记忆
      const conflicting = await this.findConflicting(mem);
      
      // 4. 更新关联
      await this.store.update(mem.id, {
        relatedMemories: [
          ...similar.map(m => m.id),
          ...complementary.map(m => m.id)
        ]
      });
    }
  }
}
```

## 四、实现优先级

### P0（必须实现）

1. ✅ 扩展 MemoryEntry 数据结构（usageScenarios, constraint, usage统计）
2. ✅ 数据库迁移脚本
3. ✅ 创建 MemoryRetriever Agent
4. ✅ 重构 RetrieveMemoryTool（调用 MemoryRetriever）
5. ✅ 升级 MemoryExtractor（提取场景标签和约束级别）
6. ✅ 在 System Prompt 中引导使用

### P1（重要）

7. ⏳ 记录记忆使用效果
8. ⏳ 定期评估和淘汰无效记忆
9. ⏳ 按场景查询优化

### P2（优化）

10. ⏳ 场景标签自动发现
11. ⏳ 记忆关联分析
12. ⏳ 可视化记忆网络

## 五、测试验证

### 测试场景1：编码场景

```typescript
// 用户对话
用户："帮我写个 React 组件"
AI：检索记忆 → 发现"用户偏好函数式组件" → 用函数式组件

用户："用 Zustand 管理状态"
AI：存储记忆 → usageScenarios: ["state_management_choice"]

// 下次
用户："再写个组件，需要状态管理"
AI：检索记忆 → 发现"用户喜欢 Zustand" → 推荐 Zustand
```

### 测试场景2：生活场景

```typescript
// 用户对话
用户："我妈妈生日是 4月18日"
AI：存储记忆 → usageScenarios: ["birthday_reminder", "gift_suggestion"]

用户："老王又约我吃饭"
AI：检索记忆 → 发现"用户通常不想去老王的饭局" → 建议拒绝但提醒维持关系

用户："帮我安排下周日程"
AI：检索记忆 → 发现"周三晚上健身" → 保留健身时间
```

### 测试场景3：反馈循环

```typescript
// 第一次
AI：检索记忆 → "用户喜欢 Redux" → 推荐 Redux
用户："不，这次用 Zustand"
→ 记录：effectiveCount 不增加

// 第二次
AI：检索记忆 → "用户喜欢 Redux" → 推荐 Redux
用户："还是用 Zustand 吧"
→ 记录：effectiveCount 不增加

// 第三次
AI：检索记忆 → "用户喜欢 Redux" → 推荐 Redux
用户："我现在更喜欢 Zustand 了"
→ 系统判断：这条记忆有效率低，标记为过时
→ 提取新记忆："用户现在偏好 Zustand"
```

## 六、兼容性

### 向后兼容

- 新字段都是可选的，现有记忆不受影响
- 现有工具继续工作
- 逐步迁移，不强制

### 渐进式升级

1. **Phase 1**：新记忆使用新字段，旧记忆保持不变
2. **Phase 2**：后台任务逐步为旧记忆推断场景标签
3. **Phase 3**：完全迁移后，启用新功能

## 七、性能考虑

### 查询优化

- 场景标签索引：`idx_mem_usage_scenarios`
- 约束级别索引：`idx_mem_constraint`
- 使用频率索引：`idx_mem_usage_count`

### 缓存策略

- 高频场景的记忆缓存在内存
- LRU 淘汰策略
- 定期刷新

### 批量处理

- 记忆使用统计批量更新
- 定期评估，不实时

## 八、总结

这个升级方案的核心思想：

1. **最小侵入**：基于现有系统，扩展而非重写
2. **渐进式**：分阶段实施，每个阶段都可独立验证
3. **向后兼容**：不破坏现有功能
4. **LLM 驱动**：所有决策由 LLM 做出，不硬编码规则
5. **场景优先**：按使用场景组织，而非按类型分类
6. **反馈优化**：通过使用反馈持续改进

预计总工时：**5-8 天**
- Phase 1（核心）：2-3 天
- Phase 2（集成）：1-2 天
- Phase 3（反馈）：1-2 天
- Phase 4（优化）：1-2 天
