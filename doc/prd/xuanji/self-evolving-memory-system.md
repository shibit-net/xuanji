# 自我进化的记忆系统：经验学习与技能自动生成

## 设计日期
2026-03-16

## 核心理念

> **记忆不仅是存储，更是进化的引擎**

将记忆系统从"被动存储"升级为"主动学习引擎"，使 xuanji 能够：
1. **自我学习**：从每次对话和任务中提取经验
2. **总结教训**：记录成功模式和失败案例
3. **自我完善**：基于经验优化决策和工具使用
4. **自动进化**：发现重复模式并生成新 Skill
5. **能力追踪**：记录能力提升的时间线

---

## 设计层次

### L1: 基础记忆（已实现）
- 用户偏好、项目知识、对话历史
- 向量检索 + 遗忘曲线

### L2: 经验学习（本文档）
- **Lessons Learned**：成功/失败的任务模式
- **Solution Library**：问题 → 解决方案映射
- **Anti-Patterns**：应避免的错误模式

### L3: 技能发现（本文档）
- **Pattern Detection**：自动识别重复任务
- **Skill Extraction**：从经验中提取可执行 Skill
- **Skill Evolution**：持续优化 Skill 性能

### L4: 自我进化（本文档）
- **Capability Tracking**：记录能力演化曲线
- **Meta-Learning**：学习如何更好地学习
- **Prompt Self-Optimization**：自动优化 System Prompt

---

## 核心组件

### 1. Lessons Learned（经验教训系统）

#### 数据结构

```typescript
interface Lesson {
  id: string;
  type: 'success' | 'failure' | 'insight';
  category: 'tool-usage' | 'decision-making' | 'user-interaction' | 'code-generation';

  // 场景
  context: {
    userIntent: string;
    initialApproach: string;
    tools: string[];
    environment?: Record<string, any>;
  };

  // 执行
  execution: {
    steps: Array<{
      action: string;
      tool?: string;
      result: 'success' | 'failure';
      reasoning?: string;
    }>;
    outcome: 'success' | 'failure' | 'partial';
    duration: number;
    tokensUsed: number;
  };

  // 学习
  learning: {
    whatWorked: string[];      // 成功的部分
    whatFailed: string[];       // 失败的部分
    rootCause?: string;         // 失败根因
    solution?: string;          // 解决方案
    betterApproach?: string;    // 更优方案
  };

  // 应用
  application: {
    pattern: string;            // 适用场景模式（正则）
    confidence: number;         // 置信度
    applicableWhen: string[];   // 适用条件
    avoidWhen?: string[];       // 应避免的条件
  };

  metadata: {
    createdAt: number;
    appliedCount: number;       // 被应用次数
    successRate: number;        // 应用成功率
    lastApplied?: number;
    userFeedback?: 'positive' | 'negative' | 'neutral';
  };
}
```

#### Markdown 文件格式

```markdown
# lessons/2026-03-16-edit-tool-line-numbers.md

## 问题
用户抱怨 Edit 工具的 diff 输出没有行号，难以定位代码位置。

## 初始方案
直接在 DiffRenderer 中添加行号，但遇到两个问题：
1. 固定 `color='white'` 覆盖了 ANSI 颜色码
2. 两列行号格式（旧行号 | 新行号）视觉混乱

## 失败尝试
- ❌ 两列行号：视觉噪音太大
- ❌ color='white'：覆盖了语义颜色

## 最终方案
✓ 单列行号（删除行显示旧行号，其他显示新行号）
✓ color={undefined} 保留 ANSI 颜色码

## 关键洞察
**Ink 组件的 color 属性会覆盖 ANSI 颜色码**。如果内容本身包含 ANSI 转义序列，应使用 `color={undefined}` 而非 `color='white'`。

## 适用场景
- 任何使用 Ink 渲染 ANSI 颜色字符串的场景
- 需要保留终端语义颜色的输出

## 元数据
- Type: success
- Category: tool-usage, ui-design
- Confidence: high
- Applied: 1 次
- Success Rate: 100%
- Tags: #ink #ansi-colors #diff-rendering
```

#### 自动生成机制

