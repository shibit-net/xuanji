# LLM驱动的智能记忆系统设计方案

## 设计理念

### 核心原则：为利用而设计，而非为保存而设计

记忆系统的唯一目标：**让AI在未来的任务执行中更智能、更符合用户期望**

- ❌ 不是：尽可能多地保存信息
- ✅ 而是：保存那些能改变未来行为的信息

### 三个关键问题

1. **什么值得记忆？** → 能改变未来决策的信息
2. **如何组织记忆？** → 按使用场景组织，而非按类型分类
3. **如何利用记忆？** → 在决策点主动检索，而非被动加载

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        主Agent执行任务                         │
│                              ↓                                │
│                    遇到决策点 (Decision Point)                 │
│                              ↓                                │
│              ┌───────────────────────────────┐               │
│              │   MemoryRetriever Agent       │               │
│              │   "这个决策需要什么记忆？"      │               │
│              └───────────────┬───────────────┘               │
│                              ↓                                │
│                    检索相关记忆 + 评估适用性                    │
│                              ↓                                │
│                    应用记忆 → 做出更好的决策                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    任务完成后，反思环节
                              ↓
              ┌───────────────────────────────┐
              │   MemoryExtractor Agent       │
              │   "这次执行有什么值得记住？"    │
              └───────────────┬───────────────┘
                              ↓
                    提取可复用的经验/规则/偏好
                              ↓
                    存储到记忆库（带使用场景标签）
```

## 核心组件设计

### 1. 决策点识别（Decision Point Detection）

**什么是决策点？**
- 需要选择技术方案时（"用什么框架？"）
- 需要判断代码风格时（"要不要加注释？"）
- 需要决定交互方式时（"要不要确认？"）
- 需要评估任务范围时（"要不要重构？"）

**如何识别？**
- 主Agent在执行过程中，遇到需要判断的地方，主动调用 `retrieve_memory` 工具
- 工具参数：`decision_context`（当前决策的上下文描述）

### 2. MemoryRetriever Agent - 智能检索

**职责：根据决策上下文，找到最相关的记忆**

**输入：**
```typescript
{
  decisionContext: string,      // "我需要为这个React组件选择状态管理方案"
  currentTask: string,          // 当前任务描述
  projectContext: string,       // 项目上下文摘要
  conversationHistory: Message[] // 最近的对话
}
```

**输出：**
```typescript
{
  relevantMemories: Array<{
    memory: MemoryEntry,
    relevanceScore: number,      // 0-1，相关性评分
    applicability: string,       // "直接适用" | "需要调整" | "仅供参考"
    reasoning: string            // 为什么这条记忆相关
  }>,
  recommendation: string         // 综合建议
}
```

**Prompt设计要点：**
```
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

可用工具：
- memory_search: 语义搜索记忆
- memory_query: 按条件查询记忆
- memory_stats: 查看记忆统计
```

### 3. MemoryExtractor Agent - 智能提取

**职责：从任务执行过程中提取值得记住的经验**

**触发时机：**
- 任务完成后（成功或失败）
- 用户明确要求记住某事
- 发现重要的经验教训

**提取策略（LLM驱动）：**

```
你是一个记忆提取专家。你的任务是：

从刚才的对话中，识别值得记住的信息。

判断标准（按优先级）：

1. 用户明确要求记住的（最高优先级）
   - "记住：我喜欢用 Zustand"
   - "以后都这样做"

2. 用户的隐含偏好（通过行为推断）
   - 用户多次拒绝某种方案 → 记住不要再推荐
   - 用户多次选择某种方案 → 记住优先推荐

3. 项目的约束和规范
   - "这个项目必须用 TypeScript strict mode"
   - "我们的 API 都用 RESTful 风格"

4. 可复用的经验教训
   - 错误 → 解决方案（lesson_learned）
   - 问题 → 最佳实践（reusable_pattern）

5. 重要的事实信息
   - 项目架构、技术栈
   - 用户角色、工作内容

不要记住的：
- 一次性的任务细节（"修改了第123行"）
- 显而易见的常识（"React用JSX"）
- 临时的状态信息（"当前在debug"）
- 纯粹的对话内容（"用户说谢谢"）

提取格式：
{
  content: string,              // 记忆内容（简洁、可复用）
  type: MemoryType,            // 记忆类型
  usageScenario: string[],     // 使用场景标签
  constraint: "must" | "should" | "may",  // 约束级别
  reasoning: string            // 为什么值得记住
}

