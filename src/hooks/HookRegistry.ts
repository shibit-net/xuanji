/**
 * HookRegistry — Hook 注册表核心
 *
 * 职责:
 * - 加载 Hook 配置
 * - 管理事件订阅和 Handler 注册
 * - 分发事件到对应的 Handler
 * - 作用域过滤（global/parent/subagent）
 * - 提供 prompt 注入回调
 */

import { HookEventEmitter, type HookListener } from './EventEmitter.js';
import { executeCommandHandler } from './handlers/CommandHandler.js';
import { executePromptHandler } from './handlers/PromptHandler.js';
import { executeAgentHandler, setAgentHandlerDeps, type AgentHandlerDeps } from './handlers/AgentHandler.js';
import type {
  HookEvent,
  HookHandler,
  HookConfig,
  HookEventContext,
  HookHandlerResult,
  HookRegistryOptions,
  HookScope,
  SYNC_EVENTS,
} from './types.js';

/** Prompt 注入回调（由 ChatSession 或 AgentLoop 设置） */
export type PromptInjector = (content: string) => void;

export class HookRegistry {
  private emitter: HookEventEmitter;
  private config: HookConfig = {};
  private options: Required<HookRegistryOptions>;
  private promptInjector: PromptInjector | null = null;
  /** 记录最近执行的 hook 结果（用于调试） */
  private lastResults: Map<HookEvent, HookHandlerResult[]> = new Map();

  constructor(options?: HookRegistryOptions) {
    this.options = {
      defaultTimeout: options?.defaultTimeout ?? 5000,
      isSubAgent: options?.isSubAgent ?? false,
      disabled: options?.disabled ?? false,
    };
    this.emitter = new HookEventEmitter(this.options.defaultTimeout);
  }

  /**
   * 加载 Hook 配置并注册所有 Handler
   */
  loadConfig(config: HookConfig): void {
    this.config = config;

    // 清空旧的监听器
    this.emitter.removeAllListeners();

    // 注册配置中的所有 Handler
    for (const [event, handlers] of Object.entries(config)) {
      if (!handlers || !Array.isArray(handlers)) continue;

      for (const handler of handlers) {
        if (handler.enabled === false) continue;

        const listener = this.createListener(handler);
        if (listener) {
          this.emitter.on(event as HookEvent, listener);
        }
      }
    }
  }

  /**
   * 触发异步事件（PostToolUse 等）
   *
   * 非阻塞，所有 Handler 并行执行
   */
  async emit(
    event: HookEvent,
    context: Partial<HookEventContext> = {},
  ): Promise<HookHandlerResult[]> {
    if (this.options.disabled) return [];
    if (!this.emitter.hasListeners(event)) return [];

    const fullContext: HookEventContext = {
      event,
      timestamp: Date.now(),
      ...context,
    };

    const results = await this.emitter.emit(event, fullContext);

    // 处理 Prompt Handler 的注入
    this.processPromptResults(results);

    this.lastResults.set(event, results);

    // 慢 Hook 告警（> 1s）
    for (const result of results) {
      if (result.duration && result.duration > 1000) {
        console.warn(
          `[HookRegistry] Slow hook on ${event}: ${result.duration}ms`,
        );
      }
    }

    return results;
  }

  /**
   * 触发同步事件（PreToolUse 等）
   *
   * 串行执行，Handler 可阻塞主流程。
   * @returns 是否被阻塞
   */
  async emitSync(
    event: HookEvent,
    context: Partial<HookEventContext> = {},
  ): Promise<{ blocked: boolean; results: HookHandlerResult[] }> {
    if (this.options.disabled) {
      return { blocked: false, results: [] };
    }
    if (!this.emitter.hasListeners(event)) {
      return { blocked: false, results: [] };
    }

    const fullContext: HookEventContext = {
      event,
      timestamp: Date.now(),
      ...context,
    };

    const result = await this.emitter.emitSync(event, fullContext);

    // 处理 Prompt Handler 的注入
    this.processPromptResults(result.results);

    this.lastResults.set(event, result.results);

    return result;
  }

  /**
   * 设置 Prompt 注入回调
   */
  setPromptInjector(injector: PromptInjector): void {
    this.promptInjector = injector;
  }

  /**
   * 注入 LLM Provider 依赖（启用 Agent Handler）
   */
  setAgentHandlerDeps(deps: AgentHandlerDeps): void {
    setAgentHandlerDeps(deps);
  }

  /**
   * 检查事件是否有注册的 Handler
   */
  hasHandlers(event: HookEvent): boolean {
    return this.emitter.hasListeners(event);
  }

  /**
   * 获取最近一次事件的执行结果
   */
  getLastResults(event: HookEvent): HookHandlerResult[] {
    return this.lastResults.get(event) ?? [];
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<HookConfig> {
    return this.config;
  }

  /**
   * 是否已禁用
   */
  isDisabled(): boolean {
    return this.options.disabled;
  }

  /**
   * 动态禁用/启用
   */
  setDisabled(disabled: boolean): void {
    this.options.disabled = disabled;
  }

  /**
   * 手动添加事件监听器（用于编程式注册）
   */
  addListener(event: HookEvent, listener: HookListener): void {
    this.emitter.on(event, listener);
  }

  /**
   * 清除所有监听器
   */
  clear(): void {
    this.emitter.removeAllListeners();
    this.config = {};
    this.lastResults.clear();
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 根据 Handler 配置创建 listener
   */
  private createListener(handler: HookHandler): HookListener | null {
    // 作用域过滤
    if (!this.matchScope(handler.scope ?? 'global')) {
      return null;
    }

    switch (handler.type) {
      case 'command':
        return async (context) => {
          // 工具名称匹配
          if (handler.match?.toolName && context.toolName) {
            const regex = new RegExp(handler.match.toolName);
            if (!regex.test(context.toolName)) {
              return { success: true, blocked: false };
            }
          }
          return executeCommandHandler(handler, context);
        };

      case 'prompt':
        return async (context) => {
          if (handler.match?.toolName && context.toolName) {
            const regex = new RegExp(handler.match.toolName);
            if (!regex.test(context.toolName)) {
              return { success: true, blocked: false };
            }
          }
          return executePromptHandler(handler, context);
        };

      case 'agent':
        return async (context) => {
          if (handler.match?.toolName && context.toolName) {
            const regex = new RegExp(handler.match.toolName);
            if (!regex.test(context.toolName)) {
              return { success: true, blocked: false };
            }
          }
          return executeAgentHandler(handler, context);
        };

      default:
        return null;
    }
  }

  /**
   * 检查 Handler 作用域是否匹配当前环境
   */
  private matchScope(scope: HookScope): boolean {
    switch (scope) {
      case 'global':
        return true;
      case 'parent':
        return !this.options.isSubAgent;
      case 'subagent':
        return this.options.isSubAgent;
      default:
        return true;
    }
  }

  /**
   * 处理 Prompt Handler 的注入结果
   */
  private processPromptResults(results: HookHandlerResult[]): void {
    if (!this.promptInjector) return;

    for (const result of results) {
      if (result.success && result.promptContent) {
        this.promptInjector(result.promptContent);
      }
    }
  }
}
