# Xuanji 错误记忆与预防系统（Bug Memory System）

## 设计目标

**像人一样，从错误中学习，永远不要犯同样的错误。**

当 Xuanji：
1. ❌ 写出了有 bug 的代码
2. ❌ 执行了错误的命令
3. ❌ 给出了错误的建议
4. ❌ 理解错了用户意图

应该：
1. 📝 **记录错误** - 详细记录错误的原因、上下文、后果
2. 🧠 **理解根因** - 分析为什么会犯这个错误
3. 🔍 **建立索引** - 让相似场景能检索到这个错误记录
4. 🚫 **主动预防** - 下次遇到相似情况，先检查是否会重犯
5. ✅ **验证改进** - 确认确实不再犯同样的错误

---

## 核心理念

### 人类 vs AI 的错误处理

| 人类 | 传统 AI | 自我学习的 Xuanji |
|------|---------|------------------|
| 被火烫过后，记住"火=危险" | 每次都可能重复同样的错误 | **记住错误上下文，主动避免** |
| 错误印象深刻，长期记忆 | 无长期记忆，依赖预训练 | **错误记忆永久存储，优先级高** |
| 触类旁通（火→热水→电） | 只能记住完全相同的情况 | **语义相似度检索，举一反三** |

### 错误学习循环

```
执行任务
  ↓
[检测到错误]
  ↓
立即记录（Error Event）
  ↓
分析根因（Root Cause Analysis）
  ↓
提取教训（Lesson Learned）
  ↓
建立预防规则（Prevention Rule）
  ↓
存入错误记忆库
  ↓
下次相似场景 → 检索错误记忆 → 主动避免
```

---

## 一、错误记录系统

### 1.1 错误事件定义

```typescript
interface ErrorEvent {
  id: string;
  timestamp: number;

  // 错误分类
  category: 'code_bug' | 'wrong_command' | 'misunderstanding' | 'tool_misuse' | 'logic_error';

  // 错误详情
  error: {
    description: string;        // 错误描述
    symptom: string;            // 表现症状
    impact: 'critical' | 'major' | 'minor';  // 影响程度
    detectedBy: 'user_feedback' | 'tool_error' | 'self_check';  // 如何发现
  };

  // 上下文
  context: {
    task: string;               // 当前任务
    userInput: string;          // 用户输入
    assistantAction: string;    // 我的行为
    files: string[];            // 涉及的文件
    toolsUsed: string[];        // 使用的工具
    cwd: string;                // 工作目录
    projectType?: string;       // 项目类型
  };

  // 根本原因（分析后填充）
  rootCause?: {
    category: 'misunderstanding' | 'knowledge_gap' | 'logic_error' | 'context_missing';
    analysis: string;           // 详细分析
    confidence: number;         // 分析置信度
  };

  // 教训
  lesson?: {
    what: string;               // 学到了什么
    how: string;                // 如何避免
    when: string;               // 什么时候要警惕
  };

  // 预防规则
  preventionRule?: PreventionRule;

  // 验证状态
  verification: {
    fixed: boolean;             // 是否已修复
    verified: boolean;          // 是否已验证不再犯
    recurrenceCount: number;    // 复发次数（如果>0，说明规则无效）
  };

  // 向量表示（用于检索）
  embedding?: number[];
}
```

### 1.2 错误检测器（ErrorDetector）

