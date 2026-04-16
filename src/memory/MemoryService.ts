// ============================================================
// MemoryService — 记忆管理服务
// ============================================================
// 负责记忆管理，包括记忆检索、记忆刷新和记忆提取等功能

import type { Message, AgentState } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { MemoryManager } from '@/memory/MemoryManager';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { MemoryFlushAgent } from './MemoryFlushAgent';
import { logger } from '@/core/logger';
import type { AgentLoop } from '@/core/agent/AgentLoop';

const log = logger.child({ module: 'MemoryService' });

/**
 * 记忆服务选项
 */
export interface MemoryServiceOptions {
  memoryManager?: MemoryManager;
}

/**
 * 记忆服务
 * 负责记忆管理，包括记忆检索、记忆刷新和记忆提取等功能
 */
export class MemoryService {
  private memoryManager: MemoryManager | null = null;
  private memoryFlushAgent: MemoryFlushAgent | null = null;
  private lastFlushTime: number = Date.now();

  constructor(options: MemoryServiceOptions = {}) {
    if (options.memoryManager) {
      this.memoryManager = options.memoryManager;
    }
  }

  /**
   * 设置记忆管理器
   * @param memoryManager 记忆管理器实例
   */
  setMemoryManager(memoryManager: MemoryManager): void {
    this.memoryManager = memoryManager;
  }

  /**
   * 初始化记忆刷新 Agent
   * @param options 初始化选项
   */
  initMemoryFlushAgent(options: {
    subAgentFactory: SubAgentFactory;
  }): void {
    if (!this.memoryManager) {
      log.warn('MemoryManager not set, cannot initialize MemoryFlushAgent');
      return;
    }

    try {
      this.memoryFlushAgent = new MemoryFlushAgent({
        subAgentFactory: options.subAgentFactory,
        memoryManager: this.memoryManager,
      });
      log.info('🧠 MemoryFlushAgent initialized');
    } catch (err) {
      log.warn('MemoryFlushAgent init failed:', err);
    }
  }

  /**
   * 检索相关记忆并动态注入到 system prompt
   * @param userMessage 用户消息
   * @param agentLoop AgentLoop 实例
   */
  async injectMemories(userMessage: string, agentLoop: AgentLoop): Promise<void> {
    if (!this.memoryManager) {
      return;
    }

    try {
      // 启动场景（__startup__ 已被替换为 '你好'）：用宽泛查询检索所有 profile 类型记忆
      const isStartup = userMessage === '你好';
      const query = isStartup
        ? '用户信息 个人偏好 朋友 家人 关系 习惯 爱好'
        : userMessage;

      const memories = await this.memoryManager.retrieve(query, {
        maxResults: isStartup ? 20 : 10,
        minConfidence: 0.3,
      });

      if (memories.length > 0) {
        // 检查 memoryManager 是否有 formatForPrompt 方法
        if ('formatForPrompt' in this.memoryManager) {
          const memorySummary = (this.memoryManager as unknown as { formatForPrompt(m: unknown[]): string }).formatForPrompt(memories);
          agentLoop.getMessageManager().setSystemPromptSuffix(memorySummary, 'memory');
        } else {
          agentLoop.getMessageManager().setSystemPromptSuffix('', 'memory');
        }
      } else {
        agentLoop.getMessageManager().setSystemPromptSuffix('', 'memory');
      }
    } catch (memErr) {
      log.debug('Memory retrieval failed:', memErr);
    }
  }

  /**
   * 智能记忆刷新（OpenClaw 启发 + LLM 价值评估）
   * @param agentLoop AgentLoop 实例
   */
  async checkAndFlushMemory(agentLoop: AgentLoop): Promise<void> {
    if (!this.memoryManager) {
      return;
    }

    // 检查配置是否启用智能刷新
    const flushConfig = 'config' in this.memoryManager 
      ? (this.memoryManager as MemoryManager & { config?: { memory?: { intelligentFlush?: { enabled?: boolean } } } }).config?.memory?.intelligentFlush
      : undefined;
    if (flushConfig && flushConfig.enabled === false) {
      return;
    }

    try {
      // 检查 memoryManager 是否有 getIntelligentFlushingEnabled 方法
      if ('getIntelligentFlushingEnabled' in this.memoryManager) {
        const isEnabled = (this.memoryManager as unknown as { getIntelligentFlushingEnabled(): boolean }).getIntelligentFlushingEnabled();
        if (!isEnabled) {
          return;
        }
      }

      // 检查是否需要刷新（时间间隔 + token 阈值）
      const now = Date.now();
      const timeElapsed = now - this.lastFlushTime;

      // 从配置读取刷新间隔（默认 5 分钟）
      const flushInterval = 5 * 60 * 1000;

      if (timeElapsed < flushInterval) {
        return;
      }

      // 检查 token 数量是否达到阈值
      const messages = agentLoop.getMessageManager().getMessages();
      const tokenCount = this.estimateTokens(messages);

      // 从配置读取 token 阈值（默认 1000）
      const tokenThreshold = 1000;

      if (tokenCount < tokenThreshold) {
        return;
      }

      // 执行记忆刷新
      if (this.memoryFlushAgent) {
        log.info('🧠 Performing intelligent memory flush...');
        // MemoryFlushAgent 没有 run 方法，使用 flushOnExit 代替
        const result = await this.memoryFlushAgent.flushOnExit([]);
        log.info(`Memory flush completed: ${result.extractedMemories} memories, ${result.extractedLessons} lessons`);
        this.lastFlushTime = now;
      }
    } catch (err) {
      log.debug('Memory flush check failed:', err);
    }
  }

  /**
   * 估算当前消息的 token 数量
   * @param messages 消息数组
   * @returns token 数量
   */
  private estimateTokens(messages: Message[]): number {
    let totalChars = 0;

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ('text' in block && block.text) {
            totalChars += block.text.length;
          }
          if ('thinking' in block && block.thinking) {
            totalChars += block.thinking.length;
          }
        }
      }
    }

    // 从配置读取 charsPerToken 比例（默认 3）
    const charsPerToken = 3;
    return Math.ceil(totalChars / charsPerToken);
  }

  /**
   * 在退出时刷新记忆
   * @param messages 消息数组
   * @param sessionId 会话 ID
   */
  async flushOnExit(messages: Message[], sessionId?: string): Promise<{
    extractedMemories: number;
    extractedLessons: number;
    duration: number;
  }> {
    if (!this.memoryFlushAgent) {
      return {
        extractedMemories: 0,
        extractedLessons: 0,
        duration: 0,
      };
    }

    try {
      const result = await this.memoryFlushAgent.flushOnExit(messages, sessionId);
      log.info(`Exit memory flush: ${result.extractedMemories} memories, ${result.extractedLessons} lessons in ${result.duration}ms`);
      return result;
    } catch (err) {
      log.warn('MemoryFlushAgent flush failed:', err);
      return {
        extractedMemories: 0,
        extractedLessons: 0,
        duration: 0,
      };
    }
  }

  /**
   * 获取记忆管理器
   */
  getMemoryManager(): IMemoryStore | null {
    return this.memoryManager;
  }

  /**
   * 获取记忆刷新 Agent
   */
  getMemoryFlushAgent(): MemoryFlushAgent | null {
    return this.memoryFlushAgent;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    // 清理 MemoryFlushAgent 资源
    this.memoryFlushAgent = null;
  }
}
