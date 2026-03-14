/**
 * 任务路由器
 *
 * 根据任务复杂度自动选择执行模式：
 * - 简单任务 → 直接执行（AgentLoop）
 * - 复杂任务 → 任务分解（Planner + Executor）
 */

import type {
  RoutingConfig,
  RoutingDecision,
  SessionContext,
} from './types';
import { ComplexityAnalyzer } from './ComplexityAnalyzer';
import { TriggerDetector } from './TriggerDetector';
import type { ILLMProvider } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'task-router' });

/**
 * 默认路由配置
 */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  mode: 'auto',

  complexity: {
    minStepsForMultiAgent: 5,
    tokenThreshold: 8000,
    useAnalyzer: true,
    analyzerModel: 'claude-haiku-4-5-20251001',
    cacheTTL: 300, // 5 分钟
  },

  runtimeUpgrade: {
    enabled: true,
    autoConfirm: false, // 需要用户确认
    thresholds: {
      maxSteps: 10,
      maxTokens: 8000,
    },
  },

  executionPlan: {
    enabled: true,
    requireConfirmation: true, // complex 任务强制确认
    planTimeout: 60, // 1 分钟
  },
};

export class TaskRouter {
  private complexityAnalyzer: ComplexityAnalyzer;
  private triggerDetector: TriggerDetector;

  constructor(
    private config: RoutingConfig,
    private provider: ILLMProvider,
  ) {
    this.triggerDetector = new TriggerDetector();
    this.complexityAnalyzer = new ComplexityAnalyzer(
      provider,
      config.complexity.analyzerModel,
      config.complexity.cacheTTL,
    );
  }

  /**
   * 决定任务执行模式
   *
   * @param userInput 用户输入
   * @param context 会话上下文
   * @returns 路由决策
   */
  async route(
    userInput: string,
    context?: SessionContext,
  ): Promise<RoutingDecision> {
    log.debug('Routing task', { input: userInput.slice(0, 100) });

    // 1. 检查配置强制模式
    if (this.config.mode === 'never') {
      log.debug('Routing to direct mode (config forced)');
      return {
        mode: 'direct',
        reason: 'config-forced',
        timestamp: new Date().toISOString(),
      };
    }

    if (this.config.mode === 'always') {
      log.debug('Routing to decompose mode (config forced)');
      return {
        mode: 'decompose',
        reason: 'config-forced',
        timestamp: new Date().toISOString(),
      };
    }

    // 2. 检测显式触发词
    const trigger = this.triggerDetector.detect(userInput);
    if (trigger) {
      log.debug('Routing to decompose mode (explicit trigger)', { trigger });
      return {
        mode: 'decompose',
        reason: 'explicit-trigger',
        trigger,
        timestamp: new Date().toISOString(),
      };
    }

    // 3. LLM 复杂度评估（如果启用）
    if (this.config.complexity.useAnalyzer) {
      const complexity = await this.complexityAnalyzer.analyze(
        userInput,
        context,
      );

      // 判断是否需要任务分解
      const needsDecompose =
        complexity.complexity === 'complex' ||
        complexity.requiresSpecialist ||
        complexity.estimatedSteps >= this.config.complexity.minStepsForMultiAgent;

      if (needsDecompose) {
        log.debug('Routing to decompose mode (complexity)', { complexity });
        return {
          mode: 'decompose',
          reason: 'complexity',
          complexity,
          timestamp: new Date().toISOString(),
        };
      }

      log.debug('Routing to direct mode (simple task)', { complexity });
      return {
        mode: 'direct',
        reason: 'default',
        complexity,
        timestamp: new Date().toISOString(),
      };
    }

    // 4. 默认：直接执行
    log.debug('Routing to direct mode (default)');
    return {
      mode: 'direct',
      reason: 'default',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 检查是否应该在运行时升级到任务分解模式
   *
   * @param currentSteps 当前已执行步骤数
   * @param currentTokens 当前已消耗 token 数
   * @returns 是否建议升级
   */
  shouldUpgrade(currentSteps: number, currentTokens: number): boolean {
    if (!this.config.runtimeUpgrade.enabled) {
      return false;
    }

    const { maxSteps, maxTokens } = this.config.runtimeUpgrade.thresholds;

    const shouldUpgrade = currentSteps >= maxSteps || currentTokens >= maxTokens;

    if (shouldUpgrade) {
      log.info('Suggesting runtime upgrade to decompose mode', {
        currentSteps,
        currentTokens,
        thresholds: { maxSteps, maxTokens },
      });
    }

    return shouldUpgrade;
  }

  /**
   * 获取触发检测器（供外部使用）
   */
  getTriggerDetector(): TriggerDetector {
    return this.triggerDetector;
  }

  /**
   * 获取复杂度分析器（供外部使用）
   */
  getComplexityAnalyzer(): ComplexityAnalyzer {
    return this.complexityAnalyzer;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<RoutingConfig>): void {
    this.config = { ...this.config, ...config };

    // 重新初始化分析器（如果模型或缓存配置变化）
    if (config.complexity) {
      this.complexityAnalyzer = new ComplexityAnalyzer(
        this.provider,
        this.config.complexity.analyzerModel,
        this.config.complexity.cacheTTL,
      );
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): RoutingConfig {
    return this.config;
  }
}