```typescript
// src/learning/ErrorDetector.ts

export class ErrorDetector {
  /**
   * 在执行过程中检测错误
   */
  async detectErrors(interaction: Interaction): Promise<ErrorEvent[]> {
    const errors: ErrorEvent[] = [];

    // [1] 工具执行错误
    for (const toolCall of interaction.toolCalls) {
      if (toolCall.status === 'error') {
        errors.push(await this.createErrorFromToolFailure(toolCall, interaction));
      }
    }

    // [2] 用户负面反馈
    if (interaction.userFeedback && interaction.userFeedback.rating < 3) {
      errors.push(await this.createErrorFromFeedback(interaction));
    }

    // [3] 自检（静态分析生成的代码）
    if (this.containsCode(interaction.assistantResponse)) {
      const codeErrors = await this.checkGeneratedCode(interaction.assistantResponse);
      errors.push(...codeErrors);
    }

    // [4] 逻辑错误（用户纠正）
    if (this.isUserCorrection(interaction)) {
      errors.push(await this.createErrorFromCorrection(interaction));
    }

    return errors;
  }

  /**
   * 从工具失败创建错误事件
   */
  private async createErrorFromToolFailure(
    toolCall: ToolCall,
    interaction: Interaction
  ): Promise<ErrorEvent> {
    return {
      id: generateId(),
      timestamp: Date.now(),
      category: 'tool_misuse',

      error: {
        description: `${toolCall.name} 执行失败`,
        symptom: toolCall.error || '未知错误',
        impact: this.assessImpact(toolCall),
        detectedBy: 'tool_error',
      },

      context: {
        task: interaction.userInput,
        userInput: interaction.userInput,
        assistantAction: `Called ${toolCall.name} with ${JSON.stringify(toolCall.input)}`,
        files: this.extractFiles(interaction),
        toolsUsed: [toolCall.name],
        cwd: process.cwd(),
      },

      verification: {
        fixed: false,
        verified: false,
        recurrenceCount: 0,
      },
    };
  }

  /**
   * 检查生成的代码（静态分析）
   */
  private async checkGeneratedCode(code: string): Promise<ErrorEvent[]> {
    const errors: ErrorEvent[] = [];

    // 常见 bug 模式检测
    const bugPatterns = [
      {
        pattern: /console\.log\(/g,
        message: '包含调试代码（console.log）',
        category: 'code_bug' as const,
      },
      {
        pattern: /var\s+\w+/g,
        message: '使用了 var（应该用 let/const）',
        category: 'code_bug' as const,
      },
      {
        pattern: /==(?!=)/g,
        message: '使用了 ==（应该用 ===）',
        category: 'code_bug' as const,
      },
      {
        pattern: /\.then\(.*\)\.catch\(/g,
        message: 'Promise 未使用 async/await',
        category: 'code_bug' as const,
      },
    ];

    for (const { pattern, message, category } of bugPatterns) {
      if (pattern.test(code)) {
        errors.push({
          id: generateId(),
          timestamp: Date.now(),
          category,
          error: {
            description: message,
            symptom: '代码质量问题',
            impact: 'minor',
            detectedBy: 'self_check',
          },
          context: {
            task: '生成代码',
            userInput: '',
            assistantAction: code.slice(0, 200),
            files: [],
            toolsUsed: [],
            cwd: process.cwd(),
          },
          verification: {
            fixed: false,
            verified: false,
            recurrenceCount: 0,
          },
        });
      }
    }

    return errors;
  }
}
```

---

## 二、根因分析（Root Cause Analysis）

### 2.1 RCA 引擎

```typescript
// src/learning/RootCauseAnalyzer.ts

export class RootCauseAnalyzer {
  /**
   * 分析错误的根本原因
   */
  async analyze(errorEvent: ErrorEvent): Promise<RootCause> {
    const prompt = `
分析以下错误的根本原因：

错误类型: ${errorEvent.category}
错误描述: ${errorEvent.error.description}
症状: ${errorEvent.error.symptom}

上下文:
- 任务: ${errorEvent.context.task}
- 用户输入: ${errorEvent.context.userInput}
- 我的行为: ${errorEvent.context.assistantAction}
- 使用的工具: ${errorEvent.context.toolsUsed.join(', ')}

请回答（使用第一人称）：
1. 我为什么会犯这个错误？（根本原因）
2. 我缺少什么知识或理解？
3. 我下次如何避免？

