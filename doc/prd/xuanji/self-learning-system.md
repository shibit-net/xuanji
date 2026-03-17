# Xuanji 自我学习与进化系统设计

## 愿景

**Xuanji 不是一个静态的 AI 助手，而是一个能够自我学习、不断进化的智能体。**

通过记忆系统，Xuanji 能够：
1. **从经验中学习** - 分析成功/失败案例，提取可复用的知识
2. **积累技能** - 将学到的方法固化为可执行流程
3. **自我反思** - 评估自己的表现，发现改进空间
4. **自主进化** - 优化 system prompt、工具使用策略、决策逻辑

---

## 核心理念

### 传统 AI 助手 vs 自我学习的 Xuanji

| 维度 | 传统 AI 助手 | 自我学习的 Xuanji |
|------|-------------|------------------|
| **知识来源** | 预训练数据 + 用户输入 | 预训练 + **交互中学习** |
| **能力增长** | 固定（等待模型更新） | **持续进化**（每次交互都在成长） |
| **个性化** | 通用回答 | **深度理解**用户偏好和项目 |
| **错误处理** | 重复相同错误 | **记住错误**，下次避免 |
| **技能积累** | 无 | **构建技能库**（越用越强） |

### 学习循环（Learning Loop）

```
交互阶段
  ↓
[1] 执行任务（与用户对话、使用工具）
  ↓
[2] 记录结果（成功/失败、用户反馈）
  ↓
[3] 知识提取（提取模式、方法、技能）
  ↓
[4] 结构化存储（技能库、案例库）
  ↓
[5] 反思与改进（分析为什么成功/失败）
  ↓
[6] 优化策略（更新 prompt、工具选择逻辑）
  ↓
下次交互（应用学到的知识）
```

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Xuanji Core                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      ┌──────────────┐               │
│  │ AgentLoop    │◄─────┤ MetaLearner  │  元学习引擎   │
│  └──────────────┘      └──────────────┘               │
│         ▲                      ▲                        │
│         │                      │                        │
│  ┌──────┴──────────────────────┴────────┐             │
│  │     Learning Engine (学习引擎)       │             │
│  ├──────────────────────────────────────┤             │
│  │  [1] ExperienceRecorder   记录经验   │             │
│  │  [2] KnowledgeExtractor   提取知识   │             │
│  │  [3] SkillBuilder         构建技能   │             │
│  │  [4] ReflectionEngine     反思改进   │             │
│  │  [5] StrategyOptimizer    优化策略   │             │
│  └──────────────────────────────────────┘             │
│         ▲                      │                        │
│         │                      ▼                        │
│  ┌──────┴──────┐      ┌──────────────┐                │
│  │   Memory    │      │ Knowledge    │                 │
│  │   System    │      │ Base         │                 │
│  └─────────────┘      └──────────────┘                │
│         ▲                      │                        │
│         │                      │                        │
│  ┌──────┴──────────────────────┴────────┐             │
│  │         Storage Layer                │             │
│  ├──────────────────────────────────────┤             │
│  │  • 短期记忆 (对话历史)                │             │
│  │  • 长期记忆 (知识库)                  │             │
│  │  • 技能库   (可执行流程)              │             │
│  │  • 案例库   (成功/失败案例)           │             │
│  │  • 策略库   (优化的 prompts)          │             │
│  └──────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

---

## 一、知识提取系统

### 1.1 经验记录器（ExperienceRecorder）

```typescript
// src/learning/ExperienceRecorder.ts

export class ExperienceRecorder {
  /**
   * 记录每次交互的完整经验
   */
  async recordExperience(interaction: Interaction): Promise<Experience> {
    const experience: Experience = {
      id: generateId(),
      timestamp: Date.now(),

      // 任务信息
      task: {
        type: this.inferTaskType(interaction.userInput),
        description: interaction.userInput,
        complexity: this.estimateComplexity(interaction),
      },

      // 执行过程
      execution: {
        toolsUsed: interaction.toolCalls.map((t) => t.name),
        iterations: interaction.iterations,
        thinkingTime: interaction.thinkingTime,
        tokens: interaction.tokenUsage,
      },

      // 结果
      outcome: {
        success: await this.evaluateSuccess(interaction),
        userFeedback: interaction.userFeedback, // 用户评分/反馈
        error: interaction.error,
        output: interaction.assistantResponse,
      },

      // 上下文
      context: {
        workingDirectory: interaction.cwd,
        files: interaction.filesAccessed,
        currentProject: this.getCurrentProject(),
      },
    };

    // 保存到经验库
    await this.experienceStore.save(experience);

    return experience;
  }

  /**
   * 评估任务是否成功
   */
  private async evaluateSuccess(interaction: Interaction): Promise<boolean> {
    // 1. 用户明确反馈
    if (interaction.userFeedback) {
      return interaction.userFeedback.rating >= 4; // 5分制，>=4分算成功
    }

    // 2. 无错误 + 用户未中断
    if (!interaction.error && !interaction.interrupted) {
      return true;
    }

    // 3. 使用 LLM 评估（可选）
    const evaluation = await this.llm.evaluate({
      task: interaction.userInput,
      response: interaction.assistantResponse,
      toolCalls: interaction.toolCalls,
    });

    return evaluation.success;
  }
}
```