```typescript
export class LessonExtractor {
  /**
   * 从任务执行结果中提取经验教训
   */
  async extractLesson(task: {
    userMessage: string;
    agentSteps: Array<{ tool: string; input: any; output: any; success: boolean }>;
    finalOutcome: 'success' | 'failure';
    userFeedback?: string;
  }): Promise<Lesson | null> {
    // 1. 识别是否值得学习（避免记录琐碎任务）
    if (!this.isWorthLearning(task)) {
      return null;
    }

    // 2. 分析执行模式
    const pattern = this.analyzePattern(task);

    // 3. 提取成功/失败因素
    const factors = this.extractFactors(task);

    // 4. 生成适用条件
    const application = this.inferApplication(task, pattern);

    // 5. 使用 LLM 生成结构化 Lesson
    const lesson = await this.generateLessonWithLLM({
      task,
      pattern,
      factors,
      application,
    });

    // 6. 保存到 Markdown
    await this.saveAsMarkdown(lesson);

    return lesson;
  }

  /**
   * 判断任务是否值得学习
   */
  private isWorthLearning(task: any): boolean {
    // 多步骤任务
    if (task.agentSteps.length >= 3) return true;

    // 有失败后重试的任务
    if (task.agentSteps.some(s => !s.success)) return true;

    // 用户给予反馈的任务
    if (task.userFeedback) return true;

    // 使用了罕见工具组合
    const tools = task.agentSteps.map(s => s.tool);
    if (this.isRareToolCombination(tools)) return true;

    return false;
  }

  /**
   * 使用 LLM 生成结构化 Lesson
   */
  private async generateLessonWithLLM(context: any): Promise<Lesson> {
    const prompt = `
你是一个 AI 助手的学习系统。请分析以下任务执行记录，提取关键经验教训。

## 任务上下文
${JSON.stringify(context, null, 2)}

## 输出格式
请以 JSON 格式返回：
\`\`\`json
{
  "type": "success | failure | insight",
  "category": "tool-usage | decision-making | user-interaction | code-generation",
  "learning": {
    "whatWorked": ["成功因素1", "成功因素2"],
    "whatFailed": ["失败因素1"],
    "rootCause": "失败根本原因",
    "betterApproach": "更优方案描述"
  },
  "application": {
    "pattern": "适用场景的正则表达式",
    "applicableWhen": ["条件1", "条件2"],
    "avoidWhen": ["应避免的条件"]
  }
}
\`\`\`

## 提取原则
1. 聚焦于**可复用**的模式（避免过度具体）
2. 失败案例要找出**根本原因**（而非表面现象）
3. 成功案例要提炼**关键因素**（而非全部细节）
4. 适用条件要**清晰明确**（便于后续匹配）
    `.trim();

    const response = await this.llmProvider.chat({
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-haiku-4-5',
      temperature: 0.3,
    });

    return this.parseLesson(response);
  }
}
```

---

### 2. Skill Discovery（技能自动发现）

#### 触发条件

```typescript
export class SkillDiscovery {
  /**
   * 检测重复模式，触发 Skill 提取
   */
  async detectPattern(recentTasks: Task[]): Promise<SkillCandidate | null> {
    // 1. 工具序列相似度
    const sequences = recentTasks.map(t => t.agentSteps.map(s => s.tool));
    const similarity = this.calculateSequenceSimilarity(sequences);

    if (similarity < 0.7) {
      return null; // 相似度不足
    }

    // 2. 用户意图相似度（向量检索）
    const intents = recentTasks.map(t => t.userMessage);
    const intentEmbeddings = await Promise.all(
      intents.map(i => this.embeddingService.embed(i))
    );
    const intentSimilarity = this.averageCosineSimilarity(intentEmbeddings);

    if (intentSimilarity < 0.8) {
      return null; // 意图差异较大
    }

    // 3. 提取 Skill 候选
    return {
      name: this.generateSkillName(recentTasks),
      triggerPattern: this.extractTriggerPattern(intents),
      toolSequence: this.extractCommonSequence(sequences),
      examples: recentTasks.slice(0, 3),
      confidence: (similarity + intentSimilarity) / 2,
    };
  }