返回 JSON 格式：
{
  "category": "misunderstanding|knowledge_gap|logic_error|context_missing",
  "analysis": "详细分析（第一人称，如：我误以为...）",
  "missingKnowledge": "缺少的知识（可选）",
  "preventionStrategy": "预防策略"
}
`;

    const response = await this.llm.generate(prompt);
    const result = JSON.parse(response.text);

    return {
      category: result.category,
      analysis: result.analysis,
      confidence: 0.8, // TODO: 评估分析质量
      missingKnowledge: result.missingKnowledge,
      preventionStrategy: result.preventionStrategy,
    };
  }

  /**
   * 提取教训（Lesson Learned）
   */
  async extractLesson(errorEvent: ErrorEvent, rootCause: RootCause): Promise<Lesson> {
    const prompt = `
从这次错误中，我应该学到什么教训？

错误: ${errorEvent.error.description}
根因: ${rootCause.analysis}

请用第一人称总结：
1. 我学到了什么？（简洁，一句话）
2. 我应该如何改变行为？
3. 什么情况下要特别警惕？

返回 JSON 格式：
{
  "what": "学到的教训（如：不要假设文件存在，先检查）",
  "how": "如何避免（如：使用工具前先用 Read 确认文件存在）",
  "when": "何时警惕（如：操作文件前）"
}
`;

    const response = await this.llm.generate(prompt);
    const lesson = JSON.parse(response.text);

    return lesson;
  }
}
```

### 2.2 预防规则生成器

```typescript
// src/learning/PreventionRuleGenerator.ts

interface PreventionRule {
  id: string;
  name: string;
  description: string;

  // 触发条件（什么情况下检查）
  trigger: {
    taskPattern?: RegExp;       // 任务模式（如 /编辑.*文件/）
    toolName?: string;           // 工具名称
    contextMatch?: string[];     // 上下文关键词
  };

  // 检查逻辑
  check: {
    type: 'pre_execution' | 'post_execution' | 'continuous';
    condition: string;           // 检查条件（伪代码或自然语言）
  };

  // 警告消息
  warning: string;

  // 自动修正（可选）
  autoFix?: {
    enabled: boolean;
    action: string;              // 修正行为
  };

  // 来源
  learnedFrom: string;           // ErrorEvent ID

  // 性能
  metrics: {
    triggeredCount: number;      // 触发次数
    preventedErrorCount: number; // 成功预防次数
    falsePositiveCount: number;  // 误报次数
  };
}

export class PreventionRuleGenerator {
  /**
   * 根据错误生成预防规则
   */
  async generateRule(
    errorEvent: ErrorEvent,
    rootCause: RootCause,
    lesson: Lesson
  ): Promise<PreventionRule> {
    const prompt = `
根据以下错误，生成一个预防规则：

错误: ${errorEvent.error.description}
教训: ${lesson.what}
避免方法: ${lesson.how}
警惕时机: ${lesson.when}

请设计一个预防规则：
1. 规则名称（简洁）
2. 触发条件（什么情况下检查）
3. 检查内容（检查什么）
4. 警告消息（如果检测到风险，提示什么）

返回 JSON 格式：
{
  "name": "规则名称",
  "description": "规则描述",
  "trigger": {
    "taskPattern": "任务模式（正则表达式字符串，如 '编辑.*文件'）",
    "toolName": "工具名（可选）",
    "contextMatch": ["关键词1", "关键词2"]
  },
  "checkCondition": "检查条件（自然语言描述）",
  "warning": "警告消息"
}
`;

    const response = await this.llm.generate(prompt);
    const result = JSON.parse(response.text);

    return {
      id: generateId(),
      name: result.name,
      description: result.description,

      trigger: {
        taskPattern: result.trigger.taskPattern
          ? new RegExp(result.trigger.taskPattern, 'i')
          : undefined,
        toolName: result.trigger.toolName,
        contextMatch: result.trigger.contextMatch,
      },

      check: {
        type: 'pre_execution',
        condition: result.checkCondition,
      },

      warning: result.warning,

      learnedFrom: errorEvent.id,

      metrics: {
        triggeredCount: 0,
        preventedErrorCount: 0,
        falsePositiveCount: 0,
      },
    };
  }
}
```

---

## 三、错误记忆检索（在行动前检查）

### 3.1 预防性检索器

