// ============================================================
// MessagePreparationHandler — 消息准备和修复逻辑
// ============================================================
//
// 处理 AgentLoop 中的消息准备、追加、修复逻辑，
// 确保消息序列的完整性和正确性。

import type { Message } from '@/core/types';
import type { MessageManager } from './MessageManager';
import { sleep } from '@/shared/utils/sleep';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MessagePreparationHandler' });

/**
 * 消息追加处理结果
 */
export interface MessageAppendResult {
  /** 是否处理了追加消息 */
  handled: boolean;
  /** 是否因硬中断 */
  wasInterrupted: boolean;
  /** 更新后的消息列表 */
  messages: Message[];
  /** 是否需要延迟 */
  delayMs: number;
}

/**
 * 边界检查结果
 */
export interface BoundaryCheckResult {
  /** 最后一个边界类型 */
  lastBoundary: 'user' | 'assistant' | 'tool_result' | null;
  /** 是否可以安全追加用户消息 */
  canAppendUser: boolean;
}

/**
 * MessagePreparationHandler — 消息准备和修复
 */
export class MessagePreparationHandler {
  constructor(
    private messageManager: MessageManager,
  ) {}

  /**
   * 处理待追加的用户消息
   * 
   * 场景：
   * 1. 硬中断（_interrupted + _pendingAppendMessage）：stream/工具已被 abort，需修复消息序列
   * 2. end_turn 后有排队消息（仅 _pendingAppendMessage）：LLM 结束回复但用户有新输入
   * 
   * @param pendingMessage 待追加的消息
   * @param wasInterrupted 是否因硬中断
   * @returns 处理结果
   */
  handlePendingAppend(
    pendingMessage: string,
    wasInterrupted: boolean,
  ): MessageAppendResult {
    // 修复消息序列（仅硬中断时需要，end_turn 时 assistant 消息已正常完成）
    if (wasInterrupted) {
      this.fixMessageSequenceAfterInterrupt();
    }

    // 防御性检查：确保 tool_use/tool_result 配对完整
    const pairedCount = this.messageManager.ensureToolResultPairing();
    if (pairedCount > 0) {
      log.warn(`Injected ${pairedCount} placeholder tool_result(s) for orphaned tool_use(s)`);
    }

    // 追加用户消息（使用 addUserMessageSafe 避免连续 user 消息）
    const merged = this.messageManager.addUserMessageSafe(pendingMessage);
    log.info(`User message ${merged ? 'merged' : 'injected'}: interrupted=${wasInterrupted}, msg="${pendingMessage.slice(0, 80)}"`);

    const messages = this.messageManager.getMessages();
    log.info(`Message injection complete: total messages=${messages.length}, interrupted=${wasInterrupted}`);

    // 短暂延迟：硬中断需更长延迟避免 API 429，温和追加只需短暂间隔
    const delayMs = wasInterrupted ? 1000 : 500;

    return {
      handled: true,
      wasInterrupted,
      messages,
      delayMs,
    };
  }

  /**
   * 修复硬中断后的消息序列
   * 
   * 如果最后一条消息是 user，插入占位 assistant 消息
   */
  private fixMessageSequenceAfterInterrupt(): void {
    const history = this.messageManager.getHistory();
    const lastMsg = history[history.length - 1];

    if (lastMsg && lastMsg.role === 'user') {
      log.debug('Interrupt: last message is user, inserting placeholder assistant message');
      const added = this.messageManager.addAssistantMessageSafe([{
        type: 'text',
        text: '[Interrupted] 用户中断了当前执行并提交了新的指令。',
      }]);
      if (!added) {
        log.warn('Interrupt: placeholder assistant not added (last message already assistant)');
      }
    } else if (lastMsg && lastMsg.role === 'assistant') {
      log.debug('Interrupt: last message is already assistant, skipping placeholder');
    }
  }

  /**
   * 检查消息边界（用于工具执行后的追加消息处理）
   * 
   * @returns 边界检查结果
   */
  checkBoundary(): BoundaryCheckResult {
    const lastBoundary = this.getLastBoundary();
    const canAppendUser = lastBoundary === 'assistant' || lastBoundary === 'tool_result';

    return {
      lastBoundary,
      canAppendUser,
    };
  }

  /**
   * 获取最后一个消息边界类型
   */
  private getLastBoundary(): 'user' | 'assistant' | 'tool_result' | null {
    const history = this.messageManager.getHistory();
    if (history.length === 0) return null;

    const lastMsg = history[history.length - 1];
    if (lastMsg.role === 'user') return 'user';
    if (lastMsg.role === 'assistant') return 'assistant';

    // 检查是否有 tool_result
    const lastTwo = history.slice(-2);
    if (lastTwo.length === 2 &&
        lastTwo[0].role === 'assistant' &&
        lastTwo[1].role === 'user') {
      // 假设 user 消息包含 tool_result（简化判断）
      return 'tool_result';
    }

    return null;
  }

  /**
   * 在工具执行后处理追加消息
   * 
   * 注意：工具执行后的追加消息应该合并到最后一个 tool_result 消息中
   * 
   * @param pendingMessage 待追加的消息
   * @returns 是否成功处理
   */
  handleAppendAfterToolExecution(pendingMessage: string): boolean {
    const boundary = this.checkBoundary();

    if (!boundary.canAppendUser) {
      log.warn(`Cannot append message after tools: lastBoundary=${boundary.lastBoundary}`);
      return false;
    }

    // 确保 tool_use/tool_result 配对完整
    const pairedCount = this.messageManager.ensureToolResultPairing();
    if (pairedCount > 0) {
      log.warn(`Injected ${pairedCount} placeholder tool_result(s) for orphaned tool_use(s)`);
    }

    // 追加用户消息
    const merged = this.messageManager.addUserMessageSafe(pendingMessage);
    log.info(`User message ${merged ? 'merged to tool_result' : 'injected'}: msg="${pendingMessage.slice(0, 80)}"`);

    return true;
  }

  /**
   * 等待延迟
   */
  async applyDelay(delayMs: number): Promise<void> {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}