  /**
   * 计算工具序列相似度（编辑距离）
   */
  private calculateSequenceSimilarity(sequences: string[][]): number {
    if (sequences.length < 2) return 0;

    const distances = [];
    for (let i = 0; i < sequences.length - 1; i++) {
      for (let j = i + 1; j < sequences.length; j++) {
        const dist = this.editDistance(sequences[i], sequences[j]);
        const maxLen = Math.max(sequences[i].length, sequences[j].length);
        distances.push(1 - dist / maxLen);
      }
    }

    return distances.reduce((a, b) => a + b, 0) / distances.length;
  }
}
```

#### Skill 提取和生成

```typescript
export class SkillGenerator {
  /**
   * 从 Skill 候选生成可执行 Skill
   */
  async generateSkill(candidate: SkillCandidate): Promise<GeneratedSkill> {
    const prompt = `
你是一个 Skill 生成专家。请基于以下重复任务模式，生成一个可复用的 Skill。

## 重复模式
- 触发模式：${candidate.triggerPattern}
- 工具序列：${candidate.toolSequence.join(' → ')}
- 示例任务：
${candidate.examples.map(e => `  - 用户: ${e.userMessage}\n    工具: ${e.agentSteps.map(s => s.tool).join(', ')}`).join('\n')}

## 输出格式
请生成一个 Skill 的 JSON5 配置：

\`\`\`json5
{
  id: 'auto-generated-skill-name',
  name: 'Skill 显示名称',
  description: 'Skill 功能描述（1-2 句话）',

  // 触发条件
  trigger: {
    patterns: ['正则1', '正则2'],           // 用户输入匹配模式
    keywords: ['关键词1', '关键词2'],        // 关键词列表
    context: ['条件1', '条件2'],             // 上下文条件（可选）
  },

  // 执行策略
  execution: {
    type: 'sequential',                     // sequential | parallel | conditional
    steps: [
      {
        tool: 'tool_name',
        input: { /* 参数模板 */ },
        reasoning: '为什么使用这个工具',
      },
      // ...
    ],
  },

  // Prompt 增强（可选）
  systemPrompt: \`
  ## 场景：${候选名称}

  当用户请求 XXX 时，你应该：
  1. 步骤 1
  2. 步骤 2
  3. 步骤 3
  \`,

  // 元数据
  metadata: {
    autoGenerated: true,
    generatedFrom: ['task-id-1', 'task-id-2'],
    confidence: ${candidate.confidence},
    requiresReview: true,
  },
}
\`\`\`

## 生成原则
1. **通用性**：触发模式应足够通用，覆盖相似场景
2. **参数化**：工具输入应使用变量（如 \${userInput}, \${fileName}）
3. **可读性**：Prompt 增强应清晰描述执行逻辑
4. **安全性**：避免生成危险操作（删除、格式化等）
    `.trim();

    const response = await this.llmProvider.chat({
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-sonnet-4-6', // 使用更强模型
      temperature: 0.2,
    });

    const skill = this.parseGeneratedSkill(response);

    // 保存到待审核队列
    await this.saveToReviewQueue(skill);

    return skill;
  }
}
```

#### Skill 审核和启用

```markdown
# skills/generated/pending/auto-git-commit.json5

// ⚠️ 自动生成的 Skill，需要人工审核后启用

