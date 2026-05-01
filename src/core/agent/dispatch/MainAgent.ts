/**
 * MainAgent - 主调度 Agent（基于 AgentLoop）
 *
 * 通过 system prompt 描述调度职责，
 * 使用 agent_team / task 工具委派具体工作给子 Agent。
 * 支持多轮对话、流式输出、工具调用。
 */

import type { AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { AgentCallbacks } from '@/core/agent/AgentLoop';
import type { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { IntentClassifier } from './IntentClassifier';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MainAgent' });


export interface MainAgentOptions {
  provider: ILLMProvider;
  registry: IToolRegistry;
  config: AgentConfig;
  agentRegistry: AgentRegistry;
  hookRegistry?: HookRegistry;
  promptBuilder?: LayeredPromptBuilder;
  userId?: string;
}

export class MainAgent {
  private agentLoop: AgentLoop;
  private intentClassifier: IntentClassifier;
  private classifierInitialized: boolean = false;
  private hookRegistry?: HookRegistry;
  private promptBuilder?: LayeredPromptBuilder;

  constructor(options: MainAgentOptions) {
    // 主agent的systemPrompt会在run时通过LayeredPromptBuilder动态构建
    // 这里只设置一个占位符，避免AgentLoop初始化时报错
    const config: AgentConfig = {
      ...options.config,
      systemPrompt: '', // 占位符，会在run()中被动态prompt覆盖
    };

    this.agentLoop = new AgentLoop(
      options.provider,
      options.registry,
      config,
      options.userId,
    );

    if (options.hookRegistry) {
      this.hookRegistry = options.hookRegistry;
      this.agentLoop.setHookRegistry(options.hookRegistry);
    }

    if (options.promptBuilder) {
      this.promptBuilder = options.promptBuilder;
    }

    // 创建 IntentClassifier 实例（封装3层降级策略）
    this.intentClassifier = new IntentClassifier({
      agentRegistry: options.agentRegistry,
      intentAnalyzer: this.promptBuilder?.['intentAnalyzer'],
      hookRegistry: this.hookRegistry,
    });

    // 记录 LLM 决策：直接回答 vs 工具调用
    let _textReceived = false;
    let _toolsCalled: string[] = [];
    this.agentLoop.on({
      onText: () => { _textReceived = true; },
      onToolStart: (id, name) => { _toolsCalled.push(name); },
      onEnd: (state) => {
        if (_toolsCalled.length > 0) {
          log.info(`[MainAgent] 决策=工具调用 tools=[${_toolsCalled.join(', ')}] iterations=${state.currentIteration}`);
        } else if (_textReceived) {
          log.info(`[MainAgent] 决策=直接回答 iterations=${state.currentIteration}`);
        }
        _textReceived = false;
        _toolsCalled = [];
      },
    });

    log.info('MainAgent initialized (prompt will be built dynamically per request)');
  }

  /**
   * 从 ModelClassifier 的 scene 推断 prompt complexity
   * ModelClassifier 输出的 complexity 用于决策路径（simple/complex）
   * 这里将其映射到 IntentAnalyzer 的 complexity（simple/standard/complex）用于 prompt 构建
   */
  private mapToPromptComplexity(complexity: 'simple' | 'standard' | 'complex'): import('@/core/prompt/types').IntentComplexity {
    return complexity;
  }

  on(callbacks: AgentCallbacks): void {
    this.agentLoop.on(callbacks);
  }

  async run(userMessage: string): Promise<void> {
    log.info(`[MainAgent] run start: "${userMessage.substring(0, 100)}"`);
    const start = Date.now();

    // 一次意图分析，结果分两路用：
    //   1. scene + complexity → 控制 prompt 组装（选哪些组件）
    //   2. agent → 注入 hint 辅助 LLM 决策
    let scene: string | undefined;
    let complexity: import('@/core/prompt/types').IntentComplexity | undefined;
    let classification: import('./ModelClassifier').ClassificationResult | null = null;

    // 首次运行时懒加载 IntentClassifier（失败不影响主流程）
    log.info(`[MainAgent] classifierInitialized=${this.classifierInitialized}`);
    if (!this.classifierInitialized) {
      this.classifierInitialized = true;
      log.info('[MainAgent] Initializing IntentClassifier for the first time...');
      await this.intentClassifier.init().then(() => {
        if (this.intentClassifier.isAvailable()) {
          log.info(`[MainAgent] IntentClassifier ready: ${this.intentClassifier.getCurrentModel()}`);
        } else {
          log.info('[MainAgent] IntentClassifier not available (model not loaded)');
        }
      }).catch((err) => {
        log.warn('[MainAgent] IntentClassifier init failed, will use default:', err);
      });
    } else {
      // 已初始化，但仍然调用 init() 来检测配置变化（不会重复初始化）
      log.info('[MainAgent] IntentClassifier already initialized, checking for config changes...');
      await this.intentClassifier.init().catch((err) => {
        log.warn('[MainAgent] IntentClassifier config check failed:', err);
      });
      log.info('[MainAgent] Config check completed');
    }

    // 使用 IntentClassifier（封装3层降级策略）
    try {
      const classifyStart = Date.now();
      classification = await this.intentClassifier.classify(userMessage);
      const classifyMs = Date.now() - classifyStart;

      log.info(`[MainAgent] 意图分类: scene=${classification.scene} agent=${classification.agent} complexity=${classification.complexity} (${classifyMs}ms)`);
      scene = classification.scene;
      complexity = this.mapToPromptComplexity(classification.complexity);
    } catch (err) {
      log.warn('[MainAgent] 意图分类失败，使用默认配置:', err);
      // 使用默认配置
      scene = 'general';
      complexity = 'simple';
    }

    // 构建 system prompt，传入已分析的 scene + complexity + agent
    if (this.promptBuilder) {
      try {
        const buildResult = await this.promptBuilder.build({
          userMessage,
          ...(scene && { scene }),
          ...(complexity && { complexity }),
          ...(classification?.agent && { agent: classification.agent }),
          ...(classification?.matchMethod && { matchMethod: classification.matchMethod }),
        });

        // 组合prompt：L0(全局) + 意图分析结果 + 主agent自身的prompt
        const messageManager = this.agentLoop.getMessageManager();

        // 注入意图分析结果到 prompt 中
        // 简单任务+指定agent → 直接给出调用命令，阻止 LLM 绕路创建临时 agent
        let intentHint = '';
        if (classification?.agent && classification.agent !== 'general') {
          if (classification.complexity === 'simple') {
            intentHint = `\n\n[意图分析结果]\nscene: ${classification.scene || 'auto'}\nagent: ${classification.agent}\ncomplexity: simple\n\n→ 调用 match_agent({ task_description: "<用户需求>", preferred_agent: "${classification.agent}" }) 验证后直接委派`;
          } else {
            intentHint = `\n\n[意图分析结果]\nscene: ${classification.scene || 'auto'}\nagent: ${classification.agent}\ncomplexity: ${classification.complexity}`;
          }
        } else if (classification?.scene === 'discuss') {
          intentHint = `\n\n[意图分析结果]\nscene: discuss\n\n→ 这是讨论/辩论话题，调用 match_agent({ task_description: "<话题描述>" }) 查找有相关能力背景的 agent 进行讨论，不要自己回答`;
        }

        const finalPrompt = buildResult.prompt + intentHint;
        (messageManager as any).systemPrompt = finalPrompt;

        log.info(`[MainAgent] prompt built: scene=${buildResult.scene} complexity=${buildResult.complexity} components=${buildResult.components.length} ~${buildResult.estimatedTokens} tokens`);

        // 🔍 调试日志：打印加载的组件列表和是否包含 l2-team-coordination
        const componentIds = buildResult.components.map((c: any) => c.id).join(', ');
        const hasTeamCoordination = buildResult.components.some((c: any) => c.id === 'l2-team-coordination');
        log.debug(`[MainAgent] 📋 Loaded components: [${componentIds}]`);
        log.debug(`[MainAgent] 🔍 Contains l2-team-coordination: ${hasTeamCoordination}`);

        // 🔍 调试日志：打印完整的 system prompt（仅在 debug 模式下）
        if (process.env.DEBUG_PROMPT === 'true') {
          log.debug(`[MainAgent] 📝 Full system prompt:\n${'='.repeat(80)}\n${finalPrompt}\n${'='.repeat(80)}`);
        }
      } catch (err) {
        log.warn('[MainAgent] Failed to build system prompt, using default:', err);
      }
    }

    try {
      await this.agentLoop.run(userMessage);
      log.info(`[MainAgent] run complete in ${Date.now() - start}ms`);
    } catch (err) {
      log.error(`[MainAgent] run failed after ${Date.now() - start}ms: ${err instanceof Error ? err.message : String(err)}`, { stack: err instanceof Error ? err.stack : undefined });
      throw err;
    }
  }

  stop(): void {
    this.agentLoop.stop();
  }

  interrupt(message: string): void {
    this.agentLoop.interrupt(message);
  }

  reset(): void {
    this.agentLoop.reset();
  }

  getAgentLoop(): AgentLoop {
    return this.agentLoop;
  }

  getState() {
    return this.agentLoop.getState();
  }
}
