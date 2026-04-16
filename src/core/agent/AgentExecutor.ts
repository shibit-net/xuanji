/**
 * AgentExecutor - 简化的 Agent 执行器
 *
 * 用于系统内部执行轻量 Agent（如 IntentAnalyzer）
 * 不需要完整的 AgentLoop 生命周期管理，只执行单次推理
 */

import { AgentLoop } from './AgentLoop.js';
import { ToolRegistry } from '@/core/tools/ToolRegistry.js';
import { ProviderFactory } from '@/core/providers/ProviderFactory.js';
import type { ConfigurableAgentConfig } from './types.js';
import type { AgentConfig, ILLMProvider } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'AgentExecutor' });

/**
 * Agent 执行选项
 */
export interface AgentExecuteOptions {
  /** 用户输入 */
  userMessage: string;
  /** 全局 API Key（如果 Agent 配置中未指定） */
  apiKey?: string;
  /** 全局 Base URL（如果 Agent 配置中未指定） */
  baseURL?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * Agent 执行结果
 */
export interface AgentExecuteResult {
  /** 是否成功 */
  success: boolean;
  /** Agent 输出内容 */
  content: string;
  /** 错误信息 */
  error?: string;
}

/**
 * AgentExecutor - 轻量 Agent 执行器
 *
 * 用途：
 * - 执行系统内部 Agent（如 IntentAnalyzer）
 * - 单次推理，无需完整的 AgentLoop 生命周期
 * - 简化配置，自动处理 Provider 创建
 */
export class AgentExecutor {
  /**
   * 执行 Agent
   */
  static async execute(
    agentConfig: ConfigurableAgentConfig,
    options: AgentExecuteOptions
  ): Promise<AgentExecuteResult> {
    const startTime = Date.now();

    try {
      log.debug(`Executing agent: ${agentConfig.id}`);

      // 1. 创建 Provider
      const provider = this.createProvider(agentConfig);

      // 2. 创建空的工具注册表（IntentAnalyzer 不需要工具）
      const toolRegistry = new ToolRegistry();

      // 3. 创建 AgentConfig
      const agentLoopConfig: AgentConfig = {
        model: agentConfig.model.primary,
        apiKey: options.apiKey || '',
        baseURL: options.baseURL,
        maxTokens: 1000,  // IntentAnalyzer 固定值
        temperature: 0.1, // IntentAnalyzer 固定值（低温度，确定性）
        systemPrompt: agentConfig.systemPrompt ?? undefined,
      };

      // 4. 创建 AgentLoop
      const agentLoop = new AgentLoop(provider, toolRegistry, agentLoopConfig);

      // 5. 设置回调收集输出
      let content = '';
      let completed = false;
      let error: Error | null = null;

      agentLoop.on({
        onText: (text) => {
          content += text;
        },
        onEnd: () => {
          completed = true;
        },
        onError: (err) => {
          error = err;
        },
      });

      // 6. 执行单次推理
      const timeout = options.timeout || agentConfig.execution.timeout || 10000;

      // 设置超时
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          if (!completed) {
            reject(new Error(`Agent execution timeout (${timeout}ms)`));
          }
        }, timeout);
      });

      // 执行 Agent
      const executePromise = (async () => {
        try {
          await agentLoop.run(options.userMessage);
          completed = true;
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err));
        }
      })();

      // 等待完成或超时
      await Promise.race([executePromise, timeoutPromise]);

      // 检查错误
      if (error) {
        throw error;
      }

      const duration = Date.now() - startTime;
      log.debug(`Agent executed successfully in ${duration}ms: ${agentConfig.id}`);

      return {
        success: true,
        content: content.trim(),
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Agent execution failed after ${duration}ms: ${agentConfig.id}`, err);

      return {
        success: false,
        content: '',
        error: errorMsg,
      };
    }
  }

  /**
   * 创建 Provider
   */
  private static createProvider(agentConfig: ConfigurableAgentConfig): ILLMProvider {
    const providerFactory = new ProviderFactory();
    const modelName = agentConfig.model.primary;

    const provider = providerFactory.getByModel(modelName);

    if (!provider) {
      throw new Error(`Unsupported model: ${modelName}`);
    }

    return provider;
  }
}