{
  id: 'auto-git-commit',
  name: 'Git Commit with Conventional Message',
  description: '自动执行 git add、生成 Conventional Commit 消息、提交',

  trigger: {
    patterns: [
      '提交.*代码',
      'commit.*changes',
      '保存.*修改',
    ],
    keywords: ['git', 'commit', '提交'],
  },

  execution: {
    type: 'sequential',
    steps: [
      {
        tool: 'bash',
        input: { command: 'git status' },
        reasoning: '检查工作区状态',
      },
      {
        tool: 'bash',
        input: { command: 'git add ${files}' }, // 参数化
        reasoning: '暂存变更文件',
      },
      {
        tool: 'bash',
        input: {
          command: 'git commit -m "${commitMessage}"', // 由 LLM 生成
        },
        reasoning: '提交变更',
      },
    ],
  },

  systemPrompt: `
## Git Commit 场景

当用户请求提交代码时：
1. 检查 git status，确认有未提交的变更
2. 询问用户要提交哪些文件（或使用 git add -A）
3. 分析变更内容，生成符合 Conventional Commits 规范的消息：
   - feat: 新功能
   - fix: 修复 bug
   - docs: 文档变更
   - refactor: 重构
   - test: 测试相关
4. 执行 git commit
  `,

  metadata: {
    autoGenerated: true,
    generatedFrom: ['task-abc123', 'task-def456', 'task-ghi789'],
    generatedAt: 1710576000000,
    confidence: 0.85,
    requiresReview: true,

    // 审核信息
    reviewStatus: 'pending',        // pending | approved | rejected
    reviewer: null,
    reviewedAt: null,
    reviewNotes: null,
  },
}
```

**审核流程**：
1. Agent 生成 Skill 后保存到 `skills/generated/pending/`
2. 在 CLI/GUI 中显示通知："发现新 Skill 候选，是否审核？"
3. 用户审核界面：
   - 显示 Skill 定义
   - 显示生成来源（3 个示例任务）
   - 提供编辑功能
   - 批准/拒绝/修改
4. 批准后移动到 `skills/generated/approved/`，并自动注册

---

### 3. Self-Optimization（自我优化）

#### Prompt 自动优化

```typescript
export class PromptOptimizer {
  /**
   * 基于失败案例优化 System Prompt
   */
  async optimizePrompt(
    component: PromptComponent,
    failureCases: Lesson[]
  ): Promise<string> {
    const currentPrompt = component.render({} as any);

    const prompt = `
你是一个 Prompt Engineer。请优化以下 System Prompt，使其能够避免已知的失败模式。

## 当前 Prompt
\`\`\`
${currentPrompt}
\`\`\`

## 失败案例
${failureCases.map((lesson, i) => `
### 案例 ${i + 1}
- 场景：${lesson.context.userIntent}
- 失败原因：${lesson.learning.rootCause}
- 应避免：${lesson.learning.whatFailed.join(', ')}
- 更优方案：${lesson.learning.betterApproach}
`).join('\n')}

## 优化要求
1. 在 Prompt 中增加针对性的指导，避免上述失败模式
2. 保持 Prompt 简洁（不超过当前长度的 120%）
3. 使用清晰的示例和反例
4. 保留原有的核心原则

## 输出格式
请直接输出优化后的 Prompt（Markdown 格式），不要其他解释。
    `.trim();

    const response = await this.llmProvider.chat({
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-opus-4-6', // 使用最强模型
      temperature: 0.1,
    });

    return this.extractOptimizedPrompt(response);
  }
}
```

#### 工具使用策略优化

```markdown
# lessons/tool-usage/bash-timeout-pattern.md

## 问题
Agent 在执行长时间运行的 bash 命令（如 npm install）时，经常超时失败。

## 失败模式
```typescript
// ❌ 错误方式
bash({ command: 'npm install', timeout: 120000 })
// 2 分钟超时，npm install 可能需要 5 分钟
```

## 更优方案
```typescript
// ✓ 正确方式 1: 后台执行
bash({ command: 'npm install', run_in_background: true })
// 等待通知，而非阻塞

// ✓ 正确方式 2: 增加超时
bash({ command: 'npm install', timeout: 600000 })
// 10 分钟超时

// ✓ 正确方式 3: 分步执行
bash({ command: 'npm install --dry-run' }) // 先预检查
bash({ command: 'npm install', run_in_background: true })
```

## 自动应用规则
**触发条件**：bash 工具 + (npm install | cargo build | docker build)
**自动策略**：
1. 检测到匹配命令时，自动建议使用 run_in_background
2. 如果用户坚持同步执行，自动调整 timeout 为 600000

**实现位置**：`src/core/tools/BashTool.ts` - 执行前检查
```

---

### 4. Capability Tracking（能力追踪）

#### 数据结构

```typescript
interface CapabilityMetric {
  category: string;              // 'code-generation' | 'debugging' | 'tool-usage' | ...
  metric: string;                // 'success-rate' | 'avg-steps' | 'avg-tokens' | ...

  timeline: Array<{
    timestamp: number;
    value: number;
    context?: string;            // 改进原因
  }>;

  baseline: number;              // 初始基线
  current: number;               // 当前值
  improvement: number;           // 改进百分比

  milestones: Array<{
    timestamp: number;
    description: string;
    before: number;
    after: number;
  }>;
}
```

#### Markdown 文件格式

```markdown
# capabilities/code-generation.md

## 能力：代码生成

### 成功率趋势

| 日期 | 成功率 | 任务数 | 改进原因 |
|------|--------|--------|----------|
| 2026-02-01 | 72% | 50 | 基线 |
| 2026-02-15 | 78% | 120 | 增加了 Edit 工具行号支持 |
| 2026-03-01 | 82% | 200 | 学习了 Ink ANSI 颜色处理 |
| 2026-03-16 | 85% | 350 | 优化了 System Prompt（避免过度重构） |

