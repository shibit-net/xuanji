// ============================================================
// M5 记忆系统 — MemoryFlushAgent（记忆刷新 Agent）
// ============================================================
//
// 基于 SubAgentLoop 的 Agent 实现，负责：
// 1. 分析对话上下文，通过 memory-extractor SubAgent 提取值得记忆的信息
// 2. 总结经验教训（错误方案→改进、优秀方案→复用）
// 3. 退出时强制刷新所有未记忆的上下文
// 4. 启动时根据历史记忆生成引导消息
//

import type { Message } from '@/core/types';
import type { MemoryEntry, MemoryEntryType, MemoryCategory, MemoryScope, MemoryVolatility } from './types';
import type { MemoryManager } from './MemoryManager';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-flush-agent' });

// ─── 类型定义 ────────────────────────────────────────────

/** 刷新结果 */
export interface FlushResult {
  processedMessages: number;
  extractedMemories: number;
  extractedLessons: number;
  summary: string;
  keyPoints: string[];
  duration: number;
}

/** 启动引导结果 */
export interface BootGuideResult {
  hasGuide: boolean;
  guideMessage: string;
  memories: MemoryEntry[];
  lastWorkSummary?: string;
}

/** LLM 提取的原始结果（M5 完整格式） */
interface ExtractionResult {
  worthMemorizing?: boolean;
  summary: string;
  keyPoints: string[];
  memories: Array<{
    type?: string;
    category?: string;
    content: string;
    keywords?: string[];
    confidence?: number;
    // M5 字段
    scope?: string;
    volatility?: string;
    significance?: number;
    categoryLabel?: string;
    isCoreRule?: boolean;
    coreRuleCategory?: string;
  }>;
  lessons: Array<{
    lessonType: 'mistake' | 'improvement' | 'best_practice';
    content: string;
    problemDescription?: string;
    solution?: string;
    applicableScenarios?: string[];
    keywords?: string[];
    confidence?: number;
  }>;
  /** 成功完成的任务模式（可复用经验） */
  successfulPatterns: Array<{
    problem: string;
    solution: string;
    keyPoints: string[];
    applicableScenarios: string[];
    confidence?: number;
  }>;
  /** 未完成的任务（会话结束时仍挂起） */
  unfinishedTasks: Array<{
    subject: string;
    completedSteps: string[];
    remainingSteps: string[];
    userInput?: string;
  }>;
}

// ─── MemoryFlushAgent ────────────────────────────────────

export class MemoryFlushAgent {
  private memoryManager: MemoryManager;
  private subAgentFactory: SubAgentFactory;
  private flushing = false;

  constructor(opts: {
    subAgentFactory: SubAgentFactory;
    memoryManager: MemoryManager;
  }) {
    this.subAgentFactory = opts.subAgentFactory;
    this.memoryManager = opts.memoryManager;
  }

  // ─── 退出时强制刷新 ──────────────────────────────────

  /**
   * 强制刷新所有未记忆的上下文（退出时调用）
   *
   * 使用 SubAgentLoop 运行独立的记忆提取 Agent：
   * - 不检查触发条件，直接执行
   * - 处理所有消息
   * - 提取记忆 + 经验教训
   * - 超时保护（最多 30 秒）
   */
  async flushOnExit(messages: Message[], sessionId?: string): Promise<FlushResult> {
    if (this.flushing) {
      log.warn('flushOnExit skipped: already flushing (concurrent call detected)');
      return this.emptyResult();
    }
    this.flushing = true;
    const startTime = Date.now();

    try {
      const contextMessages = messages.filter(m => m.role !== 'system');
      if (contextMessages.length === 0) {
        return this.emptyResult();
      }

      // 过滤无意义会话：总文本量太少（< 100 字符）说明只有问候语等，不值得提取
      const totalText = contextMessages.map(m => this.extractText(m)).join('');
      if (totalText.length < 100) {
        log.debug('Session too short to extract memories, skipping flush');
        return this.emptyResult();
      }

      log.info(`Flushing ${contextMessages.length} messages on exit via SubAgent`);

      // 构建对话文本
      const conversation = this.formatConversation(contextMessages);

      // 通过 SubAgentLoop 运行记忆提取
      const result = await Promise.race([
        this.runExtractionAgent(conversation, sessionId),
        this.timeoutFallback(contextMessages, 30_000),
      ]);

      const duration = Date.now() - startTime;
      log.info(`Exit flush completed in ${duration}ms: ${result.extractedMemories} memories, ${result.extractedLessons} lessons`);

      return { ...result, duration };
    } catch (err) {
      log.warn('Exit flush failed:', err);
      return this.saveFallbackSummary(messages, sessionId, Date.now() - startTime);
    } finally {
      this.flushing = false;
    }
  }

