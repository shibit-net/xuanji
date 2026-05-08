/**
 * ACP Worker — 子进程入口
 *
 * 通过 child_process.fork() 启动，接收主进程的请求，
 * 在独立进程中运行 AgentLoop，事件通过 process.send() 流回主进程。
 *
 * 启动方式：tsx src/core/acp/acp-worker.ts
 */

import type { AcpRequest, AcpMessage, AcpRunResult, AcpEvent } from './types';
import type { ILLMProvider, IToolRegistry } from '@/core/types';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ACPWorker' });

let currentAgentLoop: AgentLoop | null = null;
let currentAbortController: AbortController | null = null;

/** 发送事件到主进程 */
function sendEvent(requestId: string, eventType: AcpEvent['payload']['eventType'], data: any): void {
  const msg: AcpMessage = {
    type: 'event',
    requestId,
    payload: { eventType, data },
  };
  try { process.send?.(msg); } catch { /* ignore */ }
}

/** 发送结果到主进程 */
function sendResult(requestId: string, result: AcpRunResult['payload']): void {
  const msg: AcpMessage = { type: 'result', requestId, payload: result };
  try { process.send?.(msg); } catch { /* ignore */ }
}

/** 发送错误到主进程 */
function sendError(requestId: string, message: string): void {
  const msg: AcpMessage = { type: 'error', requestId, payload: { message } };
  try { process.send?.(msg); } catch { /* ignore */ }
}

/** 处理 run 请求 */
async function handleRun(requestId: string, payload: AcpRunRequest['payload']): Promise<void> {
  const startTime = Date.now();
  let outputText = '';

  try {
    // 尝试根据 agentId 加载配置（如果注册了 agent）
    let agentModelConfig = payload.parentConfig;
    try {
      const { ConfigLoader } = await import('@/core/config/ConfigLoader');
      const loader = new ConfigLoader('default', payload.agentId);
      const config = await loader.load();
      if (config?.provider) {
        agentModelConfig = {
          ...agentModelConfig,
          ...config.provider,
        };
      }
    } catch {
      // fall through: 使用 parentConfig
    }

    // 创建 provider
    const provider = createProvider(agentModelConfig);

    // 创建 registry
    const registry = createRegistry(payload.tools);

    // 创建 AgentLoop
    const agentLoop = new AgentLoop(provider, registry, {
      model: payload.parentConfig?.model,
      apiKey: payload.parentConfig?.apiKey,
      baseURL: payload.parentConfig?.baseURL,
      maxTokens: payload.parentConfig?.maxTokens,
      temperature: payload.parentConfig?.temperature,
      maxIterations: payload.maxIterations ?? 50,
      systemPrompt: payload.systemPrompt,
    }, payload.agentId);

    currentAgentLoop = agentLoop;
    const abortController = new AbortController();
    currentAbortController = abortController;

    // 注册流回调 → 发送事件到主进程
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    agentLoop.on({
      onText: (text) => {
        outputText += text;
        sendEvent(requestId, 'text', { text });
      },
      onThinking: (thinking) => {
        sendEvent(requestId, 'thinking', { content: thinking });
      },
      onToolStart: (id, name, input) => {
        sendEvent(requestId, 'tool_start', { id, name, input });
      },
      onToolEnd: (id, name, result, isError, metadata) => {
        sendEvent(requestId, 'tool_end', { id, name, result, isError, metadata });
      },
      onToolDelta: (id, name, receivedBytes) => {
        sendEvent(requestId, 'tool_delta', { id, name, receivedBytes });
      },
    });

    // 执行
    try {
      const runPromise = agentLoop.run(payload.task, abortController.signal);
      runPromise.catch(() => {});

      const timeout = payload.timeout || 600000;
      if (timeout > 0) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            agentLoop.stop();
            timedOut = true;
            reject(new Error(`ACP worker timed out after ${timeout}ms`));
          }, timeout);
        });
        await Promise.race([runPromise, timeoutPromise]);
      } else {
        await runPromise;
      }
    } catch (error: any) {
      if (!timedOut) {
        outputText += `\n\n[Error] ${error.message}`;
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    const duration = Date.now() - startTime;
    const state = agentLoop.getState();

    sendResult(requestId, {
      success: !timedOut,
      output: outputText,
      duration,
      tokensUsed: state.tokenUsage,
      iterations: state.currentIteration,
      timedOut,
    });

  } catch (error: any) {
    sendError(requestId, error.message || String(error));
  } finally {
    currentAgentLoop = null;
    currentAbortController = null;
  }
}

/** 从父配置创建 provider */
function createProvider(parentConfig?: Record<string, any>): ILLMProvider {
  const adapter = parentConfig?.adapter;
  const model = parentConfig?.model || process.env.DEFAULT_MODEL || 'gpt-4o';
  const apiKey = parentConfig?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const baseURL = parentConfig?.baseURL;
  const maxTokens = parentConfig?.maxTokens ?? 4096;
  const temperature = parentConfig?.temperature ?? 0.7;

  // 根据 adapter 选择 provider
  if (adapter === 'anthropic') {
    const { AnthropicProvider } = require('@/core/providers/AnthropicProvider');
    return new AnthropicProvider({ model, apiKey, baseURL, maxTokens, temperature });
  }
  // 默认使用 OpenAI provider
  const { OpenAIProvider } = require('@/core/providers/OpenAIProvider');
  return new OpenAIProvider({ model, apiKey, baseURL, maxTokens, temperature });
}

/** 从工具白名单创建 registry */
function createRegistry(tools?: string[]): IToolRegistry {
  const { createDefaultRegistry } = require('@/core/tools/ToolRegistry');
  const registry = createDefaultRegistry();

  // 如果有工具白名单，用 FilteredToolRegistry 包装
  if (tools && tools.length > 0) {
    const { FilteredToolRegistry } = require('@/core/tools/FilteredToolRegistry');
    return new FilteredToolRegistry(registry, tools);
  }

  return registry;
}

// ── 主消息循环 ──────────────────────────────────────

process.on('message', async (msg: any) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'init') {
    log.info('ACP worker initialized');
    return;
  }

  const request = msg as AcpRequest;

  switch (request.type) {
    case 'run':
      try {
        await handleRun(request.requestId, request.payload);
      } catch (err) {
        sendError(request.requestId, err instanceof Error ? err.message : String(err));
      }
      break;

    case 'cancel':
      if (currentAbortController) {
        currentAbortController.abort();
        if (currentAgentLoop) {
          currentAgentLoop.stop();
        }
      }
      break;

    default:
      sendError(request.requestId, `Unknown request type: ${(request as any).type}`);
  }
});

process.on('uncaughtException', (err) => {
  log.error('ACP worker uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  log.error('ACP worker unhandled rejection:', reason);
});

// 通知主进程 worker 已就绪
process.send?.({ type: 'ready' });
