/**
 * TurnLifecycleManager — 对话轮次生命周期管理器
 *
 * 职责：管理每轮对话结束后的自动保存、消息淘汰、会话归档
 */

import type { AgentLoop } from '@/core/agent/AgentLoop';
import type { SessionManager } from '@/session/SessionManager';
import type { AppConfig } from '@/core/types';
import type { Message as SessionMessage, HistoryMessage } from '@/session/types';
import type { SessionCallbacks } from './ChatSession';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TurnLifecycleManager' });

export class TurnLifecycleManager {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly sessionManager: SessionManager,
    private readonly config: AppConfig,
    private readonly sessionCallbacks: () => SessionCallbacks | undefined,
  ) {}

  /**
   * 每轮对话结束后调用：自动保存 + 消息淘汰 + 归档检查
   */
  async afterTurn(turnCount: number): Promise<void> {
    await this.autoSaveAfterTurn(turnCount);
    await this.evictIfNeeded();
    await this.checkAndArchive();
  }

  private async autoSaveAfterTurn(turnCount: number): Promise<void> {
    const messages = this.agentLoop.getMessageHistory();
    if (messages.length === 0) return;

    const state = this.agentLoop.getState();
    const historyMessages = this.extractHistoryMessages(messages as SessionMessage[]);
    await this.sessionManager.save(messages as SessionMessage[], undefined, {
      usage: {
        input: state.tokenUsage.input,
        output: state.tokenUsage.output,
        cost: state.cost,
        cacheRead: state.tokenUsage.cacheRead,
        cacheWrite: state.tokenUsage.cacheWrite,
      },
      historyMessages,
    });
    log.debug(`Auto-saved session (turn ${turnCount})`);
  }

  private extractHistoryMessages(messages: SessionMessage[]): HistoryMessage[] {
    try {
      const result: HistoryMessage[] = [];

      for (const msg of messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;

        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textBlocks = msg.content.filter((block: any) => block.type === 'text' && block.text);
          text = textBlocks.map((block: any) => block.text).join('\n');
        }

        if (!text.trim()) continue;

        result.push({
          role: msg.role as 'user' | 'assistant',
          content: text,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      log.error('Extract history messages failed:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async evictIfNeeded(): Promise<void> {
    const maxMessages = this.config.session?.maxMessages ?? 100;
    if (maxMessages <= 0) return;

    const messages = this.agentLoop.getMessageHistory();
    if (messages.length < maxMessages) return;

    log.info(`Message eviction triggered: ${messages.length} messages >= limit ${maxMessages}`);

    try {
      let summary = '';
      try {
        const compactResult = await this.agentLoop.compact();
        if (compactResult?.summary) {
          summary = compactResult.summary;
        }
      } catch (compactErr) {
        log.debug('Compact failed during eviction, proceeding without summary:', compactErr);
      }

      if (!summary) {
        const userMessages = messages
          .filter(m => m.role === 'user' && typeof m.content === 'string')
          .slice(-3)
          .map(m => (m.content as string).slice(0, 100));
        summary = `[上一个会话包含 ${messages.length} 条消息]\n主要话题: ${userMessages.join('; ')}`;
      }

      const state = this.agentLoop.getState();
      const fullMessages = this.agentLoop.getMessageHistory();
      await this.sessionManager.save(fullMessages as SessionMessage[], undefined, {
        usage: {
          input: state.tokenUsage.input,
          output: state.tokenUsage.output,
          cost: state.cost,
          cacheRead: state.tokenUsage.cacheRead,
          cacheWrite: state.tokenUsage.cacheWrite,
        },
      });
      log.debug('Eviction: archived current session');

      this.agentLoop.reset();
      this.agentLoop.getTokenManager().reset();
      this.agentLoop.getCostTracker().restore(0);

      this.sessionManager.setActiveSessionId(null);

      this.agentLoop.getMessageManager().setSystemPromptSuffix(
        `### Previous Session Context\n\n${summary}`,
        'previous-session',
      );

      log.info('Message eviction complete: started new session with context summary');
    } catch (err) {
      log.warn('Message eviction failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private async checkAndArchive(): Promise<void> {
    if (!this.config.session) return;

    const messageCount = this.agentLoop.getMessageHistory().length;
    const state = this.agentLoop.getState();
    const tokenCount = state.tokenUsage.input + state.tokenUsage.output;

    if (!this.sessionManager.shouldArchive(messageCount, tokenCount)) return;

    log.info('📦 Archive condition met, archiving in background...');

    this.archiveInBackground(messageCount).catch((err) => {
      log.warn('Background archive failed:', err instanceof Error ? err.message : String(err));
    });
  }

  private async archiveInBackground(currentMessageIndex: number): Promise<void> {
    if (!this.config.session) return;

    try {
      const messages = this.agentLoop.getMessageHistory();

      const result = await this.sessionManager.archive(
        messages as SessionMessage[],
        currentMessageIndex,
      );

      log.info(
        `✓ Archived ${result.archivedCount} messages, ` +
        `extracted ${result.memoriesExtracted} memories`,
      );

      const keepCount = this.config.session.archiveStrategy?.keepRecentMessages ?? 10;
      let startIdx = Math.max(0, messages.length - keepCount);
      while (startIdx < messages.length - 1) {
        const firstMsg = messages[startIdx];
        if (
          firstMsg.role === 'user' &&
          Array.isArray(firstMsg.content) &&
          firstMsg.content.length > 0 &&
          (firstMsg.content[0] as { type?: string }).type === 'tool_result'
        ) {
          startIdx++;
        } else {
          break;
        }
      }
      const keptMessages = messages.slice(startIdx);
      this.agentLoop.getMessageManager().replaceMessages(keptMessages);

      log.debug(`Kept recent ${keepCount} messages after archive`);

      const callbacks = this.sessionCallbacks();
      if (callbacks?.onArchiveNotification) {
        callbacks.onArchiveNotification(result);
      }
    } catch (err) {
      log.warn('Archive failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