  // ─── SubAgent 执行 ──────────────────────────────────

  /**
   * 运行记忆提取 SubAgent
   */
  private async runExtractionAgent(
    conversation: string,
    sessionId?: string,
  ): Promise<Omit<FlushResult, 'duration'>> {
    if (!this.subAgentFactory) {
      throw new Error('SubAgentFactory is required for memory extraction');
    }

    const task = this.buildExtractionTask(conversation);

    // 统一使用 SubAgentFactory（agent 使用自己配置的独立 provider）
    const result = await this.subAgentFactory.createAndRun('memory-extractor', {
      task,
      depth: 1,
      timeout: 25_000,
    });

    // 解析 SubAgent 输出
    const extracted = this.parseExtractionResult(result.result);

    // 保存到记忆系统
    const savedCount = await this.saveExtractedMemories(extracted, sessionId);
    const lessonCount = await this.saveExtractedLessons(extracted, sessionId);
    await this.saveSuccessfulPatterns(extracted, sessionId);
    await this.saveUnfinishedTasks(extracted, sessionId);

    return {
      processedMessages: 0, // 由调用方设置
      extractedMemories: savedCount,
      extractedLessons: lessonCount,
      summary: extracted.summary,
      keyPoints: extracted.keyPoints,
    };
  }

  // ─── 记忆保存 ──────────────────────────────────────

  /**
   * 保存提取的记忆条目
   */
  private async saveExtractedMemories(extracted: ExtractionResult, sessionId?: string): Promise<number> {
    let savedCount = 0;
    const now = new Date().toISOString();
    const dayKey = now.split('T')[0];

    // 保存会话摘要
    if (extracted.summary) {
      try {
        await this.memoryManager.add({
          type: 'session_summary',
          category: 'timeline',
          content: extracted.summary,
          keywords: extracted.keyPoints.slice(0, 5),
          source: 'memory-flush-agent',
          confidence: 0.9,
          dayKey,
          sessionId,
        });
        savedCount++;
      } catch (err) {
        log.warn('Failed to save session summary:', err);
      }
    }

    // 保存记忆条目
    for (const memory of extracted.memories) {
      try {
        await this.memoryManager.add({
          type: (memory.type as MemoryEntryType) || 'session_summary',
          category: (memory.category as MemoryCategory) || 'topic',
          content: memory.content,
          keywords: memory.keywords || [],
          source: 'memory-flush-agent',
          confidence: memory.confidence || 0.8,
          dayKey,
          sessionId,
          // M5 字段透传
          scope: memory.scope as MemoryScope | undefined,
          volatility: memory.volatility as MemoryVolatility | undefined,
          significance: memory.significance,
          categoryLabel: memory.categoryLabel,
        });
        savedCount++;
      } catch (err) {
        log.warn('Failed to save memory entry:', err);
      }
    }

    return savedCount;
  }

  /**
   * 保存提取的经验教训
   */
  private async saveExtractedLessons(extracted: ExtractionResult, sessionId?: string): Promise<number> {
    let savedCount = 0;
    const now = new Date().toISOString();
    const dayKey = now.split('T')[0];

    for (const lesson of extracted.lessons) {
      try {
        const type: MemoryEntryType = lesson.lessonType === 'best_practice'
          ? 'reusable_pattern'
          : 'lesson_learned';

        await this.memoryManager.add({
          type,
          category: 'lesson' as MemoryCategory,
          content: lesson.content,
          keywords: lesson.keywords || [],
          source: 'memory-flush-agent',
          confidence: lesson.confidence || 0.85,
          dayKey,
          sessionId,
          lessonType: lesson.lessonType,
          problemDescription: lesson.problemDescription,
          solution: lesson.solution,
          applicableScenarios: lesson.applicableScenarios,
        });
        savedCount++;
      } catch (err) {
        log.warn('Failed to save lesson:', err);
      }
    }

    return savedCount;
  }