### 1.2 知识提取器（KnowledgeExtractor）

```typescript
// src/learning/KnowledgeExtractor.ts

export class KnowledgeExtractor {
  /**
   * 从成功的经验中提取可复用的知识
   */
  async extractKnowledge(experiences: Experience[]): Promise<Knowledge[]> {
    const knowledgeItems: Knowledge[] = [];

    // 只处理成功的案例
    const successful = experiences.filter((e) => e.outcome.success);

    // [1] 提取模式（Pattern Mining）
    const patterns = await this.extractPatterns(successful);
    knowledgeItems.push(...patterns);

    // [2] 提取技能（Skill Extraction）
    const skills = await this.extractSkills(successful);
    knowledgeItems.push(...skills);

    // [3] 提取偏好（Preference Learning）
    const preferences = await this.extractPreferences(successful);
    knowledgeItems.push(...preferences);

    // [4] 提取约束（Constraint Discovery）
    const constraints = await this.extractConstraints(successful);
    knowledgeItems.push(...constraints);

    return knowledgeItems;
  }

  /**
   * 提取模式（相似任务的通用解决方案）
   */
  private async extractPatterns(experiences: Experience[]): Promise<Knowledge[]> {
    // 按任务类型分组
    const grouped = this.groupByTaskType(experiences);

    const patterns: Knowledge[] = [];

    for (const [taskType, exps] of grouped.entries()) {
      if (exps.length < 3) continue; // 至少3个案例才能提取模式

      // 使用 LLM 分析共性
      const pattern = await this.analyzePattern(exps);

      if (pattern) {
        patterns.push({
          type: 'pattern',
          category: taskType,
          content: pattern.description,
          applicability: pattern.conditions,
          confidence: this.calculateConfidence(exps.length),
          examples: exps.slice(0, 3).map((e) => e.id),
          createdAt: Date.now(),
        });
      }
    }

    return patterns;
  }

  /**
   * 使用 LLM 分析模式
   */
  private async analyzePattern(experiences: Experience[]): Promise<Pattern | null> {
    const prompt = `
分析以下成功案例，提取通用模式：

${experiences
  .map(
    (e, i) => `
[案例 ${i + 1}]
任务: ${e.task.description}
使用的工具: ${e.execution.toolsUsed.join(', ')}
结果: ${e.outcome.output.slice(0, 100)}...
`
  )
  .join('\n')}

请回答：
1. 这些案例有什么共同点？
2. 成功的关键步骤是什么？
3. 什么情况下可以应用这个模式？

返回 JSON 格式：
{
  "description": "模式描述（简洁明了）",
  "keySteps": ["步骤1", "步骤2", ...],
  "conditions": ["适用条件1", "适用条件2", ...]
}
`;

    try {
      const response = await this.llm.generate(prompt);
      const pattern = JSON.parse(response.text);

      // 验证有效性
      if (pattern.description && pattern.keySteps.length > 0) {
        return pattern;
      }
    } catch (err) {
      console.error('Failed to extract pattern:', err);
    }

    return null;
  }

  /**
   * 提取技能（可复用的解决方案）
   */
  private async extractSkills(experiences: Experience[]): Promise<Knowledge[]> {
    const skills: Knowledge[] = [];

    for (const exp of experiences) {
      // 复杂任务（多步骤、多工具）才提取技能
      if (exp.task.complexity < 3) continue;
      if (exp.execution.toolsUsed.length < 2) continue;

      // 使用 LLM 将经验固化为技能
      const skill = await this.synthesizeSkill(exp);

      if (skill) {
        skills.push({
          type: 'skill',
          category: exp.task.type,
          name: skill.name,
          description: skill.description,
          steps: skill.steps,
          tools: exp.execution.toolsUsed,
          successRate: 1.0, // 初始成功率
          usageCount: 0,
          examples: [exp.id],
          createdAt: Date.now(),
        });
      }
    }

    return skills;
  }

  /**
   * 将经验合成为技能
   */
  private async synthesizeSkill(experience: Experience): Promise<Skill | null> {
    const prompt = `
将以下成功案例固化为可复用的技能：

任务: ${experience.task.description}
工具序列: ${experience.execution.toolsUsed.join(' → ')}
结果: 成功

请提取：
1. 技能名称（简洁，如"调试 React 组件渲染问题"）
2. 技能描述（何时使用这个技能）
3. 执行步骤（可复用的流程）

