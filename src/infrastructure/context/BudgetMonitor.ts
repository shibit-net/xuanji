import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';
import { TokenCounter } from './TokenCounter';
import type { BudgetStatus } from './types';
import type { Message } from '@/infrastructure/core-types';

const YELLOW_THRESHOLD = 0.7;
const RED_THRESHOLD = 0.9;

export class BudgetMonitor {
  private tokenCounter: TokenCounter;

  constructor(maxContextTokens?: number, reservedOutputTokens?: number) {
    this.tokenCounter = new TokenCounter(maxContextTokens, reservedOutputTokens);
  }

  check(messages: Message[]): BudgetStatus {
    const estimated = this.tokenCounter.estimate(messages);
    const maxInput = this.tokenCounter.getMaxInputTokens();
    const pct = maxInput > 0 ? estimated / maxInput : 0;

    if (pct >= RED_THRESHOLD) {
      const status: BudgetStatus = { level: 'red', usagePercent: pct, requiredAction: 'compress' };
      eventBus.emit(XuanjiEvent.TOKEN_BUDGET_WARNING, status);
      return status;
    }
    if (pct >= YELLOW_THRESHOLD) {
      return {
        level: 'yellow',
        usagePercent: pct,
        suggestion: `上下文已达 ${Math.round(pct * 100)}%，建议提前压缩`,
      };
    }
    return { level: 'green', usagePercent: pct };
  }

  getTokenCounter(): TokenCounter { return this.tokenCounter; }
}