  /**
   * 保存成功经验模式（reusable_pattern）
   */
  private async saveSuccessfulPatterns(extracted: ExtractionResult, sessionId?: string): Promise<number> {
    let savedCount = 0;
    const now = new Date().toISOString();
    const dayKey = now.split('T')[0];

    for (const pattern of extracted.successfulPatterns || []) {
      try {
        const content = `${pattern.problem}\n解决方案：${pattern.solution}\n关键点：${pattern.keyPoints?.join('、') || ''}`;
        await this.memoryManager.add({
          type: 'reusable_pattern',
          category: 'lesson' as MemoryCategory,
          content,
          keywords: [...(pattern.keyPoints || []), ...(pattern.applicableScenarios || [])].slice(0, 6),
          source: 'memory-flush-agent',
          confidence: pattern.confidence || 0.88,
          dayKey,
          sessionId,
          lessonType: 'best_practice',
          solution: pattern.solution,
          applicableScenarios: pattern.applicableScenarios,
        });
        savedCount++;
      } catch (err) {
        log.warn('Failed to save successful pattern:', err);
      }
    }

    return savedCount;
  }

  /**
   * 保存未完成任务（unfinished_task）
   */
  private async saveUnfinishedTasks(extracted: ExtractionResult, sessionId?: string): Promise<number> {
    let savedCount = 0;
    const now = new Date().toISOString();
    const dayKey = now.split('T')[0];

    for (const task of extracted.unfinishedTasks || []) {
      try {
        const remainingStr = task.remainingSteps?.join('、') || '';
        const completedStr = task.completedSteps?.length
          ? `已完成：${task.completedSteps.join('、')}；` : '';
        const content = `${completedStr}待继续：${task.subject}${remainingStr ? `（剩余步骤：${remainingStr}）` : ''}`;

        await this.memoryManager.add({
          type: 'unfinished_task',
          category: 'timeline' as MemoryCategory,
          content,
          keywords: [task.subject.slice(0, 20)],
          source: 'memory-flush-agent',
          confidence: 0.9,
          dayKey,
          sessionId,
          taskContext: {
            userInput: task.userInput,
            completedSteps: task.completedSteps || [],
            remainingSteps: task.remainingSteps || [],
          },
        });
        savedCount++;
      } catch (err) {
        log.warn('Failed to save unfinished task:', err);
      }
    }

    return savedCount;
  }

  // ─── Prompt 构建 ──────────────────────────────────

