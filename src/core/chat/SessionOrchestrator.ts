// ============================================================
// SessionOrchestrator - 会话编排器
// ============================================================
// 从 ChatSession 中拆分出来的核心流程控制
//
// 职责:
// 1. 编排执行流程（Skill 路由 → AgentLoop）
// 2. 前置/后置处理
// 3. 错误处理
// 4. 回调通知
//
// 不负责:
// - 依赖初始化（由 SessionFactory 负责）
// - 依赖管理（由 DependencyContainer 负责）
// ============================================================

import type { AgentLoop } from '@/core/agent/AgentLoop';
import type { SkillRouter } from './SkillRouter';
import type { TurnLifecycleManager } from './TurnLifecycleManager';
import type { PromptOrchestrator } from './PromptOrchestrator';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SessionOrchestrator' });

/**
 * 会话回调
 */
export interface SessionCallbacks {
  /** 执行前回调 */
  onBeforeExecution?: (input: string) => void | Promise<void>;
  /** 执行后回调 */
  onAfterExecution?: () => void | Promise<void>;
  /** 错误回调 */
  onError?: (error: Error) => void | Promise<void>;
  /** 启动引导回调（传递 LLM 生成的引导语） */
  onBootGuide?: (message: string) => void;
}

/**
 * SessionOrchestrator - 会话编排器
 */
export class SessionOrchestrator {
  constructor(
    private agentLoop: AgentLoop,
    private skillRouter: SkillRouter,
    private turnManager: TurnLifecycleManager,
    private promptOrchestrator: PromptOrchestrator,
    private callbacks?: SessionCallbacks
  ) {}

  /**
   * 执行用户输入
   */
  async execute(input: string): Promise<void> {
    try {
      // 1. 前置处理
      await this.beforeExecution(input);

      // 2. Skill 路由判断（使用 tryRouteToSkill）
      const skillRouted = await this.skillRouter.tryRouteToSkill(input);
      if (skillRouted) {
        log.info('Skill execution completed');
        await this.afterExecution();
        return;
      }

      // 3. 执行单次 Agent 运行
      await this.runSingleAgent(input);

      // 4. 后置处理
      await this.afterExecution();

    } catch (error) {
      await this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * 执行单次 Agent 运行（支持递归处理 pendingAppend）
   */
  private async runSingleAgent(input: string): Promise<void> {
    // __startup__ 是内部触发信号，传给 LLM 时替换为自然的启动触发语
    // PromptOrchestrator 用原始 __startup__ 识别场景并注入对应指令
    const llmMessage = input === '__startup__' ? '你好' : input;
    const isStartup = input === '__startup__';

    // 关键词触发：检测是否包含记忆相关关键词
    const memoryHint = this.detectMemoryIntent(input);
    if (memoryHint) {
      log.info(`🧠 Memory intent detected: ${memoryHint}`);
    }

    // 构建并应用 system prompt（场景感知 + 记忆注入 + 记忆提示）
    log.debug('Building system prompt');
    try {
      await this.promptOrchestrator.buildAndApply(input, memoryHint);
    } catch (promptErr) {
      log.debug('Prompt build failed, using default prompt:', promptErr);
    }

    // AgentLoop 执行
    log.debug('Executing AgentLoop');
    await this.agentLoop.run(llmMessage);

    // 检查是否有待处理的追加消息（用户在 agent 总结时输入的新内容）
    // 如果有，立即触发新一轮对话，避免用户输入被忽略
    const pendingMessage = this.agentLoop.consumePendingAppend();
    if (pendingMessage) {
      log.info(`⚡ Detected pending append message, triggering new run with: "${pendingMessage.slice(0, 50)}"`);
      // 递归调用 runSingleAgent，处理待处理的消息
      await this.runSingleAgent(pendingMessage);
      return; // 递归调用会处理后续逻辑，这里直接返回
    }

    // 如果是启动场景，触发 onBootGuide 回调（传递 LLM 生成的引导语）
    if (isStartup && this.callbacks?.onBootGuide) {
      const messages = this.agentLoop.getMessageHistory();
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        // 提取文本内容
        let guideText = '';
        if (Array.isArray(lastMessage.content)) {
          for (const block of lastMessage.content) {
            if (block.type === 'text') {
              guideText += block.text;
            }
          }
        } else if (typeof lastMessage.content === 'string') {
          guideText = lastMessage.content;
        }

        if (guideText) {
          log.info('🎉 Startup guide generated, triggering onBootGuide callback');
          this.callbacks.onBootGuide(guideText);
        }
      }
    }
  }

  /**
   * 停止执行
   */
  async stop(): Promise<void> {
    log.info('Stopping session');
    await this.agentLoop.stop();
  }

  /**
   * 中断并追加新输入
   */
  async interrupt(input: string): Promise<void> {
    log.info('Interrupting session with new input');
    await this.agentLoop.interrupt(input);
  }

  /**
   * 前置处理
   */
  private async beforeExecution(input: string): Promise<void> {
    log.debug('Before execution');
    await this.callbacks?.onBeforeExecution?.(input);
  }

  /**
   * 后置处理
   */
  private async afterExecution(): Promise<void> {
    log.debug('After execution');

    // 轮次后处理（保存、归档等）
    await this.turnManager.afterTurn();

    await this.callbacks?.onAfterExecution?.();
  }

  /**
   * 错误处理
   */
  private async handleError(error: Error): Promise<void> {
    log.error('Execution error:', error);
    await this.callbacks?.onError?.(error);
  }

  /**
   * 检测用户输入是否包含记忆意图
   * 返回记忆提示文本，如果没有检测到则返回 null
   */
  private detectMemoryIntent(input: string): string | null {
    // 关键词列表
    const memoryKeywords = {
      constraint: ['记住', '记得', '以后', '规则', '约束', '不要', '必须', 'remember', 'always', 'never', 'rule', 'constraint'],
      preference: ['喜欢', '偏好', '习惯', 'prefer', 'like', 'habit'],
      identity: ['叫我', '称呼', '名字', '叫', 'call me', 'name'],
    };

    // 检测约束类关键词
    for (const keyword of memoryKeywords.constraint) {
      if (input.toLowerCase().includes(keyword.toLowerCase())) {
        return 'IMPORTANT: The user is stating a constraint or rule. Use the memory_store tool to save this as user_preference or user_fact type.';
      }
    }

    // 检测偏好类关键词
    for (const keyword of memoryKeywords.preference) {
      if (input.toLowerCase().includes(keyword.toLowerCase())) {
        return 'IMPORTANT: The user is sharing a preference. Use the memory_store tool to save this as user_preference type.';
      }
    }

    // 检测身份类关键词
    for (const keyword of memoryKeywords.identity) {
      if (input.toLowerCase().includes(keyword.toLowerCase())) {
        return 'IMPORTANT: The user is providing identity information (name/nickname). Use the memory_store tool to save this as user_fact type.';
      }
    }

    return null;
  }
}