```typescript
// src/learning/PreventiveRetriever.ts

export class PreventiveRetriever {
  /**
   * 在执行前检索相关的错误记忆
   */
  async checkBeforeAction(action: PlannedAction): Promise<ErrorWarning[]> {
    const warnings: ErrorWarning[] = [];

    // [1] 精确匹配：检查预防规则
    const rules = await this.preventionRuleStore.getAll();
    for (const rule of rules) {
      if (this.matchesTrigger(action, rule.trigger)) {
        // 执行检查
        const shouldWarn = await this.evaluateRule(rule, action);

        if (shouldWarn) {
          warnings.push({
            severity: 'high',
            source: 'prevention_rule',
            ruleId: rule.id,
            message: rule.warning,
            suggestedAction: rule.autoFix?.action,
          });

          // 更新指标
          rule.metrics.triggeredCount++;
          await this.preventionRuleStore.update(rule.id, rule);
        }
      }
    }

    // [2] 语义检索：查找相似错误
    const similarErrors = await this.findSimilarErrors(action);

    for (const error of similarErrors) {
      warnings.push({
        severity: error.error.impact === 'critical' ? 'high' : 'medium',
        source: 'past_error',
        errorId: error.id,
        message: `⚠️ 类似场景曾出错：${error.error.description}`,
        context: `上次错误原因：${error.rootCause?.analysis}`,
        suggestedAction: error.lesson?.how,
      });
    }

    return warnings;
  }

  /**
   * 查找相似错误（向量检索）
   */
  private async findSimilarErrors(action: PlannedAction): Promise<ErrorEvent[]> {
    // 构建查询文本
    const query = `
任务: ${action.task}
行为: ${action.description}
工具: ${action.toolName}
`;

    // 向量检索
    const embedding = await this.embeddingService.embed(query);
    const results = await this.errorMemoryStore.search(embedding, 5);

    // 过滤高相似度的错误（>0.8）
    return results.filter((r) => r.similarity > 0.8);
  }

  /**
   * 评估规则（使用 LLM 判断）
   */
  private async evaluateRule(
    rule: PreventionRule,
    action: PlannedAction
  ): Promise<boolean> {
    const prompt = `
预防规则: ${rule.name}
检查条件: ${rule.check.condition}

当前行为:
- 任务: ${action.task}
- 描述: ${action.description}
- 工具: ${action.toolName}
- 输入: ${JSON.stringify(action.input)}

请判断：当前行为是否触发了这个预防规则？

返回 JSON 格式：
{
  "shouldWarn": true/false,
  "reason": "判断理由"
}
`;

    const response = await this.llm.generate(prompt);
    const result = JSON.parse(response.text);

    return result.shouldWarn;
  }
}
```

### 3.2 集成到 AgentLoop