### 关键里程碑

**2026-02-27: 向量检索集成**
- 之前：依赖正则匹配意图，准确率 65%
- 之后：向量语义路由，准确率 88%
- 改进：+23% 意图识别准确率

**2026-03-04: 流式中断优化**
- 之前：用户补充输入后，旧内容继续输出
- 之后：立即中断，响应新指令
- 改进：用户满意度 +40%

### 当前短板
- [ ] 多文件重构：成功率仅 60%（需改进）
- [ ] 复杂正则表达式生成：失败率 30%
- [ ] Bash 脚本调试：平均需要 3.5 轮（目标 2 轮）

### 下一步优化方向
1. 增加 MultiEditTool 的示例和最佳实践
2. 正则表达式生成前，先用 LLM 验证逻辑
3. Bash 脚本失败时，自动执行 `bash -x` 调试
```

#### 自动追踪

```typescript
export class CapabilityTracker {
  /**
   * 任务完成后自动更新能力指标
   */
  async updateMetrics(task: CompletedTask): Promise<void> {
    const category = this.categorizeTask(task);
    const metrics = await this.loadMetrics(category);

    // 更新成功率
    metrics.successRate.timeline.push({
      timestamp: Date.now(),
      value: task.outcome === 'success' ? 1 : 0,
    });

    // 计算滚动平均（最近 30 天）
    const recent = metrics.successRate.timeline.filter(
      t => Date.now() - t.timestamp < 30 * 24 * 60 * 60 * 1000
    );
    metrics.successRate.current = recent.reduce((sum, t) => sum + t.value, 0) / recent.length;

    // 检测里程碑（成功率提升 > 5%）
    if (metrics.successRate.current - metrics.successRate.baseline > 0.05) {
      await this.recordMilestone({
        category,
        metric: 'success-rate',
        before: metrics.successRate.baseline,
        after: metrics.successRate.current,
        reason: await this.inferImprovementReason(category),
      });
      metrics.successRate.baseline = metrics.successRate.current; // 更新基线
    }

    await this.saveMetrics(category, metrics);
  }

  /**
   * 推断改进原因（从 Lessons 和 Skills）
   */
  private async inferImprovementReason(category: string): Promise<string> {
    const recentLessons = await this.loadRecentLessons(category, 7); // 最近 7 天
    const recentSkills = await this.loadRecentSkills(category, 7);

    if (recentSkills.length > 0) {
      return `新增 Skill: ${recentSkills.map(s => s.name).join(', ')}`;
    }

    if (recentLessons.some(l => l.type === 'success')) {
      return `学习了成功模式: ${recentLessons[0].learning.whatWorked[0]}`;
    }

    return '持续优化';
  }
}
```

---

## 系统集成

### 1. 在 AgentLoop 中集成学习

```typescript
export class AgentLoop {
  private lessonExtractor: LessonExtractor;
  private skillDiscovery: SkillDiscovery;
  private capabilityTracker: CapabilityTracker;

