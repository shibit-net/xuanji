import { logger } from '../logger/index.js';

const log = logger.child({ module: 'IntentRouter' });

export interface IntentRoute {
  agentId: string;
  confidence: number;
}

export class IntentRouter {
  private defaultAgentId: string;

  constructor(defaultAgentId = 'xuanji') {
    this.defaultAgentId = defaultAgentId;
  }

  async init(): Promise<void> {
    log.info('IntentRouter initialized');
  }

  async route(_message: string): Promise<IntentRoute> {
    // 返回默认 Agent，后续可扩展为基于向量的意图匹配
    return {
      agentId: this.defaultAgentId,
      confidence: 1.0,
    };
  }
}