```typescript
// src/core/agent/AgentLoop.ts

export class AgentLoop {
  private preventiveRetriever: PreventiveRetriever;

  /**
   * 在执行工具前检查错误记忆
   */
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    // [1] 预防性检查
    const warnings = await this.preventiveRetriever.checkBeforeAction({
      task: this.currentTask,
      description: `Call ${toolCall.name}`,
      toolName: toolCall.name,
      input: toolCall.input,
    });

    // [2] 如果有高风险警告，询问用户或自动修正
    if (warnings.some((w) => w.severity === 'high')) {
      const highRiskWarnings = warnings.filter((w) => w.severity === 'high');

      // 显示警告
      this.ui.showWarning({
        title: '⚠️ 风险检测',
        message: highRiskWarnings.map((w) => w.message).join('\n'),
        suggestions: highRiskWarnings
          .filter((w) => w.suggestedAction)
          .map((w) => w.suggestedAction!),
      });

      // 自动修正（如果可用）
      const autoFixable = highRiskWarnings.find((w) => w.suggestedAction);
      if (autoFixable && this.config.autoFixErrors) {
        console.log(`[AutoFix] Applying: ${autoFixable.suggestedAction}`);
        // 执行修正逻辑
      } else {
        // 询问用户是否继续
        const shouldContinue = await this.ui.confirm(
          '检测到风险，是否继续执行？',
          false
        );

        if (!shouldContinue) {
          return {
            success: false,
            error: 'User aborted due to risk warning',
          };
        }
      }
    }

    // [3] 执行工具
    const result = await this.tool.execute(toolCall.input);

    // [4] 如果执行成功，更新预防规则指标（成功预防）
    if (result.success && warnings.length > 0) {
      for (const warning of warnings) {
        if (warning.source === 'prevention_rule' && warning.ruleId) {
          await this.preventionRuleStore.incrementMetric(
            warning.ruleId,
            'preventedErrorCount'
          );
        }
      }
    }

    // [5] 如果执行失败，记录新错误
    if (!result.success) {
      await this.errorDetector.recordError({
        category: 'tool_misuse',
        toolCall,
        result,
        context: this.getContext(),
      });

      // 如果是重复错误（相似度>0.95），标记为复发
      const similarError = await this.findMostSimilarError(toolCall);
      if (similarError && similarError.similarity > 0.95) {
        similarError.verification.recurrenceCount++;
        await this.errorMemoryStore.update(similarError.id, similarError);

        // 预防规则失效，降低权重
        if (similarError.preventionRule) {
          await this.preventionRuleStore.decreaseConfidence(
            similarError.preventionRule.id
          );
        }
      }
    }

    return result;
  }
}
```

---

## 四、错误验证与改进

### 4.1 验证器（确认不再犯错）

```typescript
// src/learning/ErrorVerifier.ts

export class ErrorVerifier {
  /**
   * 定期验证错误是否已修复
   */
  async verifyErrors(): Promise<VerificationReport> {
    const unverified = await this.errorMemoryStore.query({
      'verification.verified': false,
      'verification.fixed': true,
    });

    const report: VerificationReport = {
      total: unverified.length,
      verified: 0,
      stillFailing: 0,
      results: [],
    };

    for (const error of unverified) {
      // 创建测试场景（重现当时的上下文）
      const testScenario = this.createTestScenario(error);

      // 执行测试
      const result = await this.runTest(testScenario);

      if (result.success) {
        // 确认已修复
        error.verification.verified = true;
        await this.errorMemoryStore.update(error.id, error);

        report.verified++;
        report.results.push({
          errorId: error.id,
          status: 'verified',
          message: '已确认修复',
        });
      } else {
        // 仍然失败
        error.verification.recurrenceCount++;
        await this.errorMemoryStore.update(error.id, error);

        report.stillFailing++;
        report.results.push({
          errorId: error.id,
          status: 'still_failing',
          message: `仍然失败（第${error.verification.recurrenceCount}次）`,
        });

        // 需要重新分析
        await this.reanalyzeError(error);
      }
    }

    return report;
  }

  /**
   * 重新分析反复出现的错误
   */
  private async reanalyzeError(error: ErrorEvent): Promise<void> {
    const prompt = `
这个错误已经出现 ${error.verification.recurrenceCount} 次了：

错误: ${error.error.description}
之前的根因分析: ${error.rootCause?.analysis}
之前的预防规则: ${error.preventionRule?.description}

为什么预防规则没有效果？如何改进？

返回 JSON 格式：
{
  "whyFailed": "预防失败的原因",
  "improvedStrategy": "改进后的预防策略"
}
`;

    const response = await this.llm.generate(prompt);
    const analysis = JSON.parse(response.text);

    // 更新根因分析
    error.rootCause = {
      ...error.rootCause!,
      analysis: analysis.whyFailed,
    };

    // 生成新的预防规则
    const newRule = await this.preventionRuleGenerator.generateImprovedRule(
      error,
      analysis.improvedStrategy
    );

    error.preventionRule = newRule;

    await this.errorMemoryStore.update(error.id, error);
  }
}
```

---

## 五、用户界面

### 5.1 错误记忆浏览器