返回 JSON 格式：
{
  "name": "技能名称",
  "description": "使用场景描述",
  "steps": [
    "步骤1: 具体操作",
    "步骤2: 具体操作",
    ...
  ]
}
`;

    try {
      const response = await this.llm.generate(prompt);
      const skill = JSON.parse(response.text);

      if (skill.name && skill.steps.length > 0) {
        return skill;
      }
    } catch (err) {
      console.error('Failed to synthesize skill:', err);
    }

    return null;
  }

  /**
   * 提取用户偏好
   */
  private async extractPreferences(experiences: Experience[]): Promise<Knowledge[]> {
    const preferences: Knowledge[] = [];

    // 分析高评分的交互
    const highRated = experiences.filter((e) => e.outcome.userFeedback?.rating >= 4);

    // 统计偏好模式
    const codeStylePrefs = this.analyzeCodeStyle(highRated);
    const workflowPrefs = this.analyzeWorkflow(highRated);
    const toolPrefs = this.analyzeToolUsage(highRated);

    // 转化为知识条目
    for (const pref of [...codeStylePrefs, ...workflowPrefs, ...toolPrefs]) {
      preferences.push({
        type: 'preference',
        category: pref.category,
        content: pref.description,
        strength: pref.frequency / highRated.length, // 出现频率作为强度
        examples: pref.examples,
        createdAt: Date.now(),
      });
    }

    return preferences;
  }
}
```

---

## 二、技能库系统

### 2.1 技能定义

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;

  // 执行流程
  steps: Array<{
    description: string;
    tool?: string; // 推荐使用的工具
    example?: string; // 示例命令/代码
  }>;

  // 触发条件
  triggers: {
    keywords: string[]; // 关键词（如 "调试"、"React"）
    taskType?: string; // 任务类型
    contextRequired?: string[]; // 需要的上下文（如项目类型）
  };

  // 性能指标
  metrics: {
    successRate: number; // 成功率（0-1）
    avgExecutionTime: number; // 平均执行时间（秒）
    usageCount: number; // 使用次数
    lastUsed: number; // 最后使用时间
  };

  // 学习元数据
  learnedFrom: string[]; // 学习来源（Experience IDs）
  refinedCount: number; // 改进次数
  version: number; // 版本号
  createdAt: number;
  updatedAt: number;
}
```

### 2.2 技能匹配器（SkillMatcher）

```typescript
// src/learning/SkillMatcher.ts

export class SkillMatcher {
  /**
   * 根据用户输入匹配适用的技能
   */
  async matchSkills(userInput: string, context: TaskContext): Promise<Skill[]> {
    const allSkills = await this.skillStore.getAll();

    // [1] 关键词匹配
    const keywordMatches = this.matchByKeywords(userInput, allSkills);

    // [2] 语义匹配（向量检索）
    const embedding = await this.embeddingService.embed(userInput);
    const semanticMatches = await this.skillStore.search(embedding, 10);

    // [3] 上下文匹配
    const contextMatches = this.matchByContext(context, allSkills);

    // [4] 综合评分
    const scored = this.scoreSkills(keywordMatches, semanticMatches, contextMatches);

    // [5] 过滤低成功率技能
    const filtered = scored.filter((s) => s.metrics.successRate > 0.5);

    // [6] 按成功率和使用频率排序
    filtered.sort((a, b) => {
      const scoreA = a.metrics.successRate * 0.7 + a.metrics.usageCount * 0.3;
      const scoreB = b.metrics.successRate * 0.7 + b.metrics.usageCount * 0.3;
      return scoreB - scoreA;
    });

    return filtered.slice(0, 3); // 返回 Top 3
  }

  /**
   * 应用技能（注入到 system prompt）
   */
  async applySkill(skill: Skill): Promise<string> {
    return `
## 推荐使用技能: ${skill.name}

${skill.description}

### 执行步骤:
${skill.steps.map((s, i) => `${i + 1}. ${s.description}${s.tool ? ` (使用 ${s.tool})` : ''}`).join('\n')}

此技能成功率: ${(skill.metrics.successRate * 100).toFixed(0)}%，已使用 ${skill.metrics.usageCount} 次。
`;
  }
}
```

### 2.3 技能改进器（SkillRefiner）

```typescript
// src/learning/SkillRefiner.ts

