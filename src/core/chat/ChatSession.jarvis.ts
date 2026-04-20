// ============================================================
// ChatSession - 会话管理器（贾维斯架构版）
// ============================================================
// 简化版会话管理器，支持两种模式：
// 1. 贾维斯模式：使用 MainAgent 调度
// 2. 标准模式：直接使用 AgentLoop
// ============================================================

import type { MainAgent } from '@/core/agent/jarvis/MainAgent';
import type { AgentLoop } from '@/core/agent/AgentLoop';
import type { DependencyContainer } from '@/core/di';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ChatSession' });

/**
 * 会话回调
 */
export interface SessionCallbacks {
  /** 文本输出回调 */
  onText?: (text: string) => void;
  /** 思考过程回调 */
  onThinking?: (thinking: string) => void;
  /** 工具开始回调 */
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  /** 工具结束回调 */
  onToolEnd?: (id: string, name: string, result: string, isError: boolean) => void;
  /** 执行前回调 */
  onBeforeExecution?: (input: string) => void | Promise<void>;
  /** 执行后回调 */
  onAfterExecution?: () => void | Promise<void>;
  /** 错误回调 */
  onError?: (error: Error) => void | Promise<void>;
  /** 启动引导回调 */
  onBootGuide?: (message: string) => void;
}

/**
 * ChatSession - 会话管理器（贾维斯架构版）
 */
export class ChatSession {
  private mainAgent: MainAgent | null;
  private agentLoop: AgentLoop;
  private container: DependencyContainer;
  private callbacks?: SessionCallbacks;

  constructor(
    mainAgent: MainAgent | null,
    agentLoop: AgentLoop,
    container: DependencyContainer,
    callbacks?: SessionCallbacks
  ) {
    this.mainAgent = mainAgent;
    this.agentLoop = agentLoop;
    this.container = container;
    this.callbacks = callbacks;

    // 注册 AgentLoop 回调
    this.agentLoop.on({
      onText: callbacks?.onText,
      onThinking: callbacks?.onThinking,
      onToolStart: callbacks?.onToolStart,
      onToolEnd: callbacks?.onToolEnd,
      onError: callbacks?.onError,
    });
  }

  /**
   * 执行用户输入
   */
  async run(input: string): Promise<void> {
    log.debug('Running session with input');

    try {
      // 前置回调
      await this.callbacks?.onBeforeExecution?.(input);

      if (this.mainAgent) {
        // 贾维斯模式：使用 MainAgent 调度
        log.debug('Using Jarvis mode (MainAgent)');
        const result = await this.mainAgent.execute(input);
        this.callbacks?.onText?.(result);
      } else {
        // 标准模式：直接使用 AgentLoop
        log.debug('Using standard mode (AgentLoop)');
        await this.agentLoop.run(input);
      }

      // 后置回调
      await this.callbacks?.onAfterExecution?.();

    } catch (error) {
      await this.callbacks?.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * 停止执行
   */
  async stop(): Promise<void> {
    log.info('Stopping session');
    this.agentLoop.stop();
  }

  /**
   * 中断并追加新输入
   */
  async interrupt(input: string): Promise<void> {
    log.info('Interrupting session');
    this.agentLoop.interrupt(input);
  }

  /**
   * 获取 AgentLoop 实例
   */
  getAgentLoop(): AgentLoop {
    return this.agentLoop;
  }

  /**
   * 获取依赖容器
   */
  getContainer(): DependencyContainer {
    return this.container;
  }

  /**
   * 是否启用贾维斯模式
   */
  isJarvisMode(): boolean {
    return this.mainAgent !== null;
  }
}