  /**
   * 构建记忆提取任务 Prompt
   */
  private buildExtractionTask(conversation: string): string {
    return `你是记忆管理 Agent。分析以下对话，完成两项任务：

## 任务 1：提取值得记忆的信息
只提取有长期复用价值的信息。**跳过**：问候语、工具调用输出、一次性临时请求、代码片段本身。

先判断 worthMemorizing（快速评估）：
- false：纯技术问答、代码片段、一次性请求 → 直接返回空 decisions
- true：有用户事实/偏好/决策/经验教训等长期价值信息

---

## 记忆架构（M5 五层）

记忆分三个层级（scope），决定衰减速度和检索优先级：
- **profile**：关于用户本身的事实，极慢衰减（半衰期 180-365 天）
- **knowledge**：经验教训、领域知识，慢衰减（半衰期 90-180 天）
- **episode**：具体事件、会话摘要，正常衰减（半衰期 14-60 天）

时效性（volatility）决定半衰期：
- **permanent**：永不衰减（重要日期、用户底线规则）
- **stable**：极慢衰减（用户基本信息、长期偏好）
- **normal**：正常衰减（技术决策、经验教训）
- **transient**：快速衰减（会话摘要、临时任务）

---

## 记忆类型完整定义

### ▸ user_fact（用户事实）
关于用户本人或其重要关系人的**永久性事实**，不随时间过期。
- ✓ 包括：用户的职业、居住地、兴趣爱好、拥有的物品；关系人的姓名、生日、外貌特征
- ✓ 示例："用户是后端工程师，在上海工作" / "用户有一辆坦克车（59式）" / "用户女朋友叫艾琳娜，生日3月25日"
- ✗ 不包括：临时约会计划（→ important_date）；用户对工具的偏好（→ user_preference）
- **scope**: profile, **volatility**: stable, **category**: fact

### ▸ user_preference（用户偏好）
用户对工具、技术、风格、工作方式的**持续性偏好和习惯**。
- ✓ 包括：编程语言偏好、代码风格要求、工作习惯、沟通偏好
- ✓ 示例："用户偏好简洁代码，不喜欢过度注释" / "用户习惯先讨论方案再动手"
- ✗ 不包括：客观事实（→ user_fact）；一次性的具体请求
- **scope**: profile, **volatility**: stable, **category**: topic

### ▸ relationship（人际关系背景）
补充描述用户与他人的关系特征、互动模式，**不包含基本信息**（基本信息在 user_fact）。
- ✓ 包括：关系性质说明（朋友/同事/客户）、关系人的特点、互动历史
- ✓ 示例："同事 Bob 负责前端，经常一起协作" / "客户李总对交付时间非常敏感"
- ✗ 不包括：关系人的姓名/生日（→ user_fact，合并记录）
- **scope**: profile, **volatility**: stable, **category**: topic

### ▸ important_date（重要日期事件）
**与具体日期绑定的待办或计划**，具有时效性。
- ✓ 包括：约会计划、截止日期、需要在某天完成的任务、待准备的事项
- ✓ 示例："3月25日需要给艾琳娜准备生日礼物" / "下周三与客户开评审会" / "月底前完成 API 文档"
- ✗ 不包括：生日本身（→ user_fact）；没有具体时间的计划（→ decision）
- **scope**: profile, **volatility**: permanent, **category**: timeline

### ▸ project_fact（项目技术事实）
项目的**客观技术信息**，长期有效。
- ✓ 包括：技术栈/框架/版本、服务端口、数据库配置、目录结构约定、构建方式
- ✓ 示例："xuanji 使用 TypeScript + Ink 5，运行在 Node.js 20+" / "shibit-starship 监听 7101 端口"
- ✗ 不包括：用户对项目的态度偏好（→ user_preference）；临时决定（→ decision）
- **scope**: knowledge, **volatility**: normal, **category**: topic

### ▸ decision（决策）
用户在本次会话中做出的**明确技术选择或方向决定**，影响后续工作。
- ✓ 包括：技术方案选择、架构决策、放弃某方案的原因
- ✓ 示例："决定用 JSONL 存储记忆（考虑简单性，而非 SQLite）" / "放弃全量工具传递，改用动态过滤"
- ✗ 不包括：长期偏好（→ user_preference）；已成定论的技术事实（→ project_fact）
- **scope**: knowledge, **volatility**: normal, **category**: topic

### ▸ tool_pattern（工具使用模式）
用户使用特定工具/命令的**特定方式或习惯**。
- ✓ 包括：常用命令组合、工具配置偏好、特殊的使用技巧
- ✓ 示例："用 git rebase -i 整理提交，而非 merge" / "用 tsx watch 启动开发服务器"
- ✗ 不包括：工具相关错误（→ error_resolution）；架构决策（→ decision）
- **scope**: knowledge, **volatility**: normal, **category**: topic

### ▸ error_resolution（错误解决方案）
遇到的**具体问题及其解决方法**，下次遇到同类问题可复用。
- ✓ 包括：报错信息→原因→解决步骤；踩坑记录
- ✓ 示例："TS strict 模式下 Map.get() 返回 T|undefined，需非空断言处理" / "Electron IPC 对象需可序列化，class 实例会丢失方法"
- **scope**: knowledge, **volatility**: normal, **category**: lesson

### ▸ lesson_learned（经验教训）
从失败/改进中总结的**规律性认知**，比 error_resolution 更抽象。
- ✓ 包括：做错了的决策及原因分析、可避免的设计陷阱
- ✓ 示例："过早优化导致复杂度急剧上升，应先完成功能再优化" / "不该用 global state 管理 UI 临时状态"
- **scope**: knowledge, **volatility**: normal, **category**: lesson

### ▸ reusable_pattern（可复用方案）
总结出的**可在多个场景复用的优秀实现模式**。
- ✓ 包括：设计模式具体应用、通用解决方案模板、最佳实践
- ✓ 示例："SubAgentContext 隔离子任务：独立上下文→限制工具→超时保护" / "React 更新用 setState(prev=>) 避免闭包陷阱"
- **scope**: knowledge, **volatility**: normal, **category**: lesson

### ▸ domain_knowledge（领域知识）
从多次情节提炼的领域知识，比单次经验更抽象。
- ✓ 包括：某领域的通用规律、技术原理、设计哲学
- ✓ 示例："React Hooks 依赖数组必须包含所有外部变量，否则闭包陷阱" / "Docker 多阶段构建可减小镜像体积"
- **scope**: knowledge, **volatility**: normal, **category**: topic

### ▸ agent_knowledge（Agent 专属知识）
AI Agent 执行任务时积累的**特定领域知识**。
- ✓ 包括：某类任务的执行规律、工具隐含限制、API 特殊行为
- ✓ 示例："Anthropic tool_result 必须紧跟 tool_use，否则报错"
- **scope**: knowledge, **volatility**: normal, **category**: topic

### ▸ session_summary（会话摘要）
本次会话主题和结果的概述，由系统自动生成，**不要在 memories 数组中创建**。

---

## 任务 2：总结经验教训
识别对话中的：
- **mistake**：方案错误或走了弯路，需要改正
- **improvement**：发现了比原方案更好的做法
- **best_practice**：值得复用的优秀实现

## 任务 3：提取成功经验模式
识别对话中**完整完成的任务**（有明确的成功结果）：
- 提炼"问题 → 解决步骤 → 成功"的可复用模式
- 不要提取简单的单步操作，重点是有价值的多步骤解决方案
- 示例：修复了一个复杂 Bug、完成了一次完整部署、解决了性能问题

## 任务 4：识别未完成任务
识别对话结束时**仍未完成**的任务（仅当对话被中断或明确未完成时）：
- 用户发起但 Agent 未完成的请求
- 对话中明确提到"稍后继续"、"下次再做"的事项
- todo_create 创建后未被 todo_update 标记为 completed 的任务
- **不包括**：成功完成的任务、用户主动放弃的任务

---

## 对话内容
${conversation}

---

## 输出格式（JSON）
\`\`\`json
{
  "worthMemorizing": true,
  "summary": "一句话概括本次对话的主题和结果",
  "keyPoints": ["关键点1", "关键点2"],
  "memories": [
    {
      "type": "user_fact|user_preference|relationship|important_date|project_fact|decision|tool_pattern|error_resolution|lesson_learned|reusable_pattern|domain_knowledge|agent_knowledge",
      "category": "fact|topic|timeline|lesson",
      "content": "简洁的事实陈述，不超过100字，独立可理解",
      "keywords": ["关键词1", "关键词2"],
      "confidence": 0.8,
      "scope": "profile|knowledge|episode",
      "volatility": "permanent|stable|normal|transient",
      "significance": 0.8,
      "categoryLabel": "用户/工具偏好",
      "isCoreRule": false,
      "coreRuleCategory": null
    }
  ],
  "lessons": [
    {
      "lessonType": "mistake|improvement|best_practice",
      "content": "经验教训的简洁描述",
      "problemDescription": "遇到的问题（mistake/improvement 填写）",
      "solution": "解决方案或改进方法",
      "applicableScenarios": ["适用场景"],
      "keywords": ["关键词"],
      "confidence": 0.85
    }
  ],
  "successfulPatterns": [
    {
      "problem": "解决了什么问题",
      "solution": "详细的解决步骤（按顺序列出）",
      "keyPoints": ["成功关键点1", "成功关键点2"],
      "applicableScenarios": ["适用场景"],
      "confidence": 0.9
    }
  ],
  "unfinishedTasks": [
    {
      "subject": "未完成任务的标题",
      "completedSteps": ["已完成的步骤"],
      "remainingSteps": ["还需要做的步骤"],
      "userInput": "用户原始请求（简短）"
    }
  ]
}
\`\`\`

## 强制规则
1. summary 必填
2. 同一关系人的姓名+生日+关系合并为**一条** user_fact，不拆分
3. 生日本身 → user_fact；"X月X日要准备礼物" → important_date
4. 长期不变的技术事实 → project_fact；当次做的选择 → decision
5. 只记录有长期价值的信息，跳过工具调用输出、代码片段、一次性问候
6. lessons 聚焦：错误→正确、性能优化、架构决策
7. 如无经验教训，lessons 返回空数组
8. 如无成功经验模式，successfulPatterns 返回空数组
9. 如无未完成任务，unfinishedTasks 返回空数组
10. unfinishedTasks 只记录真正未完成的任务，不要记录已完成的`;
  }

