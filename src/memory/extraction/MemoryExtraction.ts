// ============================================================
// MemoryExtraction - 提取层实现
// ============================================================
// 负责从对话、决策、反馈中提取记忆
//
// 职责:
// - 规则提取（快速）
// - LLM 提取（深度）
// - 记忆分类和权重计算
// ============================================================

import type { MemoryEntry, MemoryConfig } from '@/memory/types';
import type { IMemoryExtraction, Message, DecisionContext } from '../interfaces';
import { MemoryExtractor } from '../MemoryExtractor';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryExtraction' });

/**
 * MemoryExtraction - 提取层实现
 */
export class MemoryExtraction implements IMemoryExtraction {
  private extractor: MemoryExtractor;

  constructor(config: MemoryConfig, projectRoot?: string) {
    this.extractor = new MemoryExtractor(config, projectRoot);
  }

  /**
   * 从对话中提取记忆
   */
  async extractFromConversation(messages: Message[]): Promise<MemoryEntry[]> {
    log.debug(`Extracting from ${messages.length} messages`);

    // 使用现有的 MemoryExtractor
    const result = await this.extractor.extract(messages as any);

    return result.memories;
  }

  /**
   * 从决策中提取记忆
   */
  async extractFromDecision(decision: DecisionContext): Promise<MemoryEntry[]> {
    log.debug(`Extracting from decision: ${decision.operation}`);

    // 构造消息格式
    const messages = [
      {
        role: 'user' as const,
        content: `Operation: ${decision.operation}\nContext: ${JSON.stringify(decision.context)}`,
        timestamp: Date.now()
      }
    ];

    return await this.extractFromConversation(messages);
  }

  /**
   * 从反馈中提取记忆
   */
  async extractFromFeedback(feedback: string): Promise<MemoryEntry[]> {
    log.debug('Extracting from feedback');

    const messages = [
      {
        role: 'user' as const,
        content: `Feedback: ${feedback}`,
        timestamp: Date.now()
      }
    ];

    return await this.extractFromConversation(messages);
  }
}
