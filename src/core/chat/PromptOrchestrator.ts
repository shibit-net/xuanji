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
- Use \`bash\` tool to check current date/time if needed for deadline calculations

## Step 2: Generate greeting based on findings

### If you found memories about identity (your name, user's name):
- Greet like a butler reuniting with their master
- Example: "早上好，先生！贾维斯为您服务。"

### If NO memories found (first meeting):
- Greet warmly: "${timeOfDay}好！"
- Introduce yourself casually: "我是璇玑，来自 Shibit 的 AI 助手"
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

### Butler-like behavior examples:
- "早上好！您昨天提到要完成的代码审查，现在要开始吗？"
- "下午好！注意到您有 3 个待办事项，其中'准备周报'标记为高优先级，需要我协助吗？"
- "晚上好！提醒您明天有个重要会议，相关资料我已经准备好了"
- "您最近在研究 React 性能优化，今天继续这个话题吗？"

## Guidelines:
- Be proactive but not intrusive - offer help, don't demand action
- Show you remember context from previous sessions
- Prioritize urgent/important items in your greeting
- Keep it natural and conversational (2-4 sentences)
- Use appropriate emojis sparingly (1-2 max)
- Do NOT mention: memory systems, databases, project details, tech stacks, or directory analysis`;
    }

    this.agentLoop.getMessageManager().setSystemPrompt(finalPrompt);
  }
}