export class SkillRefiner {
  /**
   * 根据新经验改进技能
   */
  async refineSkill(skill: Skill, newExperience: Experience): Promise<void> {
    // 更新使用统计
    skill.metrics.usageCount++;
    skill.metrics.lastUsed = Date.now();

    // 更新成功率（指数移动平均）
    const alpha = 0.3; // 学习率
    const wasSuccessful = newExperience.outcome.success ? 1 : 0;
    skill.metrics.successRate =
      skill.metrics.successRate * (1 - alpha) + wasSuccessful * alpha;

    // 如果失败，分析原因并优化步骤
    if (!newExperience.outcome.success) {
      await this.analyzeFail(skill, newExperience);
    }

    // 如果成功率下降，考虑退化版本
    if (skill.metrics.successRate < 0.4 && skill.version > 1) {
      await this.rollbackVersion(skill);
    }

    // 如果连续成功多次，尝试简化步骤
    if (this.isConsistentlySuccessful(skill)) {
      await this.simplifySteps(skill);
    }

    skill.refinedCount++;
    skill.updatedAt = Date.now();

    await this.skillStore.update(skill.id, skill);
  }

  /**
   * 分析失败原因并优化
   */
  private async analyzeFail(skill: Skill, experience: Experience): Promise<void> {
    const prompt = `
技能执行失败，请分析原因并建议改进：

技能: ${skill.name}
步骤: ${skill.steps.map((s) => s.description).join(' → ')}

实际执行:
- 用户输入: ${experience.task.description}
- 使用的工具: ${experience.execution.toolsUsed.join(', ')}
- 错误: ${experience.outcome.error || '未知'}

请回答：
1. 为什么失败？
2. 应该如何改进步骤？

返回 JSON 格式：
{
  "failureReason": "失败原因",
  "improvedSteps": [...]  // 改进后的步骤（可选）
}
`;

    try {
      const response = await this.llm.generate(prompt);
      const analysis = JSON.parse(response.text);

      // 记录失败分析
      await this.failureAnalysisStore.save({
        skillId: skill.id,
        experienceId: experience.id,
        reason: analysis.failureReason,
        suggestedFix: analysis.improvedSteps,
        timestamp: Date.now(),
      });

      // 如果有改进建议，更新技能
      if (analysis.improvedSteps && analysis.improvedSteps.length > 0) {
        skill.steps = analysis.improvedSteps.map((desc: string) => ({
          description: desc,
        }));
        skill.version++;
      }
    } catch (err) {
      console.error('Failed to analyze failure:', err);
    }
  }
}
```

---

## 三、反思引擎（ReflectionEngine）

### 3.1 自我评估

```typescript
// src/learning/ReflectionEngine.ts

export class ReflectionEngine {
  /**
   * 定期自我评估（每日/每周）
   */
  async performReflection(period: 'daily' | 'weekly'): Promise<ReflectionReport> {
    const experiences = await this.getRecentExperiences(period);

    const report: ReflectionReport = {
      period,
      timestamp: Date.now(),

      // 绩效指标
      performance: {
        totalTasks: experiences.length,
        successRate: this.calculateSuccessRate(experiences),
        avgResponseTime: this.calculateAvgTime(experiences),
        userSatisfaction: this.calculateSatisfaction(experiences),
      },

      // 优势分析
      strengths: await this.identifyStrengths(experiences),

      // 弱点分析
      weaknesses: await this.identifyWeaknesses(experiences),

      // 改进建议
      improvements: [],
    };

    // 基于弱点生成改进建议
    for (const weakness of report.weaknesses) {
      const suggestion = await this.generateImprovement(weakness);
      report.improvements.push(suggestion);
    }

    // 保存反思报告
    await this.reflectionStore.save(report);

    return report;
  }

  /**
   * 识别优势（擅长的任务类型）
   */
  private async identifyStrengths(experiences: Experience[]): Promise<Strength[]> {
    const byType = this.groupByTaskType(experiences);
    const strengths: Strength[] = [];

    for (const [taskType, exps] of byType.entries()) {
      const successRate = exps.filter((e) => e.outcome.success).length / exps.length;

      if (successRate > 0.8 && exps.length >= 5) {
        // 高成功率且足够样本
        strengths.push({
          area: taskType,
          successRate,
          sampleSize: exps.length,
          description: await this.describeStrength(taskType, exps),
        });
      }
    }

    return strengths;
  }

  /**
   * 识别弱点（经常失败的任务类型）
   */
  private async identifyWeaknesses(experiences: Experience[]): Promise<Weakness[]> {
    const byType = this.groupByTaskType(experiences);
    const weaknesses: Weakness[] = [];

    for (const [taskType, exps] of byType.entries()) {
      const successRate = exps.filter((e) => e.outcome.success).length / exps.length;

      if (successRate < 0.5 && exps.length >= 3) {
        // 低成功率
        const failedCases = exps.filter((e) => !e.outcome.success);

        weaknesses.push({
          area: taskType,
          successRate,
          sampleSize: exps.length,
          commonErrors: await this.analyzeCommonErrors(failedCases),
          description: await this.describeWeakness(taskType, failedCases),
        });
      }
    }

    return weaknesses;
  }

