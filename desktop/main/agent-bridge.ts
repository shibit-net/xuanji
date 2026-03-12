// ============================================================
// agent-bridge.ts — ChatSession 子进程桥接
// ============================================================
//
// 在独立 Node.js 进程中运行 ChatSession，
// 通过 process.send/process.on 与 Electron 主进程通信。
// 这样 better-sqlite3 等 native 模块使用系统 Node.js 加载，
// 不受 Electron ABI 限制。
//

import { ChatSession } from '../../src/core/chat/ChatSession.js';

let session: ChatSession | null = null;
let agentLoop: any = null;

/**
 * 处理来自主进程的消息
 */
process.on('message', async (msg: any) => {
  switch (msg.type) {
    case 'init':
      await handleInit();
      break;
    case 'send-message':
      await handleSendMessage(msg.data);
      break;
    case 'interrupt':
      handleInterrupt();
      break;
    case 'reset':
      handleReset();
      break;
    case 'get-state':
      handleGetState(msg.requestId);
      break;
    case 'get-config':
      handleGetConfig(msg.requestId);
      break;
    case 'get-full-config':
      handleGetFullConfig(msg.requestId);
      break;
    case 'update-config':
      handleUpdateConfig(msg.requestId, msg.data);
      break;
  }
});

/**
 * 初始化 ChatSession
 */