  async run(userMessage: string): Promise<void> {
    const taskId = randomUUID();
    const taskStart = Date.now();
    const steps: ExecutionStep[] = [];

    try {
      // 执行任务...
      const result = await this.executeTask(userMessage);
      steps.push(...result.steps);

      // ✅ 任务成功，提取经验
      const lesson = await this.lessonExtractor.extractLesson({
        userMessage,
        agentSteps: steps,
        finalOutcome: 'success',
      });

      if (lesson) {
        await this.memoryManager.store({
          content: `学到经验：${lesson.learning.whatWorked.join(', ')}`,
          tags: ['lesson-learned', lesson.category],
          metadata: {
            lessonId: lesson.id,
            importance: 'medium',
            source: 'auto-learning',
          },
        });
      }

      // 📊 更新能力指标
      await this.capabilityTracker.updateMetrics({
        taskId,
        category: this.categorizeTask(userMessage),
        outcome: 'success',
        duration: Date.now() - taskStart,
        stepsCount: steps.length,
      });

      // 🔍 检测 Skill 候选
      const recentTasks = await this.loadRecentTasks(10);
      const skillCandidate = await this.skillDiscovery.detectPattern(recentTasks);

      if (skillCandidate && skillCandidate.confidence > 0.8) {
        // 生成 Skill 并通知用户
        const skill = await this.skillGenerator.generateSkill(skillCandidate);
        this.notifyUser(`发现新 Skill 候选：${skill.name}，是否审核启用？`);
      }

    } catch (error) {
      // ❌ 任务失败，提取教训
      const lesson = await this.lessonExtractor.extractLesson({
        userMessage,
        agentSteps: steps,
        finalOutcome: 'failure',
        error: error.message,
      });

      if (lesson) {
        // 保存失败教训
        await this.memoryManager.store({
          content: `失败教训：${lesson.learning.rootCause}。解决方案：${lesson.learning.solution}`,
          tags: ['lesson-learned', 'failure', lesson.category],
          metadata: {
            lessonId: lesson.id,
            importance: 'high',
            source: 'auto-learning',
          },
        });
      }

      // 📊 更新失败指标
      await this.capabilityTracker.updateMetrics({
        taskId,
        category: this.categorizeTask(userMessage),
        outcome: 'failure',
        duration: Date.now() - taskStart,
        stepsCount: steps.length,
      });
    }
  }
}
```

### 2. 在 System Prompt 中应用经验

```typescript
export class ExperienceAwarePromptBuilder extends LayeredPromptBuilder {
  /**
   * 在 L1 层注入相关经验
   */
  async buildL1(context: PromptBuildContext): Promise<string> {
    const baseL1 = await super.buildL1(context);

    // 检索相关经验教训
    const relevantLessons = await this.memoryManager.retrieve(
      context.userMessage,
      {
        types: ['lesson-learned'],
        maxResults: 3,
        minConfidence: 0.7,
      }
    );

    if (relevantLessons.length === 0) {
      return baseL1;
    }

    // 注入经验
    const lessonsPrompt = `
## 相关经验

基于过往经验，处理此类任务时应注意：

${relevantLessons.map((lesson, i) => {
  const meta = JSON.parse(lesson.metadata?.lessonId || '{}');
  return `${i + 1}. **${meta.category || '通用'}**：${lesson.content}`;
}).join('\n')}
    `.trim();

    return `${baseL1}\n\n${lessonsPrompt}`;
  }
}
```

---

## 文件组织

```
~/.xuanji/
├── memory/
│   ├── daily/                      # 日常对话日志
│   ├── knowledge/                  # 长期知识库
│   ├── lessons/                    # 经验教训（新增）
│   │   ├── success/
│   │   │   ├── 2026-03-16-edit-tool-line-numbers.md
│   │   │   └── 2026-03-04-stream-interrupt-fix.md
│   │   ├── failure/
│   │   │   ├── 2026-02-20-bash-timeout-issue.md
│   │   │   └── 2026-03-01-multi-file-refactor-fail.md
│   │   └── insights/
│   │       └── 2026-03-10-ink-ansi-color-handling.md
│   ├── capabilities/               # 能力追踪（新增）
│   │   ├── code-generation.md
│   │   ├── debugging.md
│   │   ├── tool-usage.md
│   │   └── user-interaction.md
│   └── index.sqlite
├── skills/
│   ├── builtin/                    # 内置 Skill
│   └── generated/                  # 自动生成 Skill（新增）
│       ├── pending/                # 待审核
│       │   └── auto-git-commit.json5
│       └── approved/               # 已批准
│           └── auto-conventional-commit.json5
└── config.json
```

---

## 配置选项

```typescript
// ~/.xuanji/config.json
{
  "selfLearning": {
    "enabled": true,

    "lessonExtraction": {
      "enabled": true,
      "minStepsForLearning": 3,        // 最少步骤数
      "extractOnFailure": true,         // 失败时提取
      "extractOnSuccess": true,         // 成功时提取
      "requireUserFeedback": false,     // 是否需要用户反馈
    },

    "skillDiscovery": {
      "enabled": true,
      "minRepetitions": 3,              // 最少重复次数
      "similarityThreshold": 0.7,       // 相似度阈值
      "autoApprove": false,             // 是否自动批准（建议 false）
      "notifyUser": true,               // 发现 Skill 候选时通知用户
    },

    "capabilityTracking": {
      "enabled": true,
      "categories": [
        'code-generation',
        'debugging',
        'tool-usage',
        'user-interaction'
      ],
      "reportInterval": 7,              // 7 天生成一次报告
    },

    "promptOptimization": {
      "enabled": false,                 // 默认禁用（实验性）
      "requireReview": true,            // 需要人工审核
      "optimizeInterval": 30,           // 30 天优化一次
    },
  }
}
```

---

## 用户交互示例

### 场景 1: 自动提取成功经验

```
User: 帮我修复 Edit 工具的 diff 输出，加上行号

