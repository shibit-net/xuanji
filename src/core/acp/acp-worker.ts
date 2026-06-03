/**
 * ACP Worker — 子进程入口
 *
 * 通过 child_process.fork() 启动，接收主进程的请求，
 * 在独立进程中运行 AgentLoop，事件通过 process.send() 流回主进程。
 *
 * 启动方式：tsx src/core/acp/acp-worker.ts
 */

import type { AcpRequest, AcpRunRequest, AcpMessage, AcpRunResult, AcpEvent } from './types';
import { AgentLoop } from '@/agent/AgentLoop';
import { AgentFactory } from '@/agent/factory/AgentFactory';
import { getConfigManager } from '@/core/config/ConfigManager';
import { createDefaultRegistry } from '@/tools/ToolRegistry';
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
    // 初始化 ConfigManager（子进程需要独立初始化）
    await getConfigManager().initForUser(payload.userId || 'default');

    // 创建 base registry + AgentFactory
    const baseRegistry = createDefaultRegistry();
    const factory = new AgentFactory(baseRegistry);

    // 通过工厂创建 AgentLoop（自动判断已注册/临时 agent）
    const { agentLoop } = await factory.createAcpAgent(payload.agentId, {
      parentConfig: payload.parentConfig || {},
      systemPrompt: payload.systemPrompt,
      tools: payload.tools,
      workingDir: payload.workingDir,
      maxIterations: payload.maxIterations,
    });

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
      onToolEnd: (id, name, result, isError, metadata, contentBlocks) => {
        sendEvent(requestId, 'tool_end', { id, name, result, isError, metadata, contentBlocks });
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
      sendError((request as { requestId?: string }).requestId ?? 'unknown', `Unknown request type: ${(request as any).type}`);
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
