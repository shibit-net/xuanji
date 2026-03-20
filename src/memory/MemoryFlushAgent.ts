// ============================================================
// M4 记忆系统 — MemoryFlushAgent（记忆刷新 Agent）
// ============================================================
//
// 真正的 Agent 实现（基于 SubAgentLoop），负责：
// 1. 分析对话上下文，提取值得记忆的信息
// 2. 总结经验教训（错误方案→改进、优秀方案→复用）
// 3. 退出时强制刷新所有未记忆的上下文
// 4. 启动时根据历史记忆生成引导消息
//

import type { Message, ILLMProvider, IToolRegistry, AgentConfig, ProviderConfig } from '@/core/types';
import type { MemoryEntry, MemoryEntryType, MemoryCategory } from './types';
import type { MemoryManager } from './MemoryManager';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { SubAgentContext } from '@/core/agent/SubAgentContext';
import { runSubAgent } from '@/core/agent/SubAgentLoop';
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

/** LLM 提取的原始结果 */
interface ExtractionResult {
  summary: string;
  keyPoints: string[];
  memories: Array<{
    type?: string;
    category?: string;
    content: string;
    keywords?: string[];
    confidence?: number;
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
  private provider: ILLMProvider;
  private lightProvider: ILLMProvider;
  private registry: IToolRegistry;
  private parentConfig: AgentConfig;
  private providerConfig: ProviderConfig;
  private memoryManager: MemoryManager;
  private hookRegistry: HookRegistry | null;
  private flushing = false;

  constructor(opts: {
    provider: ILLMProvider;
    lightProvider: ILLMProvider;
    registry: IToolRegistry;
    parentConfig: AgentConfig;
    providerConfig: ProviderConfig;
    memoryManager: MemoryManager;
    hookRegistry?: HookRegistry | null;
  }) {
    this.provider = opts.provider;
    this.lightProvider = opts.lightProvider;
    this.registry = opts.registry;
    this.parentConfig = opts.parentConfig;
    this.providerConfig = opts.providerConfig;
    this.memoryManager = opts.memoryManager;
    this.hookRegistry = opts.hookRegistry ?? null;
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
      return this.emptyResult();
    }
    this.flushing = true;
    const startTime = Date.now();

    try {
      const contextMessages = messages.filter(m => m.role !== 'system');
      if (contextMessages.length === 0) {
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

  // ─── 启动时记忆引导 ──────────────────────────────────

  /**
   * 生成启动引导消息（通过 SubAgent）
   */
  async generateBootGuide(): Promise<BootGuideResult> {
    const empty: BootGuideResult = { hasGuide: false, guideMessage: '', memories: [] };

    try {
      // 从缓存直接获取所有记忆，按重要性评分排序
      const cached = (this.memoryManager as any).cachedEntries as import('./types').MemoryEntry[] | undefined;
      if (!cached || cached.length === 0) return empty;

      // 按重要性评分排序（confidence × 类型权重 × 时间衰减）
      const scored = cached.map(m => ({
        entry: m,
        score: this.calcBootImportance(m),
      }));
      scored.sort((a, b) => b.score - a.score);
      const topMemories = scored.slice(0, 20).map(s => s.entry);

      // 筛选最近 24 小时内的记忆（优先展示）
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentWork = topMemories.filter(m => {
        const ts = new Date(m.lastAccessedAt || m.createdAt).getTime();
        return ts > oneDayAgo;
      });

      // 选取展示记忆：优先最近工作，兜底取 top 记忆
      const displayMemories = recentWork.length > 0 ? recentWork : topMemories.slice(0, 8);

      // 检测未完成任务（7 天内、未 dismissed）
      const unfinishedTasks = cached.filter(m =>
        m.type === 'unfinished_task' &&
        !(m as any).metadata?.dismissed &&
        Date.now() - new Date(m.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
      );

      // 通过 SubAgent 生成引导消息
      const guideMessage = await this.runGuideAgent(displayMemories, unfinishedTasks);

      return {
        hasGuide: true,
        guideMessage,
        memories: displayMemories,
        lastWorkSummary: displayMemories.find(m => m.type === 'session_summary')?.content,
      };
    } catch (err) {
      log.warn('Failed to generate boot guide:', err);
      return empty;
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
    const task = this.buildExtractionTask(conversation);

    const context = new SubAgentContext({
      task,
      role: 'memory-extractor',
      depth: 1,
      maxDepth: 1,
      timeout: 25_000,
      restrictedTools: [], // 记忆 Agent 不需要工具
      useLightModel: true, // 使用轻量模型
    });

    const result = await runSubAgent(
      this.provider,
      this.lightProvider,
      this.registry,
      this.parentConfig,
      context,
      this.hookRegistry,
    );

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

  /**
   * 运行引导消息 SubAgent
   */
  private async runGuideAgent(memories: MemoryEntry[], unfinishedTasks: MemoryEntry[] = []): Promise<string> {
    const today = new Date();
    const todayStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    const hour = today.getHours();
    const timeOfDay = hour < 6 ? '凌晨' : hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    // 按类型分组记忆
    const groups: Record<string, string[]> = {};
    for (const m of memories) {
      const key = m.type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m.content);
    }

    const memorySections = Object.entries(groups)
      .map(([type, contents]) => `[${type}]\n${contents.map(c => `- ${c}`).join('\n')}`)
      .join('\n\n');

    const unfinishedSection = unfinishedTasks.length > 0
      ? `\n## ⚠️ 上次未完成的任务\n${unfinishedTasks.map(m => `- ${m.content}`).join('\n')}\n`
      : '';

    const task = `你是 Xuanji AI 助手。今天是 ${todayStr}（${timeOfDay}）。根据以下用户历史记忆，生成一条自然、个性化的欢迎消息。
${unfinishedSection}
## 用户历史记忆（按类型分组）
${memorySections}

## 生成要求
生成 3-5 句流畅的对话，主动展现你的记忆，覆盖多个维度：

1. **时间问候**：结合当前时间（${timeOfDay}好），可体现对用户情况的了解
2. **未完成任务提醒**（如有，优先级最高）：明确告知用户上次有未完成的任务，询问是否继续（"继续" 或 "不再提醒"）
3. **紧急事项**（如有 important_date）：临近截止日期或约会
4. **工作上下文**（如有 session_summary/project_fact）：提及上次进行中的工作，询问是否继续
5. **个人关怀**（如有 user_fact/relationship）：自然体现记住用户的个人信息
6. **开放收尾**：引导用户说出今天想做什么

## 写作风格
- 中文，语气自然亲切，像熟悉用户的助手
- 未完成任务要**明确说清楚是什么任务**，不要含糊
- 不要生硬列举，要有机融入对话流中
- 检查 user_fact 中是否有临近生日（7天内），若有则提醒并说明剩余天数

直接输出消息文本，不要 JSON 或 Markdown 格式标记。`;

    const context = new SubAgentContext({
      task,
      role: 'guide-generator',
      depth: 1,
      maxDepth: 1,
      timeout: 10_000,
      restrictedTools: [],
      useLightModel: true,
    });

    const result = await runSubAgent(
      this.provider,
      this.lightProvider,
      this.registry,
      this.parentConfig,
      context,
      this.hookRegistry,
    );

    return result.result.trim() || '你好！有什么我可以帮你的吗？';
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

---

## 记忆类型完整定义

### ▸ user_fact（用户事实）
关于用户本人或其重要关系人的**永久性事实**，不随时间过期。
- ✓ 包括：用户的职业、居住地、兴趣爱好、拥有的物品；关系人的姓名、生日、外貌特征
- ✓ 示例："用户是后端工程师，在上海工作" / "用户有一辆坦克车（59式）" / "用户女朋友叫艾琳娜，生日3月25日"
- ✗ 不包括：临时约会计划（→ important_date）；用户对工具的偏好（→ user_preference）
- category: **fact**

### ▸ user_preference（用户偏好）
用户对工具、技术、风格、工作方式的**持续性偏好和习惯**。
- ✓ 包括：编程语言偏好、代码风格要求、工作习惯、沟通偏好
- ✓ 示例："用户偏好简洁代码，不喜欢过度注释" / "用户习惯先讨论方案再动手"
- ✗ 不包括：客观事实（→ user_fact）；一次性的具体请求
- category: **topic**

### ▸ relationship（人际关系背景）
补充描述用户与他人的关系特征、互动模式，**不包含基本信息**（基本信息在 user_fact）。
- ✓ 包括：关系性质说明（朋友/同事/客户）、关系人的特点、互动历史
- ✓ 示例："同事 Bob 负责前端，经常一起协作" / "客户李总对交付时间非常敏感"
- ✗ 不包括：关系人的姓名/生日（→ user_fact，合并记录）
- category: **topic**

### ▸ important_date（重要日期事件）
**与具体日期绑定的待办或计划**，具有时效性。
- ✓ 包括：约会计划、截止日期、需要在某天完成的任务、待准备的事项
- ✓ 示例："3月25日需要给艾琳娜准备生日礼物" / "下周三与客户开评审会" / "月底前完成 API 文档"
- ✗ 不包括：生日本身（→ user_fact）；没有具体时间的计划（→ decision）
- category: **timeline**

### ▸ project_fact（项目技术事实）
项目的**客观技术信息**，长期有效。
- ✓ 包括：技术栈/框架/版本、服务端口、数据库配置、目录结构约定、构建方式
- ✓ 示例："xuanji 使用 TypeScript + Ink 5，运行在 Node.js 20+" / "shibit-starship 监听 7101 端口"
- ✗ 不包括：用户对项目的态度偏好（→ user_preference）；临时决定（→ decision）
- category: **topic**

### ▸ decision（决策）
用户在本次会话中做出的**明确技术选择或方向决定**，影响后续工作。
- ✓ 包括：技术方案选择、架构决策、放弃某方案的原因
- ✓ 示例："决定用 JSONL 存储记忆（考虑简单性，而非 SQLite）" / "放弃全量工具传递，改用动态过滤"
- ✗ 不包括：长期偏好（→ user_preference）；已成定论的技术事实（→ project_fact）
- category: **topic**

### ▸ tool_pattern（工具使用模式）
用户使用特定工具/命令的**特定方式或习惯**。
- ✓ 包括：常用命令组合、工具配置偏好、特殊的使用技巧
- ✓ 示例："用 git rebase -i 整理提交，而非 merge" / "用 tsx watch 启动开发服务器"
- ✗ 不包括：工具相关错误（→ error_resolution）；架构决策（→ decision）
- category: **topic**

### ▸ error_resolution（错误解决方案）
遇到的**具体问题及其解决方法**，下次遇到同类问题可复用。
- ✓ 包括：报错信息→原因→解决步骤；踩坑记录
- ✓ 示例："TS strict 模式下 Map.get() 返回 T|undefined，需非空断言处理" / "Electron IPC 对象需可序列化，class 实例会丢失方法"
- category: **lesson**

### ▸ lesson_learned（经验教训）
从失败/改进中总结的**规律性认知**，比 error_resolution 更抽象。
- ✓ 包括：做错了的决策及原因分析、可避免的设计陷阱
- ✓ 示例："过早优化导致复杂度急剧上升，应先完成功能再优化" / "不该用 global state 管理 UI 临时状态"
- category: **lesson**

### ▸ reusable_pattern（可复用方案）
总结出的**可在多个场景复用的优秀实现模式**。
- ✓ 包括：设计模式具体应用、通用解决方案模板、最佳实践
- ✓ 示例："SubAgentContext 隔离子任务：独立上下文→限制工具→超时保护" / "React 更新用 setState(prev=>) 避免闭包陷阱"
- category: **lesson**

### ▸ agent_knowledge（Agent 专属知识）
AI Agent 执行任务时积累的**特定领域知识**。
- ✓ 包括：某类任务的执行规律、工具隐含限制、API 特殊行为
- ✓ 示例："Anthropic tool_result 必须紧跟 tool_use，否则报错"
- category: **topic**

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
  "summary": "一句话概括本次对话的主题和结果",
  "keyPoints": ["关键点1", "关键点2"],
  "memories": [
    {
      "type": "user_fact|user_preference|relationship|important_date|project_fact|decision|tool_pattern|error_resolution|lesson_learned|reusable_pattern|agent_knowledge",
      "category": "fact|topic|timeline|lesson",
      "content": "简洁的事实陈述，不超过100字，独立可理解",
      "keywords": ["关键词1", "关键词2"],
      "confidence": 0.8
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