```typescript
// desktop/renderer/views/ErrorMemoryBrowser.tsx

export default function ErrorMemoryBrowser() {
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [filter, setFilter] = useState<ErrorFilter>({
    category: 'all',
    verified: 'all',
    severity: 'all',
  });

  useEffect(() => {
    loadErrors();
  }, [filter]);

  const loadErrors = async () => {
    const result = await window.electron.errorMemorySearch(filter);
    setErrors(result.errors);
  };

  return (
    <div className="error-memory-browser">
      <h2>🐛 错误记忆库</h2>

      {/* 统计面板 */}
      <div className="stats-panel">
        <StatCard label="总错误数" value={errors.length} />
        <StatCard
          label="已修复"
          value={errors.filter((e) => e.verification.fixed).length}
          color="green"
        />
        <StatCard
          label="未修复"
          value={errors.filter((e) => !e.verification.fixed).length}
          color="red"
        />
        <StatCard
          label="复发错误"
          value={errors.filter((e) => e.verification.recurrenceCount > 0).length}
          color="orange"
        />
      </div>

      {/* 过滤器 */}
      <FilterBar value={filter} onChange={setFilter} />

      {/* 错误列表 */}
      <div className="error-list">
        {errors.map((error) => (
          <ErrorCard
            key={error.id}
            error={error}
            onClick={() => openErrorDetail(error.id)}
          />
        ))}
      </div>
    </div>
  );
}

// 错误卡片组件
function ErrorCard({ error, onClick }: { error: ErrorEvent; onClick: () => void }) {
  return (
    <div className={`error-card severity-${error.error.impact}`} onClick={onClick}>
      {/* 头部 */}
      <div className="header">
        <span className="category-badge">{getCategoryIcon(error.category)}</span>
        <span className="description">{error.error.description}</span>
        <span className="timestamp">{formatDate(error.timestamp)}</span>
      </div>

      {/* 状态 */}
      <div className="status">
        {error.verification.fixed ? (
          <span className="badge badge-success">✅ 已修复</span>
        ) : (
          <span className="badge badge-danger">❌ 未修复</span>
        )}

        {error.verification.verified && (
          <span className="badge badge-info">✓ 已验证</span>
        )}

        {error.verification.recurrenceCount > 0 && (
          <span className="badge badge-warning">
            ⚠️ 复发 {error.verification.recurrenceCount} 次
          </span>
        )}
      </div>

      {/* 教训（如果有） */}
      {error.lesson && (
        <div className="lesson">
          <strong>💡 教训：</strong>
          {error.lesson.what}
        </div>
      )}

      {/* 预防规则（如果有） */}
      {error.preventionRule && (
        <div className="prevention-rule">
          <strong>🛡️ 预防规则：</strong>
          {error.preventionRule.name}
          <span className="metrics">
            （触发 {error.preventionRule.metrics.triggeredCount} 次，预防{' '}
            {error.preventionRule.metrics.preventedErrorCount} 次）
          </span>
        </div>
      )}
    </div>
  );
}
```

### 5.2 错误详情与分析