  // ─── 解析和降级 ──────────────────────────────────

  /**
   * 解析 SubAgent 输出
   */
  private parseExtractionResult(response: string): ExtractionResult {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
        ?? response.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        return { summary: '', keyPoints: [], memories: [], lessons: [], successfulPatterns: [], unfinishedTasks: [] };
      }

      const parsed = JSON.parse(jsonMatch[1]!);
      return {
        summary: parsed.summary || '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
        successfulPatterns: Array.isArray(parsed.successfulPatterns) ? parsed.successfulPatterns : [],
        unfinishedTasks: Array.isArray(parsed.unfinishedTasks) ? parsed.unfinishedTasks : [],
      };
    } catch {
      log.warn('Failed to parse extraction result');
      return { summary: '', keyPoints: [], memories: [], lessons: [], successfulPatterns: [], unfinishedTasks: [] };
    }
  }

  /**
   * 超时降级
   */
  private timeoutFallback(
    messages: Message[],
    timeoutMs: number,
  ): Promise<Omit<FlushResult, 'duration'>> {
    return new Promise((resolve) => {
      setTimeout(() => {
        log.warn(`SubAgent timed out after ${timeoutMs}ms, using fallback`);
        resolve({
          processedMessages: messages.length,
          extractedMemories: 0,
          extractedLessons: 0,
          summary: this.buildRuleSummary(messages),
          keyPoints: [],
        });
      }, timeoutMs);
    });
  }

  /**
   * 降级保存
   */
  private async saveFallbackSummary(
    messages: Message[],
    sessionId: string | undefined,
    duration: number,
  ): Promise<FlushResult> {
    const summary = this.buildRuleSummary(messages);
    const dayKey = new Date().toISOString().split('T')[0];

    try {
      await this.memoryManager.add({
        type: 'session_summary',
        category: 'timeline',
        content: summary,
        keywords: [],
        source: 'memory-flush-agent-fallback',
        confidence: 0.6,
        dayKey,
        sessionId,
      });
      return { processedMessages: messages.length, extractedMemories: 1, extractedLessons: 0, summary, keyPoints: [], duration };
    } catch {
      return this.emptyResult(duration);
    }
  }

  // ─── 工具方法 ──────────────────────────────────────

  private buildRuleSummary(messages: Message[]): string {
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => this.extractText(m))
      .filter(Boolean);

    if (userMessages.length === 0) return '';
    const first = userMessages[0]!.slice(0, 100);
    const last = userMessages[userMessages.length - 1]!.slice(0, 100);

    return userMessages.length === 1
      ? `用户讨论了: ${first}`
      : `会话包含 ${userMessages.length} 条用户消息。开始: ${first}。最后: ${last}`;
  }

  private formatConversation(messages: Message[]): string {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const text = this.extractText(m);
        const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text;
        return `${role}: ${truncated}`;
      })
      .join('\n\n');
  }

  private extractText(message: Message): string {
    if (typeof message.content === 'string') return message.content;
    return message.content
      .map(block => {
        if (block.type === 'text' && block.text) return block.text;
        if (block.type === 'tool_use' && block.name) return `[Tool: ${block.name}]`;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  private emptyResult(duration = 0): FlushResult {
    return { processedMessages: 0, extractedMemories: 0, extractedLessons: 0, summary: '', keyPoints: [], duration };
  }

  // ─── Boot 重要性评分 ──────────────────────────────────

  /** 记忆类型权重：高价值类型优先展示 */
  private static readonly TYPE_WEIGHTS: Record<string, number> = {
    user_preference: 1.0,
    user_fact: 1.0,
    decision: 0.9,
    lesson_learned: 0.9,
    reusable_pattern: 0.85,
    project_fact: 0.8,
    relationship: 0.8,
    important_date: 0.8,
    error_resolution: 0.7,
    tool_pattern: 0.6,
    session_summary: 0.5,
    agent_knowledge: 0.4,
  };

  /**
   * 计算记忆在启动引导场景下的重要性得分
   * = confidence × 类型权重 × 时间衰减
   */
  private calcBootImportance(entry: import('./types').MemoryEntry): number {
    const typeWeight = MemoryFlushAgent.TYPE_WEIGHTS[entry.type] ?? 0.5;
    const ageMs = Date.now() - new Date(entry.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const timeDecay = Math.pow(0.5, ageDays / 30); // 30 天半衰期
    return entry.confidence * typeWeight * timeDecay;
  }
}
