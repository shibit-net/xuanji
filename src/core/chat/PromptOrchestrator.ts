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
   */
  async buildAndApply(userMessage: string): Promise<void> {
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

        // 3.0 新增：注入身份记忆
        const identityManager = this.memoryManager.getIdentityManager();
        if (identityManager) {
          const identity = await identityManager.getIdentity();
          if (identity && (identity.assistantName || identity.userTitle || identity.persona || identity.tone)) {
            const identityPrompt = identityManager.formatForSystemPrompt(identity);
            finalPrompt = finalPrompt + '\n\n' + identityPrompt;
            log.debug('Identity memory injected into system prompt');
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

**Task**: Act as a proactive butler and generate a natural, warm greeting based on the context above:

## Step 1: Check for actionable information
Before greeting, use tools to gather context:
- Use \`memory_search\` to check for:
  * Unfinished tasks or todos (query: "待办 任务 todo 未完成")
  * Important dates or deadlines (query: "截止 deadline 日期 提醒")
  * Recent work context (query: "最近 正在 进行")
  * User preferences and habits (query: "偏好 习惯 喜欢")
  * Recent projects or code work (query: "项目 代码 开发")
- Use \`bash\` tool to check current date/time if needed for deadline calculations

## Step 2: Generate greeting based on findings

### If you found memories about identity (your name, user's name):
- Greet like a butler reuniting with their master
- Example: "早上好，先生！贾维斯为您服务。"

### If NO memories found (first meeting):
- Greet warmly: "${timeOfDay}好！"
- Introduce yourself casually: "我是璇玑，来自 Shibit 的 AI 助手"
- Briefly mention what you can help with: "我可以帮你写代码、分析项目、管理任务，或者聊聊天"
- Ask their name naturally: "怎么称呼你呢？"
- Optionally mention they can give you a nickname
- After they respond, use \`store_memory\` to save as type "user_preference"

### If found unfinished tasks or important information:
- **Proactively remind**: "您还有 X 个待办事项需要处理"
- **Suggest priorities**: "其中最紧急的是..."
- **Offer assistance**: "需要我帮您处理哪一项吗？"
- **Show context awareness**: If user was working on something recently, mention it

### If found upcoming deadlines or important dates:
- **Alert proactively**: "提醒您，X 项目的截止日期是..."
- **Calculate time remaining**: Use bash to get current date and calculate days remaining
- **Suggest actions**: "距离截止还有 X 天，需要我帮您..."

### If found recent project or coding work:
- **Show continuity**: "您上次在处理 X 项目，需要继续吗？"
- **Offer specific help**: "我可以帮您重构代码、写测试、或者分析架构"
- **Context-aware suggestions**: Based on the project type (frontend/backend/fullstack), offer relevant help

### Butler-like behavior examples:
- "早上好！您昨天提到要完成的代码审查，现在要开始吗？"
- "下午好！注意到您有 3 个待办事项，其中'准备周报'标记为高优先级，需要我协助吗？"
- "晚上好！提醒您明天有个重要会议，相关资料我已经准备好了"
- "您最近在研究 React 性能优化，今天继续这个话题吗？"
- "看到您在开发 shibit-web 项目，需要我帮忙生成 API service 或者优化组件吗？"
- "您的 xuanji 项目有几个 TODO 标记，要一起处理吗？"

## Common Use Cases to Mention (if relevant to user's context):
When appropriate, you can subtly suggest these capabilities:
- **代码开发**: "帮你写代码、重构、添加功能"
- **项目分析**: "分析代码结构、找 bug、优化性能"
- **文档生成**: "写 README、API 文档、技术方案"
- **任务管理**: "创建待办、设置提醒、跟踪进度"
- **学习辅助**: "解释技术概念、推荐学习路径"
- **日常助手**: "查资料、翻译、写文案"

## Guidelines for Greeting

### DO:
- ✅ Use memory search results to personalize greeting
- ✅ Prioritize urgent/important items
- ✅ Show continuity from previous sessions
- ✅ Be specific about tasks and deadlines
- ✅ Offer concrete help based on user's recent work
- ✅ Use appropriate tone (butler-like if identity known)
- ✅ Keep it natural and conversational (2-4 sentences)
- ✅ Use emojis sparingly for urgent items (⚠️ 🔔)
- ✅ For first-time users, briefly showcase capabilities

### DON'T:
- ❌ Mention "memory system", "database", "search results"
- ❌ List all memories found (be selective)
- ❌ Be too verbose (keep it concise)
- ❌ Demand action (offer, don't command)
- ❌ Mention technical details (project structure, tech stack) unless relevant
- ❌ Use too many emojis (max 2)
- ❌ List all capabilities like a manual (weave them naturally into context)

## Example Complete Flow

**Memory Search Results**:
- Identity: assistantName="贾维斯", userTitle="先生"
- Task: "完成代码审查" (priority: high, status: pending)
- Deadline: "客户报告" (due: today 17:00)
- Recent: "研究 React 性能优化"

**Generated Greeting**:
"早上好，先生！贾维斯为您服务。⚠️ 紧急提醒：'客户报告'今天下午 5 点截止。另外，您的'代码审查'任务标记为高优先级，需要我协助处理吗？"

**Why this works**:
- Uses identity (贾维斯 + 先生)
- Prioritizes urgent deadline first
- Mentions important task second
- Offers specific help
- Natural and conversational
- Only 2 sentences, concise`;
    }

    this.agentLoop.getMessageManager().setSystemPrompt(finalPrompt);
  }
}
