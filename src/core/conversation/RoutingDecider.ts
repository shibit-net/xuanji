import { logger } from '@/core/logger';
import type { IntentResult, RoutingDecision, ProcessedInput, ExecuteAction, ConversationState } from './types';

const log = logger.child({ module: 'RoutingDecider' });

export class RoutingDecider {
  decide(intent: IntentResult, _state: ConversationState): RoutingDecision {
    const decision = this.route(intent);
    log.info(`Routing: ${decision.action} → ${decision.agentId || 'n/a'}`);
    return decision;
  }

  whileExecuting(input: ProcessedInput): ExecuteAction {
    if (input.source === 'shortcut' || input.original.startsWith('!')) {
      return { action: 'terminate_and_restart', mergedInput: input.original, partialResults: [] };
    }
    if (input.original.length < 200 && !input.original.includes('\n')) {
      return { action: 'gentle_append', message: input.original };
    }
    return { action: 'queue', message: input.original };
  }

  whileOutputting(input: ProcessedInput): { action: 'queue'; message: string } {
    return { action: 'queue', message: input.original };
  }

  whileWaitingAsync(input: ProcessedInput): RoutingDecision {
    log.info(`Processing input during WAITING_ASYNC: "${input.original.substring(0, 50)}"`);
    return { action: 'run_main_agent', prompt: input.original };
  }

  private route(intent: IntentResult): RoutingDecision {
    switch (intent.complexity) {
      case 'simple':
        if (intent.agent && intent.agent !== 'main') {
          return { action: 'delegate_single_agent', agentId: intent.agent, scene: intent.scene ?? 'coding' };
        }
        return { action: 'run_main_agent', prompt: '' };

      case 'complex':
        return {
          action: 'delegate_agent_team',
          members: [
            { agentId: intent.agent ?? 'general-purpose', role: 'executor' },
            { agentId: 'main', role: 'reviewer' },
          ],
        };

      default:
        return { action: 'run_main_agent', prompt: '', agentId: 'main', scene: intent.scene ?? 'coding' };
    }
  }
}