关键：每条记忆都要回答"这条记忆将如何改变未来的行为？"
```

### 4. 使用场景标签系统（Usage Scenario Tags）

**核心思想：按使用场景组织记忆，而非按类型分类**

**场景标签示例：**
```typescript
const USAGE_SCENARIOS = {
  // 技术决策场景
  "tech_stack_selection": "选择技术栈时",
  "architecture_design": "设计架构时",
  "library_choice": "选择第三方库时",
  
  // 代码风格场景
  "code_style": "编写代码时",
  "naming_convention": "命名时",
  "comment_policy": "决定是否加注释时",
  
  // 交互方式场景
  "user_confirmation": "决定是否需要用户确认时",
  "error_handling": "处理错误时",
  "response_format": "格式化回复时",
  
  // 任务执行场景
  "task_scope": "评估任务范围时",
  "refactoring_decision": "决定是否重构时",
  "testing_strategy": "编写测试时",
  
  // 项目特定场景
  "project_constraints": "项目约束和规范",
  "team_preferences": "团队偏好",
  "deployment_rules": "部署相关规则"
};
```

**记忆存储结构：**
```typescript
interface MemoryEntry {
  id: string;
  content: string;
  
  // 使用场景（核心）
  usageScenarios: string[];     // 这条记忆在哪些场景下有用
  
  // 约束级别
  constraint: "must" | "should" | "may";
  
  // 来源
  origin: "user_explicit" | "user_implicit" | "auto_extracted";
  
  // 适用范围
  scope: "user" | "project" | "task";
  
  // 使用统计
  usageCount: number;           // 被应用的次数
  lastUsed: number;             // 最后使用时间
  effectiveCount: number;       // 有效应用次数（用户没有推翻）
  
  // 元数据
  createdAt: number;
  metadata?: {
    projectPath?: string;       // 项目路径（如果是项目级记忆）
    taskId?: string;            // 任务ID（如果是任务级记忆）
    relatedMemories?: string[]; // 相关记忆ID
  };
}
```

### 5. 记忆应用流程

```typescript
// 主Agent在决策点的伪代码
async function makeDecision(decisionContext: string) {
  // 1. 检索相关记忆
  const retrieval = await retrieveMemory({
    decisionContext,
    currentTask: this.currentTask,
    projectContext: this.projectContext
  });
  
  // 2. 应用记忆
  const mustFollow = retrieval.relevantMemories.filter(m => m.memory.constraint === "must");
  const shouldConsider = retrieval.relevantMemories.filter(m => m.memory.constraint === "should");
  const mayReference = retrieval.relevantMemories.filter(m => m.memory.constraint === "may");
  
  // 3. 构建决策上下文
  const decisionPrompt = `
    当前决策：${decisionContext}
    
    必须遵守的规则：
    ${mustFollow.map(m => `- ${m.memory.content}`).join('\n')}
    
    应该考虑的偏好：
    ${shouldConsider.map(m => `- ${m.memory.content}`).join('\n')}
    
    可以参考的经验：
    ${mayReference.map(m => `- ${m.memory.content}`).join('\n')}
    
    综合建议：${retrieval.recommendation}
  `;
  
  // 4. 做出决策
  const decision = await this.llm.generate(decisionPrompt);
  
  // 5. 记录使用
  await this.recordMemoryUsage(retrieval.relevantMemories.map(m => m.memory.id));
  
  return decision;
}
```

## 工具设计

### 主Agent可用工具

```typescript
// 检索记忆（在决策点调用）
{
  name: "retrieve_memory",
  description: "在需要做决策时，检索相关的记忆（经验/规则/偏好）",
  parameters: {
    decisionContext: "当前决策的描述，例如：'我需要选择状态管理方案'",
    scenarios: "相关的使用场景标签（可选）"
  }
}

// 记录记忆（用户明确要求时）
{
  name: "store_memory",
  description: "当用户明确要求记住某事时使用",
  parameters: {
    content: "要记住的内容",
    constraint: "must | should | may",
    scenarios: "适用场景"
  }
}
```

### MemoryRetriever Agent工具

```typescript
// 语义搜索
{
  name: "memory_search",
  description: "基于语义相似度搜索记忆",
  parameters: {
    query: "搜索查询",
    scenarios: "限定场景（可选）",
    limit: "返回数量"
  }
}

// 场景查询
{
  name: "memory_query_by_scenario",
  description: "查询特定场景下的所有记忆",
  parameters: {
    scenarios: "场景标签列表",
    constraint: "约束级别过滤（可选）"
  }
}

