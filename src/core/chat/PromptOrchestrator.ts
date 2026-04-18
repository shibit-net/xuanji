/**
 * PromptOrchestrator — System Prompt 编排器
 *
 * 职责：使用 LayeredPromptBuilder 构建场景感知的 system prompt，
 * 并更新 DynamicToolFilter 的场景过滤和 AgentLoop 的 thinking 配置。
 * 同时注入 DecisionContext（核心规则 + 用户画像 + 相关经验 + 待处理事项）。
 */

import type { AgentLoop } from '@/core/agent/AgentLoop';
import type { IToolRegistry, AppConfig } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PromptOrchestrator' });

export class PromptOrchestrator {
  // 缓存 LayeredPromptBuilder 实例，避免每次 run 都重新创建
  private builder: import('@/core/prompt').LayeredPromptBuilder | null = null;
  private memoryManager: import('@/memory/MemoryManager').MemoryManager | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly agentLoop: AgentLoop,
    private readonly registry: IToolRegistry,
    private readonly reminderContext: () => string | null,
    private readonly onBootThinking?: () => void,
  ) {}

  /** 注入 MemoryManager（启用 DecisionContext 注入） */
  setMemoryManager(mm: import('@/memory/MemoryManager').MemoryManager): void {
    this.memoryManager = mm;
  }

  /**
   * 构建 system prompt 并应用到 AgentLoop
   * 到达此处说明路由层未命中任何 Skill，直接走场景分析构建 prompt
   * @param userMessage 用户消息
   * @param memoryHint 记忆提示（如果检测到记忆意图）
   */
  async buildAndApply(userMessage: string, memoryHint?: string | null): Promise<void> {
    const { LayeredPromptBuilder } = await import('@/core/prompt');

    if (!this.builder) {
      this.builder = new LayeredPromptBuilder();
    }

    try {
      const { EmbeddingService } = await import('@/embedding/EmbeddingService');
      const embeddingService = EmbeddingService.getInstance();
      if (embeddingService.isReady()) {
        this.builder.getIntentAnalyzer().constructor.prototype.embeddingService = embeddingService;
      }
    } catch (err) {
      log.debug('Embedding service not available, using keyword-only matching:', err);
    }

    await this.builder.init();

    const result = await this.builder.build({
      userMessage,
      language: this.config.ui.language ?? 'zh',
      toolList: this.registry.getSchemas(),
      config: this.config,
    });

    log.info(
      `Prompt built: scene=${result.scene}, complexity=${result.complexity}, ` +
      `components=${result.components.length}, tokens~${result.estimatedTokens}`,
    );

    // 更新工具过滤器（基于场景）
    const { DynamicToolFilter } = await import('@/core/tools/DynamicToolFilter');
    if (this.registry instanceof DynamicToolFilter && result.scene) {
      this.registry.setScene(result.scene, result.requiredTools ?? []);
      log.info(`Scene routing: ${result.scene} → ${this.registry.getSchemas().length} tools`);
    }

    // 设置 thinking 配置
    if (result.thinking) {
      this.agentLoop.setThinking(result.thinking);
      log.info(
        `Extended Thinking: ${result.thinking.type}` +
        `${result.thinking.type === 'adaptive' ? `, effort=${result.thinking.effort}` : ''}`,
      );
    } else {
      this.agentLoop.setThinking(this.config.provider.thinking);
    }

    // 更新 system prompt
    let finalPrompt = result.prompt;
    const reminder = this.reminderContext();
    if (reminder) {
      finalPrompt = finalPrompt + '\n\n' + reminder;
    }

    // 注入记忆提示（如果检测到记忆意图）
    if (memoryHint) {
      finalPrompt = finalPrompt + '\n\n' + memoryHint;
      log.info('Memory hint injected into system prompt');
    }

    // 启动场景：先触发 onBootThinking 回调（展示"回忆中"状态），再执行回忆
    const isStartup = userMessage === '__startup__';
    if (isStartup && this.onBootThinking) {
      log.info('🚀 Startup detected, triggering onBootThinking callback before memory recall');
      this.onBootThinking();
    }

    // 注入 DecisionContext（核心规则 + 用户画像 + 相关经验 + 待处理事项）
    if (this.memoryManager) {
      try {
        // 启动场景：通用查询，依赖向量检索的语义理解和 profile 层优先级
        const decisionQuery = isStartup
          ? '用户 个人 偏好 习惯 关系'
          : userMessage;
        const memoryContext = await this.memoryManager.formatDecisionContext(decisionQuery);
        if (memoryContext) {
          finalPrompt = finalPrompt + '\n\n' + memoryContext;
          log.debug('DecisionContext injected into system prompt');
        }

        // 3.0 新增：注入身份记忆（使用 PermanentConstraintManager）
        const constraintManager = this.memoryManager.getConstraintManager();
        if (constraintManager) {
          const identity = await constraintManager.getIdentity();
          if (identity && (identity.assistantName || identity.userTitle || identity.persona || identity.tone)) {
            const identityPrompt = constraintManager.formatIdentityForPrompt(identity);
            finalPrompt = finalPrompt + '\n\n' + identityPrompt;
            log.debug('Identity memory injected into system prompt (via PermanentConstraintManager)');
          }
        }
      } catch (err) {
        log.debug('Failed to inject DecisionContext:', err);
      }
    }

    // 启动指令：根据状态注入不同行为
    if (isStartup) {
      // 启动时：基于已注入的 DecisionContext 自然打招呼
      const today = new Date();
      const todayStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
      const hour = today.getHours();
      const timeOfDay = hour < 6 ? '凌晨' : hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

      finalPrompt = finalPrompt + `\n\n# Startup Greeting

You just started up. Today is ${todayStr}, ${timeOfDay}.

**About yourself**: You are an AI assistant developed by Shibit, running in Xuanji (璇玑) software. Xuanji is the software name, not your personal name. Your personal name is what the user calls you (e.g., a nickname they gave you).

**Task**: Act as a proactive, context-aware butler and generate a rich, personalized greeting based on comprehensive memory retrieval.

## Step 1: MANDATORY Memory Retrieval (DO NOT SKIP)
You MUST use \`memory_search\` tool multiple times to gather comprehensive context. Execute ALL of these searches:

1. **Identity & Relationship** (query: "称呼 名字 身份 关系")
   - Your name, user's name/title, relationship dynamics

2. **Unfinished Tasks** (query: "待办 任务 todo 未完成 进行中")
   - Pending todos, in-progress work, unfinished items

3. **Deadlines & Time-sensitive** (query: "截止 deadline 日期 提醒 紧急")
   - Upcoming deadlines, important dates, time-sensitive matters

4. **Recent Work Context** (query: "最近 正在 项目 开发 工作")
   - Recent projects, coding work, what user was working on

5. **User Preferences & Habits** (query: "偏好 习惯 喜欢 风格 方式")
   - Work style, preferences, habits, communication style

6. **Life & Personal** (query: "生活 个人 日常 兴趣 爱好")
   - Personal interests, life context, hobbies, daily routines

**IMPORTANT**: Execute these searches BEFORE generating greeting. The more context you gather, the better your greeting will be.

## Step 2: Generate Rich, Multi-dimensional Greeting

### Greeting Structure (adapt based on findings):

**Opening** (1 sentence):
- If identity known: Butler-style greeting with names
  - "早上好，先生！贾维斯为您服务。"
  - "下午好，Kevin！很高兴再次见到您。"
- If first meeting: Warm introduction
  - "${timeOfDay}好！我是璇玑，来自 Shibit 的 AI 助手。"

**Context Layer 1 - Urgent/Important** (1-2 sentences):
- Prioritize time-sensitive items (deadlines today/tomorrow)
- Mention high-priority unfinished tasks
- Use ⚠️ or 🔔 for urgent items
- Examples:
  - "⚠️ 紧急提醒：'客户报告'今天下午 5 点截止。"
  - "注意到您有 3 个待办事项，其中'准备周报'标记为高优先级。"

**Context Layer 2 - Continuity** (1-2 sentences):
- Show awareness of recent work
- Offer to continue previous context
- Be specific about projects/topics
- Examples:
  - "您上次在重构 shibit-web 的 API service 生成脚本，需要继续吗？"
  - "看到您最近在研究 React 性能优化，今天继续这个话题吗？"
  - "xuanji 项目的记忆系统重构进展如何？需要我帮忙吗？"

**Context Layer 3 - Personal Touch** (optional, 1 sentence):
- Reference user preferences or habits if relevant
- Show understanding of user's work style
- Examples:
  - "按您的习惯，早上适合处理架构设计类的工作。"
  - "您喜欢先处理技术债务，要不要一起看看代码中的 TODO 标记？"

**Closing** (1 sentence):
- Offer specific, actionable help
- Based on context, suggest next steps
- Examples:
  - "需要我帮您处理哪一项？"
  - "今天想从哪里开始？"
  - "我可以帮您生成代码、分析架构、或者管理任务。"

### Rich Greeting Examples:

**Example 1 - Returning User with Tasks**:
"早上好，先生！贾维斯为您服务。⚠️ 紧急提醒：'客户报告'今天下午 5 点截止，目前完成度 60%。另外，您昨天在重构 shibit-starship 的权限系统，代码已提交但测试用例还未完成。按您的习惯，早上适合写测试代码，要不要先把这个收尾？"

**Example 2 - Returning User, Relaxed Context**:
"下午好，Kevin！看到您最近在研究 Electron 桌面应用开发，xuanji 的 GUI 版本进展不错。今天有 2 个待办：'优化启动性能'和'添加快捷键支持'。另外，您收藏的那篇关于 IPC 优化的文章，要不要一起讨论一下实现方案？"

**Example 3 - First Meeting**:
"${timeOfDay}好！我是璇玑，来自 Shibit 的 AI 助手。我可以帮你写代码、分析项目、管理任务，或者聊聊天。我擅长 TypeScript、React、Node.js 等技术栈，也能帮你处理文档、翻译、学习辅助等日常工作。怎么称呼你呢？如果愿意，也可以给我起个昵称。"

**Example 4 - Life Context Included**:
"晚上好！注意到您今天工作了 8 小时，辛苦了。您的'代码审查'任务已完成，'API 文档'还在进行中。明天是周五，您之前提到周五下午喜欢做技术调研。要不要我帮您准备一些关于 AI Agent 架构的资料？另外，您关注的那个开源项目今天发布了新版本。"

## Guidelines for Rich Greeting

### DO (Enhanced):
- ✅ **MUST use memory_search multiple times** (at least 3-4 searches)
- ✅ **Show multi-dimensional awareness**: work + life + preferences
- ✅ **Be specific with details**: project names, task titles, deadlines
- ✅ **Demonstrate continuity**: reference specific past conversations
- ✅ **Prioritize by urgency**: deadlines > high-priority tasks > recent work > general context
- ✅ **Personalize tone**: adapt based on user's communication style
- ✅ **Offer concrete next steps**: specific, actionable suggestions
- ✅ **Balance information density**: rich but not overwhelming (3-5 sentences)
- ✅ **Use natural transitions**: connect different context layers smoothly

### DON'T:
- ❌ Skip memory searches (this is MANDATORY)
- ❌ Generate generic greetings without context
- ❌ Mention "memory system", "database", "search results"
- ❌ List memories mechanically (weave them naturally)
- ❌ Be too verbose (max 5 sentences)
- ❌ Overwhelm with too many items (prioritize top 2-3)
- ❌ Use technical jargon unless user's context shows they prefer it
- ❌ Demand action (offer, don't command)

## Fallback for No Memories
If memory searches return empty (truly first-time user):
- Warm introduction with capabilities showcase
- Ask for name and preferences
- Mention you'll remember for next time
- Keep it friendly and inviting (2-3 sentences)`;
    }

    this.agentLoop.getMessageManager().setSystemPrompt(finalPrompt);
  }
}
