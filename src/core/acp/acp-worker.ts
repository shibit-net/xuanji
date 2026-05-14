/**
 * ACP Worker — 子进程入口
 *
 * 通过 child_process.fork() 启动，接收主进程的请求，
 * 在独立进程中运行 AgentLoop，事件通过 process.send() 流回主进程。
 *
 * 启动方式：tsx src/core/acp/acp-worker.ts
 */

import type { AcpRequest, AcpRunRequest, AcpMessage, AcpRunResult, AcpEvent } from './types';
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

    // 父配置已由主进程完整解析（含 global 设置、agent-overrides），
    // 这里重新加载 agent 配置（使用正确的 userId），并合并 overrides，
    // 仅当 agent 有独立的 apiKey/baseURL 时覆盖父配置，否则继承父配置。
    try {
      const { ConfigLoader } = await import('@/core/config/ConfigLoader');
      const loader = new ConfigLoader(payload.userId || 'default', payload.agentId);
      const agentConfig = await loader.loadAgentConfig(payload.agentId);

      // 加载 agent-overrides（用户自定义覆盖）
      let agentProvider = agentConfig?.provider ? { ...(agentConfig.provider as Record<string, any>) } : null;
      try {
        const override = await loader.loadAgentOverride(payload.agentId);
        if (override?.provider && agentProvider) {
          Object.assign(agentProvider, override.provider);
        }
      } catch { /* override 加载失败忽略 */ }

      if (agentProvider) {
        // 仅当 agent 有自己的 apiKey 或 baseURL 时，才认为它有独立的 provider 配置
        if (agentProvider.apiKey || agentProvider.baseURL) {
          const merged = { ...payload.parentConfig };
          for (const [key, value] of Object.entries(agentProvider)) {
            if (value != null && value !== '') {
              merged[key] = value;
            }
          }
          agentModelConfig = merged;
          log.info(`ACP worker: agent "${payload.agentId}" has independent provider config`);
        } else {
          log.info(`ACP worker: agent "${payload.agentId}" inherits parent provider config`);
        }
      }
    } catch {
      // fall through: 使用 parentConfig
    }

    // 创建 provider
    const provider = createProvider(agentModelConfig);

    // 创建 registry（传入 workingDir，确保子 agent 能访问正确的工作目录）
    const registry = createRegistry(payload.tools, payload.workingDir);

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
function createRegistry(tools?: string[], workingDir?: string): IToolRegistry {
  const { createDefaultRegistry } = require('@/core/tools/ToolRegistry');
  const registry = createDefaultRegistry();
  const { FilteredToolRegistry, DEFAULT_SUBAGENT_TOOLS } = require('@/core/tools/FilteredToolRegistry');
  const effectiveTools = tools && tools.length > 0 ? tools : DEFAULT_SUBAGENT_TOOLS;
  return new FilteredToolRegistry(registry, effectiveTools, undefined, workingDir);
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