// 评估适用性
{
  name: "evaluate_memory_applicability",
  description: "评估一条记忆对当前决策的适用性",
  parameters: {
    memoryId: "记忆ID",
    decisionContext: "决策上下文"
  }
}
```

### MemoryExtractor Agent工具

```typescript
// 分析对话
{
  name: "analyze_conversation",
  description: "分析对话，识别潜在的记忆点",
  parameters: {
    conversationHistory: "对话历史"
  }
}

// 创建记忆
{
  name: "create_memory",
  description: "创建一条新记忆",
  parameters: {
    content: "记忆内容",
    usageScenarios: "使用场景标签",
    constraint: "约束级别",
    origin: "来源",
    scope: "适用范围",
    reasoning: "为什么值得记住"
  }
}

// 关联记忆
{
  name: "relate_memories",
  description: "建立记忆之间的关联",
  parameters: {
    memoryId: "记忆ID",
    relatedMemoryIds: "相关记忆ID列表",
    relationType: "关联类型（补充/冲突/替代）"
  }
}
```

## 反馈循环设计

### 记忆使用反馈

```typescript
interface MemoryUsageFeedback {
  memoryId: string;
  usedAt: number;
  decisionContext: string;
  wasEffective: boolean;        // 用户是否接受了基于这条记忆的决策
  userFeedback?: string;        // 用户的反馈（如果有）
}
```

**反馈收集方式：**
1. 隐式反馈：用户接受建议 → 有效，用户拒绝 → 无效
2. 显式反馈：用户明确说"这个建议很好"或"不要这样"

**反馈应用：**
- 有效次数多的记忆 → 提高权重
- 无效次数多的记忆 → 降低权重或标记为过时
- 用户明确否定的记忆 → 立即标记为obsolete

### 自适应优化

MemoryRefiner Agent定期分析使用反馈：
- 识别从未被使用的记忆 → 可能不够有用
- 识别经常被使用但效果不好的记忆 → 需要改进
- 识别相似但效果不同的记忆 → 分析差异，提炼规律

## 实现路径

### Phase 1: 核心框架（1-2天）

1. **设计使用场景标签系统**
   - 定义常用场景标签
   - 扩展MemoryEntry数据结构
   - 数据库迁移

2. **实现MemoryRetriever Agent**
   - 创建agent配置
   - 实现检索工具
   - 设计Prompt

3. **集成到主Agent**
   - 添加 `retrieve_memory` 工具
   - 在关键决策点调用

### Phase 2: 智能提取（2-3天）

1. **重构MemoryExtractor**
   - 改为LLM驱动的提取逻辑
   - 实现场景标签自动推断
   - 实现约束级别自动判断

2. **实现反馈收集**
   - 记录记忆使用情况
   - 收集有效性反馈

### Phase 3: 优化迭代（持续）

1. **分析使用数据**
   - 哪些记忆最常用
   - 哪些记忆最有效
   - 哪些场景缺少记忆

2. **优化Prompt**
   - 根据实际效果调整提取策略
   - 优化检索相关性判断

3. **扩展场景标签**
   - 根据实际使用补充新场景

## 关键指标

### 记忆质量指标
- **使用率**：被检索并应用的记忆占比
- **有效率**：应用后用户接受的占比
- **覆盖率**：有记忆支持的决策占比

### 系统效果指标
- **决策质量**：用户对AI决策的满意度
- **一致性**：相似场景下的决策一致性
- **学习速度**：新偏好被记住并应用的速度

## 与现有系统的对比

### 旧系统（硬编码分类）
```
对话 → 提取所有"可能有用"的信息 → 按类型分类存储 → 被动加载到上下文
```
问题：
- 记忆太多，噪音大
- 分类不准确
- 不知道何时使用哪条记忆

### 新系统（LLM驱动，按需检索）
```
对话 → 识别值得记住的经验 → 按使用场景存储 → 决策点主动检索 → 应用记忆
```
优势：
- 记忆精准，都是可复用的
- 按场景组织，检索准确
- 主动检索，按需使用

## 总结

这个设计的核心思想：

1. **为利用而设计**：每条记忆都要能改变未来的行为
2. **LLM驱动决策**：所有"是否记忆"、"如何分类"、"如何检索"都由LLM判断
3. **按场景组织**：不是按类型分类，而是按使用场景标签
4. **主动检索**：在决策点主动检索，而非被动加载
5. **反馈优化**：通过使用反馈持续优化记忆质量

这样的系统才能真正做到"智能记忆"，而不是"机械存储"。