  /**
   * 生成改进建议
   */
  private async generateImprovement(weakness: Weakness): Promise<Improvement> {
    const prompt = `
我在以下方面表现不佳：

任务类型: ${weakness.area}
成功率: ${(weakness.successRate * 100).toFixed(0)}%
常见错误: ${weakness.commonErrors.join(', ')}

请建议如何改进：
1. 需要学习什么新知识？
2. 应该调整什么策略？
3. 需要增强哪些工具的使用？

返回 JSON 格式：
{
  "action": "改进行动（简洁）",
  "details": "详细说明",
  "priority": "high|medium|low"
}
`;

    const response = await this.llm.generate(prompt);
    const suggestion = JSON.parse(response.text);

    return {
      targetArea: weakness.area,
      action: suggestion.action,
      details: suggestion.details,
      priority: suggestion.priority,
      status: 'pending',
      createdAt: Date.now(),
    };
  }

  /**
   * 应用改进建议（自主优化）
   */
  async applyImprovement(improvement: Improvement): Promise<void> {
    switch (improvement.action) {
      case 'optimize_prompt':
        // 优化 system prompt
        await this.optimizeSystemPrompt(improvement);
        break;

      case 'adjust_tool_strategy':
        // 调整工具选择策略
        await this.adjustToolStrategy(improvement);
        break;

      case 'learn_new_pattern':
        // 主动学习新模式
        await this.learnNewPattern(improvement);
        break;

      default:
        console.warn('Unknown improvement action:', improvement.action);
    }

    improvement.status = 'applied';
    improvement.appliedAt = Date.now();

    await this.reflectionStore.updateImprovement(improvement.id, improvement);
  }
}
```

---

## 四、策略优化器（StrategyOptimizer）

### 4.1 System Prompt 自适应优化

```typescript
// src/learning/StrategyOptimizer.ts

export class StrategyOptimizer {
  /**
   * 根据反思报告优化 system prompt
   */
  async optimizeSystemPrompt(reflection: ReflectionReport): Promise<void> {
    const currentPrompt = await this.getSystemPrompt();

    // 基于优势和弱点调整 prompt
    const optimizedPrompt = await this.generateOptimizedPrompt(
      currentPrompt,
      reflection.strengths,
      reflection.weaknesses
    );

    // A/B 测试（50%概率使用新 prompt）
    await this.deployPromptWithABTest(optimizedPrompt);
  }

  /**
   * 生成优化后的 system prompt
   */
  private async generateOptimizedPrompt(
    currentPrompt: string,
    strengths: Strength[],
    weaknesses: Weakness[]
  ): Promise<string> {
    const prompt = `
当前 system prompt:
\`\`\`
${currentPrompt}
\`\`\`

根据最近表现分析：

优势（保持）:
${strengths.map((s) => `- ${s.area}: 成功率 ${(s.successRate * 100).toFixed(0)}%`).join('\n')}

弱点（改进）:
${weaknesses.map((w) => `- ${w.area}: 成功率 ${(w.successRate * 100).toFixed(0)}%, 常见错误: ${w.commonErrors.join(', ')}`).join('\n')}

请优化 system prompt：
1. 强化弱点领域的指导
2. 保留优势领域的策略
3. 添加针对性的约束或提示
4. 保持总长度不超过 500 词

返回优化后的完整 system prompt（纯文本）。
`;

    const response = await this.llm.generate(prompt);
    return response.text;
  }