async function handleInit() {
  try {
    session = new ChatSession();
    await session.init();
    agentLoop = session.getAgentLoop();

    // 注册流式事件回调，转发到主进程
    session.on({
      onText: (text: string) => {
        process.send?.({ type: 'agent:text', data: text });
      },
      onThinking: (thinking: string) => {
        process.send?.({ type: 'agent:thinking', data: thinking });
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        process.send?.({ type: 'agent:tool-start', data: { id, name, input } });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        process.send?.({ type: 'agent:tool-end', data: { id, name, result, isError } });
      },
      onUsage: (usage: any) => {
        process.send?.({ type: 'agent:usage', data: usage });
      },
      onError: (err: Error) => {
        process.send?.({ type: 'agent:error', data: err.message });
      },
      onEnd: (state: any) => {
        process.send?.({
          type: 'agent:end',
          data: {
            tokenUsage: state.tokenUsage,
            cost: state.cost,
            currentIteration: state.currentIteration,
          },
        });
      },
    });

    process.send?.({
      type: 'init-result',
      data: { success: true },
    });
  } catch (err) {
    process.send?.({
      type: 'init-result',
      data: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * 发送消息
 */
async function handleSendMessage(message: string) {
  if (!session || !agentLoop) {
    process.send?.({
      type: 'send-result',
      data: { success: false, error: '会话未初始化' },
    });
    return;
  }

  try {
    await agentLoop.run(message);
    process.send?.({
      type: 'send-result',
      data: { success: true },
    });
  } catch (err) {
    process.send?.({
      type: 'send-result',
      data: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * 中断执行
 */
function handleInterrupt() {
  if (agentLoop) {
    agentLoop.interrupt();
    process.send?.({
      type: 'interrupt-result',
      data: { success: true },
    });
  } else {
    process.send?.({
      type: 'interrupt-result',
      data: { success: false, error: '会话未初始化' },
    });
  }
}

/**
 * 重置会话
 */
function handleReset() {
  if (session) {
    session.reset();
    process.send?.({
      type: 'reset-result',
      data: { success: true },
    });
  } else {
    process.send?.({
      type: 'reset-result',
      data: { success: false, error: '会话未初始化' },
    });
  }
}

/**
 * 获取状态
 */
function handleGetState(requestId: string) {
  if (!session) {
    process.send?.({
      type: 'state-result',
      requestId,
      data: {
        status: 'idle',
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
      },
    });
    return;
  }

  const state = session.getState();
  process.send?.({
    type: 'state-result',
    requestId,
    data: {
      status: state.status,
      tokenUsage: state.tokenUsage,
      cost: state.cost,
      currentIteration: state.currentIteration,
    },
  });
}

/**
 * 获取配置
 */
function handleGetConfig(requestId: string) {
  if (!session) {
    process.send?.({
      type: 'config-result',
      requestId,
      data: null,
    });
    return;
  }

  const config = session.getConfig();
  process.send?.({
    type: 'config-result',
    requestId,
    data: {
      model: config.provider.model,
      adapter: config.provider.adapter || 'anthropic',
      apiKey: config.provider.apiKey ? '***' + config.provider.apiKey.slice(-4) : '',
      baseURL: config.provider.baseURL || '',
      maxTokens: config.provider.maxTokens,
      temperature: config.provider.temperature,
      lightModel: config.provider.lightModel || '',
    },
  });
}

/**
 * 获取完整配置（供设置页面使用）
 */
function handleGetFullConfig(requestId: string) {
  if (!session) {
    process.send?.({ type: 'full-config-result', requestId, data: null });
    return;
  }

  const config = session.getConfig();
  process.send?.({
    type: 'full-config-result',
    requestId,
    data: {
      provider: {
        model: config.provider.model,
        adapter: config.provider.adapter || 'anthropic',
        apiKey: config.provider.apiKey ? '***' + config.provider.apiKey.slice(-4) : '',
        hasApiKey: !!config.provider.apiKey,
        baseURL: config.provider.baseURL || '',
        maxTokens: config.provider.maxTokens,
        temperature: config.provider.temperature,
        lightModel: config.provider.lightModel || '',
      },
      memory: {
        enabled: config.memory?.enabled ?? true,
      },
      features: {
        dynamicToolLoading: config.features?.dynamicToolLoading ?? true,
      },
    },
  });
}

/**
 * 更新配置（设置页面保存时调用）
 */
async function handleUpdateConfig(requestId: string, data: any) {
  if (!session) {
    process.send?.({
      type: 'update-config-result',
      requestId,
      data: { success: false, error: '会话未初始化' },
    });
    return;
  }

  try {
    // 读取当前配置文件并更新
    const { ConfigLoader } = await import('../../src/core/config/ConfigLoader.js');
    const configLoader = new ConfigLoader();
    const currentConfig = await configLoader.load();

    // 合并新配置
    if (data.apiKey && !data.apiKey.startsWith('***')) {
      currentConfig.provider.apiKey = data.apiKey;
    }
    if (data.model) {
      currentConfig.provider.model = data.model;
    }
    if (data.adapter) {
      currentConfig.provider.adapter = data.adapter;
    }
    if (data.baseURL !== undefined) {
      currentConfig.provider.baseURL = data.baseURL;
    }

    // 重新初始化 ChatSession
    await session.reinitialize(currentConfig);
    agentLoop = session.getAgentLoop();

    // 重新注册事件回调
    session.on({
      onText: (text: string) => {
        process.send?.({ type: 'agent:text', data: text });
      },
      onThinking: (thinking: string) => {
        process.send?.({ type: 'agent:thinking', data: thinking });
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        process.send?.({ type: 'agent:tool-start', data: { id, name, input } });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        process.send?.({ type: 'agent:tool-end', data: { id, name, result, isError } });
      },
      onUsage: (usage: any) => {
        process.send?.({ type: 'agent:usage', data: usage });
      },
      onError: (err: Error) => {
        process.send?.({ type: 'agent:error', data: err.message });
      },
      onEnd: (state: any) => {
        process.send?.({
          type: 'agent:end',
          data: {
            tokenUsage: state.tokenUsage,
            cost: state.cost,
            currentIteration: state.currentIteration,
          },
        });
      },
    });

    process.send?.({
      type: 'update-config-result',
      requestId,
      data: { success: true },
    });
  } catch (err) {
    process.send?.({
      type: 'update-config-result',
      requestId,
      data: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

// 优雅退出
process.on('SIGTERM', async () => {
  if (session) {
    await session.cleanup().catch(() => {});
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (session) {
    await session.cleanup().catch(() => {});
  }
  process.exit(0);
});