```typescript
// desktop/renderer/views/ErrorDetail.tsx

export default function ErrorDetail({ errorId }: { errorId: string }) {
  const [error, setError] = useState<ErrorEvent | null>(null);

  useEffect(() => {
    loadError();
  }, [errorId]);

  const loadError = async () => {
    const result = await window.electron.errorMemoryGet(errorId);
    setError(result.error);
  };

  if (!error) return <div>Loading...</div>;

  return (
    <div className="error-detail">
      <h2>错误详情</h2>

      {/* 基本信息 */}
      <Section title="基本信息">
        <InfoRow label="类型" value={error.category} />
        <InfoRow label="描述" value={error.error.description} />
        <InfoRow label="症状" value={error.error.symptom} />
        <InfoRow label="影响程度" value={error.error.impact} />
        <InfoRow label="发现方式" value={error.error.detectedBy} />
        <InfoRow label="时间" value={formatDate(error.timestamp)} />
      </Section>

      {/* 上下文 */}
      <Section title="上下文">
        <InfoRow label="任务" value={error.context.task} />
        <InfoRow label="用户输入" value={error.context.userInput} />
        <InfoRow label="我的行为" value={error.context.assistantAction} />
        <InfoRow label="使用的工具" value={error.context.toolsUsed.join(', ')} />
        <InfoRow label="工作目录" value={error.context.cwd} />
        {error.context.files.length > 0 && (
          <InfoRow label="涉及文件" value={error.context.files.join(', ')} />
        )}
      </Section>

      {/* 根因分析 */}
      {error.rootCause && (
        <Section title="根本原因">
          <div className="root-cause-analysis">
            <div className="category">
              <strong>类别：</strong>
              {getRootCauseLabel(error.rootCause.category)}
            </div>
            <div className="analysis">
              <strong>分析：</strong>
              <p>{error.rootCause.analysis}</p>
            </div>
            {error.rootCause.missingKnowledge && (
              <div className="missing-knowledge">
                <strong>缺少的知识：</strong>
                <p>{error.rootCause.missingKnowledge}</p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 教训 */}
      {error.lesson && (
        <Section title="教训">
          <div className="lesson-learned">
            <LessonItem label="学到了什么" value={error.lesson.what} icon="💡" />
            <LessonItem label="如何避免" value={error.lesson.how} icon="🔧" />
            <LessonItem label="何时警惕" value={error.lesson.when} icon="⚠️" />
          </div>
        </Section>
      )}

      {/* 预防规则 */}
      {error.preventionRule && (
        <Section title="预防规则">
          <PreventionRuleCard rule={error.preventionRule} />
        </Section>
      )}

      {/* 验证状态 */}
      <Section title="验证状态">
        <div className="verification-status">
          <StatusBadge label="已修复" value={error.verification.fixed} />
          <StatusBadge label="已验证" value={error.verification.verified} />
          <InfoRow label="复发次数" value={error.verification.recurrenceCount} />
        </div>
      </Section>

      {/* 操作按钮 */}
      <div className="actions">
        <button onClick={() => markAsFixed(error.id)}>标记为已修复</button>
        <button onClick={() => runVerification(error.id)}>运行验证</button>
        <button onClick={() => deleteError(error.id)}>删除</button>
      </div>
    </div>
  );
}
```

---

## 六、实际案例演示

### 案例 1: Bug 记忆与预防

**第一次犯错（Day 1）**：

```
用户: "帮我修改 src/utils.ts 中的 formatDate 函数"

我: [使用 Edit 工具，但文件路径写错了 src/util.ts]

系统: ❌ Error: File not found: src/util.ts

[ErrorDetector 检测到错误]
→ 记录 ErrorEvent:
  - category: 'tool_misuse'
  - description: '文件路径错误'
  - context: { task: '修改文件', toolName: 'Edit', ... }

[RootCauseAnalyzer 分析]
→ rootCause:
  - category: 'logic_error'
  - analysis: '我假设文件名是 util.ts，但实际是 utils.ts（多了s）'

[提取教训]
→ lesson:
  - what: '不要假设文件名，先确认文件存在'
  - how: '使用 Edit 前先用 Read 或 Glob 确认文件路径'
  - when: '操作文件前'

[生成预防规则]
→ preventionRule:
  - name: '文件操作前检查文件存在性'
  - trigger: { toolName: 'Edit' }
  - check: '检查文件是否存在'
  - warning: '⚠️ 建议先用 Read 确认文件路径'
```

**第二次遇到相似场景（Day 3）**：

```
用户: "修改 src/components/Header.tsx"

[PreventiveRetriever 检索]
→ 匹配到预防规则：'文件操作前检查文件存在性'

[AgentLoop 在执行前检查]
→ 显示警告：
  ⚠️ 风险检测
  建议先用 Read 确认文件路径

  相似错误记录：曾因文件路径错误失败（Day 1）
  教训：不要假设文件名，先确认文件存在

我: [调整策略]
  1. 先使用 Glob 查找: src/components/Header.*
  2. 确认文件存在后，再使用 Edit

结果: ✅ 成功，避免了重复错误

[更新预防规则指标]
→ preventedErrorCount++
```