  /**
   * A/B 测试部署
   */
  private async deployPromptWithABTest(newPrompt: string): Promise<void> {
    const version = {
      id: generateId(),
      content: newPrompt,
      deployedAt: Date.now(),
      trafficWeight: 0.5, // 50% 流量
      metrics: {
        usageCount: 0,
        successRate: 0,
        userSatisfaction: 0,
      },
    };

    await this.promptVersionStore.save(version);

    // 定时评估（7天后）
    setTimeout(async () => {
      await this.evaluatePromptVersion(version.id);
    }, 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * 评估 prompt 版本性能
   */
  private async evaluatePromptVersion(versionId: string): Promise<void> {
    const version = await this.promptVersionStore.get(versionId);
    const baseline = await this.promptVersionStore.getBaseline();

    // 对比性能
    if (version.metrics.successRate > baseline.metrics.successRate + 0.05) {
      // 新版本显著更好，全量部署
      await this.promoteToProduction(versionId);
    } else {
      // 新版本无明显优势，回滚
      await this.rollbackPrompt(versionId);
    }
  }
}
```

### 4.2 工具选择策略优化

```typescript
// src/learning/ToolStrategyOptimizer.ts

export class ToolStrategyOptimizer {
  /**
   * 分析工具使用效果
   */
  async analyzeToolUsage(experiences: Experience[]): Promise<ToolInsights> {
    const insights: ToolInsights = {
      toolEffectiveness: new Map(),
      toolCombinations: [],
      recommendations: [],
    };

    // 统计每个工具的成功率
    for (const exp of experiences) {
      for (const tool of exp.execution.toolsUsed) {
        if (!insights.toolEffectiveness.has(tool)) {
          insights.toolEffectiveness.set(tool, {
            totalUsage: 0,
            successCount: 0,
            avgExecutionTime: 0,
          });
        }

        const stats = insights.toolEffectiveness.get(tool)!;
        stats.totalUsage++;
        if (exp.outcome.success) stats.successCount++;
      }
    }

    // 发现有效的工具组合
    insights.toolCombinations = await this.discoverToolCombinations(experiences);

    // 生成优化建议
    insights.recommendations = await this.generateToolRecommendations(insights);

    return insights;
  }

  /**
   * 发现有效的工具组合
   */
  private async discoverToolCombinations(
    experiences: Experience[]
  ): Promise<ToolCombination[]> {
    const combinations = new Map<string, { success: number; total: number }>();

    for (const exp of experiences) {
      if (exp.execution.toolsUsed.length < 2) continue;

      const combo = exp.execution.toolsUsed.sort().join(' → ');

      if (!combinations.has(combo)) {
        combinations.set(combo, { success: 0, total: 0 });
      }

      const stats = combinations.get(combo)!;
      stats.total++;
      if (exp.outcome.success) stats.success++;
    }

    // 过滤出高成功率组合（>=80%，>=3次使用）
    const effective: ToolCombination[] = [];

    for (const [combo, stats] of combinations.entries()) {
      const successRate = stats.success / stats.total;

      if (successRate >= 0.8 && stats.total >= 3) {
        effective.push({
          tools: combo.split(' → '),
          successRate,
          usageCount: stats.total,
        });
      }
    }

    return effective;
  }

  /**
   * 生成工具使用建议
   */
  private async generateToolRecommendations(
    insights: ToolInsights
  ): Promise<ToolRecommendation[]> {
    const recommendations: ToolRecommendation[] = [];

    // 识别低效工具
    for (const [tool, stats] of insights.toolEffectiveness.entries()) {
      const successRate = stats.successCount / stats.totalUsage;

      if (successRate < 0.5 && stats.totalUsage >= 5) {
        recommendations.push({
          type: 'avoid',
          tool,
          reason: `成功率过低 (${(successRate * 100).toFixed(0)}%)`,
          alternative: await this.findAlternativeTool(tool, insights),
        });
      }
    }

    // 推荐高效工具组合
    for (const combo of insights.toolCombinations) {
      recommendations.push({
        type: 'prefer',
        tools: combo.tools,
        reason: `成功率高 (${(combo.successRate * 100).toFixed(0)}%)`,
      });
    }

    return recommendations;
  }
}
```

---

## 五、元学习器（MetaLearner）

### 5.1 学习如何学习

```typescript
// src/learning/MetaLearner.ts

export class MetaLearner {
  /**
   * 评估学习系统本身的效果
   */
  async evaluateLearningSystem(): Promise<MetaEvaluation> {
    // 获取最近的学习成果
    const recentSkills = await this.skillStore.getRecent(30); // 最近 30 天
    const recentReflections = await this.reflectionStore.getRecent(7); // 最近 7 次

    // 评估维度
    return {
      // 知识积累速度
      knowledgeGrowthRate: this.calculateKnowledgeGrowth(recentSkills),

      // 技能质量
      skillQuality: this.evaluateSkillQuality(recentSkills),

      // 改进效果
      improvementEffectiveness: this.evaluateImprovements(recentReflections),

      // 学习效率
      learningEfficiency: this.calculateLearningEfficiency(),

      // 自适应能力
      adaptability: this.measureAdaptability(),
    };
  }

  /**
   * 优化学习参数
   */
  async optimizeLearningParameters(): Promise<void> {
    const evaluation = await this.evaluateLearningSystem();

    // 如果知识增长缓慢，降低提取阈值（更激进地提取知识）
    if (evaluation.knowledgeGrowthRate < 0.5) {
      await this.adjustParameter('extractionThreshold', -0.1);
    }

    // 如果技能质量低，提高提取标准（更严格筛选）
    if (evaluation.skillQuality < 0.6) {
      await this.adjustParameter('skillQualityThreshold', +0.1);
    }

    // 如果改进效果差，增加反思频率
    if (evaluation.improvementEffectiveness < 0.5) {
      await this.adjustParameter('reflectionInterval', -24 * 60 * 60 * 1000); // 缩短1天
    }
  }

  /**
   * 自我诊断
   */
  async selfDiagnose(): Promise<DiagnosisReport> {
    const issues: Issue[] = [];

    // [1] 检查知识库健康度
    const knowledgeHealth = await this.checkKnowledgeHealth();
    if (knowledgeHealth.duplicateRate > 0.2) {
      issues.push({
        severity: 'medium',
        area: 'knowledge_base',
        description: '知识库存在大量重复条目',
        suggestedFix: '运行去重任务',
      });
    }

    // [2] 检查技能库有效性
    const skillHealth = await this.checkSkillHealth();
    if (skillHealth.lowSuccessRateCount > 5) {
      issues.push({
        severity: 'high',
        area: 'skill_library',
        description: `有 ${skillHealth.lowSuccessRateCount} 个技能成功率低于50%`,
        suggestedFix: '清理或改进低效技能',
      });
    }

    // [3] 检查学习速度
    const learningSpeed = await this.checkLearningSpeed();
    if (learningSpeed.skillsPerWeek < 1) {
      issues.push({
        severity: 'low',
        area: 'learning_rate',
        description: '学习速度偏慢',
        suggestedFix: '降低技能提取阈值',
      });
    }

    return {
      timestamp: Date.now(),
      overallHealth: this.calculateOverallHealth(issues),
      issues,
      recommendations: await this.generateDiagnosisRecommendations(issues),
    };
  }
}
```

---

## 六、集成到主流程

### 6.1 ChatSession 集成学习引擎

```typescript
// src/core/chat/ChatSession.ts

export class ChatSession {
  private learningEngine: LearningEngine;

  async run(userInput: string): Promise<void> {
    // [阶段 1] 匹配适用的技能
    const matchedSkills = await this.learningEngine.matchSkills(userInput, {
      workingDirectory: process.cwd(),
      currentProject: this.projectDetector.detect(),
    });

    // [阶段 2] 将技能注入 system prompt
    let enhancedPrompt = this.agentConfig.systemPrompt;

    if (matchedSkills.length > 0) {
      const skillPrompts = await Promise.all(
        matchedSkills.map((s) => this.skillMatcher.applySkill(s))
      );

      enhancedPrompt += '\n\n' + skillPrompts.join('\n\n');
    }

    // [阶段 3] 执行 AgentLoop
    const startTime = Date.now();

    const result = await this.agentLoop.run([{ role: 'user', content: userInput }], {
      systemPrompt: enhancedPrompt,
    });

    const executionTime = Date.now() - startTime;

    // [阶段 4] 记录经验
    const experience = await this.learningEngine.recordExperience({
      userInput,
      assistantResponse: result.text,
      toolCalls: result.toolCalls,
      tokenUsage: result.usage,
      thinkingTime: executionTime,
      iterations: result.iterations,
      error: result.error,
      userFeedback: null, // 稍后用户可能提供反馈
    });

    // [阶段 5] 提取知识（异步）
    this.learningEngine.extractKnowledgeAsync(experience).catch((err) => {
      console.error('Failed to extract knowledge:', err);
    });

    // [阶段 6] 如果使用了技能，更新技能性能
    for (const skill of matchedSkills) {
      await this.learningEngine.updateSkillMetrics(skill.id, experience);
    }
  }

  /**
   * 用户反馈接口
   */
  async provideFeedback(rating: number, comment?: string): Promise<void> {
    const lastExperience = await this.learningEngine.getLastExperience();

    if (lastExperience) {
      lastExperience.outcome.userFeedback = { rating, comment };
      await this.experienceStore.update(lastExperience.id, lastExperience);

      // 触发学习流程
      await this.learningEngine.learnFromFeedback(lastExperience);
    }
  }
}
```

### 6.2 定时学习任务

```typescript
// src/learning/LearningScheduler.ts

export class LearningScheduler {
  start() {
    // 每日凌晨 3 点：提取知识
    cron.schedule('0 3 * * *', async () => {
      console.log('[Learning] Extracting knowledge from yesterday...');
      const yesterday = await this.getYesterdayExperiences();
      const knowledge = await this.knowledgeExtractor.extractKnowledge(yesterday);
      console.log(`[Learning] Extracted ${knowledge.length} knowledge items`);
    });

    // 每周日凌晨 4 点：反思与改进
    cron.schedule('0 4 * * 0', async () => {
      console.log('[Learning] Performing weekly reflection...');
      const report = await this.reflectionEngine.performReflection('weekly');
      console.log(`[Learning] Strengths: ${report.strengths.length}, Weaknesses: ${report.weaknesses.length}`);

      // 自动应用改进
      for (const improvement of report.improvements) {
        if (improvement.priority === 'high') {
          await this.reflectionEngine.applyImprovement(improvement);
        }
      }
    });

    // 每月 1 号凌晨 5 点：元学习优化
    cron.schedule('0 5 1 * *', async () => {
      console.log('[Learning] Optimizing learning system...');
      await this.metaLearner.optimizeLearningParameters();

      const diagnosis = await this.metaLearner.selfDiagnose();
      console.log(`[Learning] Health: ${diagnosis.overallHealth}%, Issues: ${diagnosis.issues.length}`);
    });
  }
}
```

---

## 七、用户界面增强

### 7.1 学习仪表盘

```typescript
// desktop/renderer/views/LearningDashboard.tsx

export default function LearningDashboard() {
  const [stats, setStats] = useState<LearningStats | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const result = await window.electron.learningStats();
    setStats(result.stats);
  };

  if (!stats) return <div>Loading...</div>;

  return (
    <div className="learning-dashboard">
      <h2>🧠 学习进度</h2>

      {/* 知识积累 */}
      <div className="section">
        <h3>知识积累</h3>
        <div className="stats-grid">
          <StatCard
            label="总知识条目"
            value={stats.totalKnowledge}
            trend={stats.knowledgeGrowth}
          />
          <StatCard label="技能数量" value={stats.totalSkills} trend={stats.skillGrowth} />
          <StatCard label="成功案例" value={stats.successfulCases} />
        </div>
      </div>

      {/* 技能库 */}
      <div className="section">
        <h3>技能库</h3>
        <SkillList skills={stats.topSkills} />
      </div>

      {/* 最近反思 */}
      <div className="section">
        <h3>最近反思</h3>
        <ReflectionReport report={stats.latestReflection} />
      </div>

      {/* 改进建议 */}
      <div className="section">
        <h3>改进建议</h3>
        <ImprovementList improvements={stats.pendingImprovements} />
      </div>
    </div>
  );
}
```

---

## 八、实施路线图

### Phase 1: 基础学习能力（4-6周）

**目标**: 能从交互中学习并积累知识

- [ ] ExperienceRecorder - 记录每次交互
- [ ] KnowledgeExtractor - 提取模式和偏好
- [ ] 知识库存储（SQLite + 向量检索）
- [ ] 基础 UI（查看学到的知识）

**验证**:
- 10 次交互后，能提取出用户偏好
- 知识库中有可查询的结构化知识

### Phase 2: 技能系统（4-6周）

**目标**: 将经验固化为可复用技能

- [ ] SkillBuilder - 从成功案例构建技能
- [ ] SkillMatcher - 匹配适用技能
- [ ] SkillRefiner - 根据反馈改进技能
- [ ] 技能库 UI

**验证**:
- 相同任务重复出现时，能应用已学技能
- 技能成功率随使用次数提升

### Phase 3: 反思与优化（3-4周）

**目标**: 自我评估并优化策略

- [ ] ReflectionEngine - 定期自我评估
- [ ] StrategyOptimizer - 优化 prompt 和工具策略
- [ ] A/B 测试框架
- [ ] 反思报告 UI

**验证**:
- 每周生成反思报告
- System prompt 根据表现自动优化

### Phase 4: 元学习（2-3周）

**目标**: 学习系统自我诊断和优化

- [ ] MetaLearner - 评估学习效果
- [ ] 自我诊断
- [ ] 参数自动调优
- [ ] 学习仪表盘

**验证**:
- 学习系统健康度可视化
- 低效部分自动优化

---

## 总结

### 核心能力

1. **经验积累** - 记录每次交互，构建经验库
2. **知识提取** - 从经验中提取模式、技能、偏好
3. **技能库** - 将成功方法固化为可复用流程
4. **自我反思** - 定期评估表现，识别优势和弱点
5. **策略优化** - 自动优化 prompt、工具选择
6. **元学习** - 优化学习系统本身

### 进化路径

```
第 1 周:  记录交互 → 积累经验
第 2-4 周: 提取知识 → 构建知识库
第 1 月:  固化技能 → 应用已学技能
第 2 月:  反思改进 → 优化策略
第 3 月:  元学习   → 自我诊断和调优
第 6 月:  自主进化 → 持续成长的智能体
```

### 与记忆系统的关系

```
短期记忆（对话历史）
  ↓ 提取
经验库（成功/失败案例）
  ↓ 分析
知识库（模式、偏好、约束）
  ↓ 固化
技能库（可执行流程）
  ↓ 应用
下次交互（使用学到的知识）
```

### 预期效果

**1 个月后**:
- ✅ 记住用户的代码风格偏好
- ✅ 识别常见任务模式
- ✅ 积累 10-20 个可复用技能

**3 个月后**:
- ✅ 技能成功率提升 20%+
- ✅ 响应时间缩短 30%+
- ✅ 用户满意度提升

**6 个月后**:
- ✅ System prompt 自动优化到最佳状态
- ✅ 工具选择策略高度优化
- ✅ 成为真正"了解你"的个人助手

---

**需要我现在开始实施吗？建议先从 Phase 2（用户管理界面）+ Phase 1（基础学习能力）的基础部分并行开发。**
