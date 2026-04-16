/**
 * 任务路由器
 *
 * 纯规则路由，零 LLM 调用：
 * - 显式触发词（/plan 等）→ decompose
 * - 其他 → direct，交给 AgentLoop + LLM 自行决策
 */

import type { RoutingConfig, RoutingDecision, SessionContext } from './types';
import { TriggerDetector } from './TriggerDetector';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'task-router' });

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  mode: 'auto',
  complexity: {
    minStepsForMultiAgent: 5,
    tokenThreshold: 8000,
    useAnalyzer: false,
    analyzerModel: 'claude-haiku-4-5-20251001',
    cacheTTL: 300,
  },
  runtimeUpgrade: {
    enabled: false,
    autoConfirm: false,
    thresholds: { maxSteps: 10, maxTokens: 8000 },
  },
  executionPlan: {
    enabled: true,
    requireConfirmation: true,
    planTimeout: 60,
  },
};

export class TaskRouter {
  private triggerDetector: TriggerDetector;

  constructor(
    private config: RoutingConfig,
    _provider?: unknown, // 保留参数兼容旧调用方，不再使用
  ) {
    this.triggerDetector = new TriggerDetector();
  }

  async route(userInput: string, _context?: SessionContext): Promise<RoutingDecision> {
    if (this.config.mode === 'never') {
      return { mode: 'direct', reason: 'config-forced', timestamp: new Date().toISOString() };
    }
    if (this.config.mode === 'always') {
      return { mode: 'decompose', reason: 'config-forced', timestamp: new Date().toISOString() };
    }

    const trigger = this.triggerDetector.detect(userInput);
    if (trigger) {
      log.debug('Routing to decompose (explicit trigger)', { trigger });
      return { mode: 'decompose', reason: 'explicit-trigger', trigger, timestamp: new Date().toISOString() };
    }

    return { mode: 'direct', reason: 'default', timestamp: new Date().toISOString() };
  }

  getTriggerDetector(): TriggerDetector { return this.triggerDetector; }
  updateConfig(config: Partial<RoutingConfig>): void { this.config = { ...this.config, ...config }; }
  getConfig(): RoutingConfig { return this.config; }
}