Agent: [执行任务...]
      ✓ 已完成。使用单列行号格式，保留 ANSI 颜色。

      ✓ 学到新经验：Ink 组件使用 color={undefined} 可保留 ANSI 颜色码

      已自动记录到：~/.xuanji/memory/lessons/success/2026-03-16-edit-tool-line-numbers.md
```

### 场景 2: 发现 Skill 候选

```
Agent: 💡 发现重复模式

      你最近 3 次任务都涉及「Git 提交 + Conventional Commit 消息生成」：
      1. "提交代码到 Git"
      2. "commit my changes"
      3. "保存并提交修改"

      我可以自动生成一个 Skill 简化此流程，是否审核？

User: 好的

Agent: [显示 Skill 定义]

      ID: auto-conventional-commit
      触发词: 提交, commit, 保存修改
      工具序列: bash(git status) → bash(git add) → bash(git commit)

      是否批准？[y/n/e(编辑)]

User: y

Agent: ✓ Skill 已启用

      下次只需说「提交代码」，我会自动执行完整流程。
```

### 场景 3: 能力报告

```
Agent: 📊 每周能力报告（2026-03-10 ~ 2026-03-16）

      **代码生成**
      - 成功率：85% ↑ (+3% 较上周)
      - 平均步骤：4.2 ↓ (优化了 0.5 步)
      - 新学经验：3 条

      **调试**
      - 成功率：78% → (持平)
      - 平均轮次：3.1 ↓ (减少了 0.4 轮)

      **工具使用**
      - Bash 超时问题：已修复（学习了后台执行模式）
      - Edit 工具：增加行号支持，用户满意度 +20%

      **新增 Skill**
      - auto-conventional-commit（已批准）

      完整报告：~/.xuanji/memory/capabilities/weekly-report-2026-03-16.md
```

---

## 实施路径

### Phase 1: 经验提取（2 周）
- [ ] LessonExtractor 实现
- [ ] Markdown 格式设计
- [ ] 在 AgentLoop 中集成（任务完成后提取）
- [ ] 测试失败案例提取

### Phase 2: Skill 发现（3 周）
- [ ] SkillDiscovery 模式检测
- [ ] SkillGenerator LLM 生成
- [ ] 审核界面（CLI + GUI）
- [ ] 自动注册和加载

### Phase 3: 能力追踪（2 周）
- [ ] CapabilityTracker 指标收集
- [ ] Markdown 报告生成
- [ ] 里程碑检测
- [ ] 每周报告自动发送

### Phase 4: 自我优化（4 周，实验性）
- [ ] PromptOptimizer 基于 Lessons
- [ ] 工具使用策略自动调整
- [ ] A/B 测试框架
- [ ] 回滚机制

---

## 总结

### 核心优势

1. **真正的自我学习**：不是固定规则，而是从实际任务中学习
2. **透明可审计**：所有经验和 Skill 都以 Markdown 存储，人类可编辑
3. **持续进化**：能力指标自动追踪，量化改进效果
4. **用户控制**：自动生成的 Skill 需要审核，避免失控
5. **知识复用**：经验自动注入 System Prompt，避免重复犯错

### 与 OpenClaw 的差异

| 特性 | OpenClaw | Xuanji 自我进化系统 |
|------|----------|---------------------|
| 记忆存储 | ✓ Markdown | ✓ Markdown |
| 经验学习 | ✗ | ✓ 自动提取 Lessons |
| Skill 生成 | ✗ | ✓ 自动发现和生成 |
| 能力追踪 | ✗ | ✓ 量化指标 |
| Prompt 优化 | ✗ | ✓ 基于经验自动优化 |

### 预期效果

- **6 个月后**：
  - 成功率提升 15-20%
  - 平均任务步骤减少 30%
  - 自动生成 20+ 个实用 Skill
  - 累积 100+ 条可复用经验

- **1 年后**：
  - 形成完整的知识库
  - Prompt 自我优化到第 3-5 代
  - 用户几乎不需要重复相同指令
  - xuanji 真正成为"会学习的 AI 助手"