### 案例 2: 逻辑错误记忆

**第一次犯错（Day 5）**：

```
用户: "写一个函数判断数组是否为空"

我生成的代码:
```typescript
function isEmpty(arr) {
  return arr.length === 0;
}
```

用户: "❌ 这个函数有 bug，如果传入 null 会报错"

[ErrorDetector 检测]
→ category: 'code_bug'
→ description: '未处理 null 情况'

[RootCauseAnalyzer]
→ rootCause: '我没有考虑边界情况（null、undefined）'

[教训]
→ lesson.what: '处理数组前要先检查 null/undefined'

[预防规则]
→ name: '数组操作前检查 null'
→ trigger: { taskPattern: /数组|array/ }
→ check: '生成的代码是否检查了 null/undefined'
```

**第二次写数组操作代码（Day 7）**：

```
用户: "写一个函数查找数组中的最大值"

[PreventiveRetriever]
→ 检索到相似错误：数组操作未检查 null

我生成的代码（改进后）:
```typescript
function findMax(arr) {
  if (!arr || arr.length === 0) {
    return null;
  }
  return Math.max(...arr);
}
```

结果: ✅ 用户满意，成功应用教训
```

---

## 七、实施计划

### Phase 1: 基础错误记录（2周）

- [ ] ErrorDetector - 检测错误（工具失败、用户反馈）
- [ ] ErrorEvent 数据模型
- [ ] 错误记忆存储（SQLite + 向量索引）
- [ ] 基础 UI（查看错误列表）

**验证**：能记录所有错误，并保存到数据库

### Phase 2: 根因分析与教训提取（2周）

- [ ] RootCauseAnalyzer - LLM 分析根本原因
- [ ] LessonExtractor - 提取教训
- [ ] PreventionRuleGenerator - 生成预防规则
- [ ] 错误详情 UI

**验证**：每个错误都有根因分析和教训

### Phase 3: 预防性检索（2-3周）

- [ ] PreventiveRetriever - 行动前检索相似错误
- [ ] 集成到 AgentLoop（执行前检查）
- [ ] 警告 UI（风险提示）
- [ ] 预防规则触发统计

**验证**：相似场景能检索到历史错误，成功预防

### Phase 4: 验证与改进（1-2周）

- [ ] ErrorVerifier - 定期验证错误是否修复
- [ ] 复发错误重新分析
- [ ] 预防规则效果评估
- [ ] 完整的错误管理 UI

**验证**：能确认错误已修复，复发错误能重新优化

---

## 总结

### 核心机制

1. **错误检测** - 多维度检测（工具失败、用户反馈、自检）
2. **根因分析** - LLM 深度分析为什么会犯错
3. **教训提取** - 将错误转化为可学习的知识
4. **预防规则** - 自动生成预防逻辑
5. **预防性检索** - 行动前检索相似错误
6. **验证改进** - 确认错误已修复，复发时重新优化

### 与人类学习的对比

| 人类 | Xuanji 错误记忆系统 |
|------|-------------------|
| 被烫一次，记住"火=危险" | 记录错误事件 + 根因分析 |
| 下次看到火，自动警惕 | 预防性检索 + 警告提示 |
| 触类旁通（火→热水→电） | 语义相似度检索（举一反三） |
| 反复犯错会加深记忆 | 复发错误重新分析，优化预防规则 |
| 验证自己改正了 | 错误验证机制 |

### 预期效果

**1 个月后**：
- ✅ 记录 50+ 错误
- ✅ 生成 20+ 预防规则
- ✅ 成功预防 10+ 重复错误

**3 个月后**：
- ✅ 错误率下降 40%+
- ✅ 大部分常见错误有预防规则
- ✅ 相似错误不再重犯

**6 个月后**：
- ✅ 像经验丰富的开发者一样，很少犯低级错误
- ✅ 形成完善的错误知识库
- ✅ 主动预防能力强

---

**这个错误记忆系统与之前的"记忆质量控制"、"自我学习系统"完全兼容，可以无缝集成。需要我现在开始实施 Phase 1 吗？**
