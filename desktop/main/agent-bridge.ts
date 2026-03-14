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

    // ============ 会话管理 ============
    case 'session-save':
      handleSessionSave(msg.requestId, msg.data);
      break;
    case 'session-resume':
      handleSessionResume(msg.requestId, msg.data);
      break;
    case 'session-list':
      handleSessionList(msg.requestId);
      break;
    case 'session-delete':
      handleSessionDelete(msg.requestId, msg.data);
      break;
    case 'checkpoint-create':
      handleCheckpointCreate(msg.requestId, msg.data);
      break;
    case 'checkpoint-list':
      handleCheckpointList(msg.requestId);
      break;
    case 'checkpoint-rewind':
      handleCheckpointRewind(msg.requestId, msg.data);
      break;

    // ============ 记忆管理 ============
    case 'memory-retrieve':
      handleMemoryRetrieve(msg.requestId, msg.data);
      break;
    case 'memory-stats':
      handleMemoryStats(msg.requestId);
      break;

    // ============ 工具统计 ============
    case 'get-usage-stats':
      handleGetUsageStats(msg.requestId);
      break;

    // ============ Agent 管理 ============
    case 'agent-list':
      handleAgentList(msg.requestId);
      break;
    case 'agent-get':
      handleAgentGet(msg.requestId, msg.data);
      break;
    case 'agent-create':
      handleAgentCreate(msg.requestId, msg.data);
      break;
    case 'agent-update':
      handleAgentUpdate(msg.requestId, msg.data);
      break;
    case 'agent-delete':
      handleAgentDelete(msg.requestId, msg.data);
      break;

    // ============ 高级功能 ============
    case 'compact':
      handleCompact(msg.requestId, msg.data);
      break;
    case 'get-diagnostics':
      handleGetDiagnostics(msg.requestId);
      break;

    // ============ 权限交互响应 ============
    case 'permission-response':
      handlePermissionResponse(msg.data);
      break;
    case 'plan-review-response':
      handlePlanReviewResponse(msg.data);
      break;
    case 'ask-user-response':
      handleAskUserResponse(msg.data);
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

    // 注入权限交互 Handler
    injectInteractionHandlers();

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
    const { ConfigLoader } = await import('../../src/core/config/ConfigLoader.js');
    const { GlobalConfig } = await import('../../src/core/config/GlobalConfig.js');

    // 1. 读取仅全局配置（不包含环境变量覆盖）
    const globalConfig = await GlobalConfig.readGlobalConfig();

    // 2. 确保 provider 对象存在
    if (!globalConfig.provider) {
      globalConfig.provider = {} as any;
    }

    // 3. 合并新配置
    let needPersist = false;
    if (data.apiKey && !data.apiKey.startsWith('***')) {
      globalConfig.provider.apiKey = data.apiKey;
      needPersist = true;
    }
    if (data.model) {
      globalConfig.provider.model = data.model;
      needPersist = true;
    }
    if (data.adapter) {
      globalConfig.provider.adapter = data.adapter;
      needPersist = true;
    }
    if (data.baseURL !== undefined) {
      globalConfig.provider.baseURL = data.baseURL;
      needPersist = true;
    }

    // 4. 持久化到全局配置文件
    if (needPersist) {
      await GlobalConfig.writeGlobalConfig(globalConfig);
    }

    // 5. 重新加载完整配置（包含环境变量）并重新初始化
    const configLoader = new ConfigLoader();
    const fullConfig = await configLoader.load();
    await session.reinitialize(fullConfig);
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

// ============================================================
// 会话管理
// ============================================================

async function handleSessionSave(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const sessionId = await session.saveSession(data?.name, data?.options);
    process.send?.({ requestId, data: { success: true, sessionId } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleSessionResume(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const ctx = await session.resumeSession(data?.sessionId);
    process.send?.({
      requestId,
      data: {
        success: true,
        sessionId: ctx.sessionId,
        usage: ctx.usage,
        historyMessages: ctx.historyMessages,
        messageCount: ctx.messages?.length || 0,
      },
    });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleSessionList(requestId: string) {
  if (!session) {
    process.send?.({ requestId, data: { success: true, sessions: [] } });
    return;
  }
  try {
    const sessions = await session.listSessions();
    process.send?.({ requestId, data: { success: true, sessions } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleSessionDelete(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    await session.deleteSession(data?.sessionId);
    process.send?.({ requestId, data: { success: true } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCheckpointCreate(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const checkpointId = await session.createCheckpoint(data?.label);
    process.send?.({ requestId, data: { success: true, checkpointId } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCheckpointList(requestId: string) {
  if (!session) {
    process.send?.({ requestId, data: { success: true, checkpoints: [] } });
    return;
  }
  try {
    const checkpoints = await session.listCheckpoints();
    process.send?.({ requestId, data: { success: true, checkpoints } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCheckpointRewind(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const messageCount = await session.rewindToCheckpoint(data?.checkpointId);
    process.send?.({ requestId, data: { success: true, messageCount } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 记忆管理
// ============================================================

async function handleMemoryRetrieve(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: true, entries: [] } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      process.send?.({ requestId, data: { success: true, entries: [], stats: null } });
      return;
    }
    const entries = await memoryManager.retrieve(data?.query || '', data?.options);
    process.send?.({
      requestId,
      data: {
        success: true,
        entries: entries.map((e: any) => ({
          type: e.type,
          content: e.content,
          tags: e.tags,
          createdAt: e.createdAt,
          score: e.score,
        })),
      },
    });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleMemoryStats(requestId: string) {
  if (!session) {
    process.send?.({ requestId, data: { success: true, stats: null } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      process.send?.({ requestId, data: { success: true, stats: null } });
      return;
    }
    const stats = await memoryManager.getStats();
    process.send?.({ requestId, data: { success: true, stats } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 工具统计
// ============================================================

async function handleGetUsageStats(requestId: string) {
  if (!session) {
    process.send?.({ requestId, data: { success: true, stats: null } });
    return;
  }
  try {
    const state = session.getState();
    process.send?.({
      requestId,
      data: {
        success: true,
        stats: {
          status: state.status,
          tokenUsage: state.tokenUsage,
          cost: state.cost,
          currentIteration: state.currentIteration,
        },
      },
    });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 高级功能
// ============================================================

async function handleCompact(requestId: string, data: any) {
  if (!agentLoop) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const result = await agentLoop.compact(data?.instruction);
    process.send?.({
      requestId,
      data: {
        success: true,
        result: result ? {
          originalTokens: result.originalTokens,
          compressedTokens: result.compressedTokens,
          compressionRatio: result.compressionRatio,
          summary: result.summary,
        } : null,
      },
    });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleGetDiagnostics(requestId: string) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const report = await session.getDiagnostics();
    process.send?.({ requestId, data: { success: true, report } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// Agent 管理
// ============================================================

async function handleAgentList(requestId: string) {
  if (!session) {
    process.send?.({ requestId, data: { success: true, agents: [] } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      process.send?.({ requestId, data: { success: true, agents: [] } });
      return;
    }
    const agents = agentRegistry.getEnabled();
    process.send?.({ requestId, data: { success: true, agents } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentGet(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      process.send?.({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }
    const agent = agentRegistry.get(data?.agentId);
    if (!agent) {
      process.send?.({ requestId, data: { success: false, error: `Agent 不存在: ${data?.agentId}` } });
      return;
    }
    process.send?.({ requestId, data: { success: true, agent } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentCreate(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      process.send?.({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }

    // 保存到 YAML 文件（全局或项目级）
    const scope = data?.scope || 'global';
    await agentRegistry.saveToFile(data?.config, scope);

    process.send?.({ requestId, data: { success: true } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentUpdate(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      process.send?.({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }

    // 更新 YAML 文件（自动检测 scope）
    const existingAgent = agentRegistry.get(data?.agentId);
    if (!existingAgent || !existingAgent.metadata) {
      process.send?.({ requestId, data: { success: false, error: `Agent 不存在: ${data?.agentId}` } });
      return;
    }

    const scope = existingAgent.metadata.source === 'project' ? 'project' : 'global';
    await agentRegistry.saveToFile(data?.config, scope);

    process.send?.({ requestId, data: { success: true } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentDelete(requestId: string, data: any) {
  if (!session) {
    process.send?.({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      process.send?.({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }

    // 删除 YAML 文件
    await agentRegistry.deleteFile(data?.agentId);

    process.send?.({ requestId, data: { success: true } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 权限交互 (双向 IPC)
// ============================================================

// 存储 pending 的权限请求 resolve 回调
const pendingPermissions = new Map<string, (result: any) => void>();
const pendingPlanReviews = new Map<string, (result: any) => void>();
const pendingAskUsers = new Map<string, (result: any) => void>();
let permissionIdCounter = 0;

/**
 * 在 handleInit 完成后注入三个 Handler
 */
function injectInteractionHandlers() {
  if (!session) return;

  // 1. 权限确认 Handler
  session.setConfirmationHandler(async (request: any, guardResult: any) => {
    const id = `perm-${++permissionIdCounter}`;
    process.send?.({
      type: 'permission:request',
      data: {
        id,
        toolName: request.toolName,
        input: request.input,
        riskLevel: guardResult?.riskLevel || 'warn',
        description: guardResult?.description || '',
        suggestion: guardResult?.suggestion || '',
      },
    });
    return new Promise((resolve) => {
      pendingPermissions.set(id, resolve);
    });
  });

  // 2. 计划审查 Handler
  session.setPlanReviewHandler(async (plan: any) => {
    const id = `plan-${++permissionIdCounter}`;
    process.send?.({
      type: 'plan-review:request',
      data: {
        id,
        content: typeof plan === 'string' ? plan : plan?.content || '',
        title: plan?.title || '执行计划',
      },
    });
    return new Promise((resolve) => {
      pendingPlanReviews.set(id, resolve);
    });
  });

  // 3. 用户提问 Handler
  session.setAskUserHandler(async (question: any) => {
    const id = `ask-${++permissionIdCounter}`;
    process.send?.({
      type: 'ask-user:request',
      data: {
        id,
        question: typeof question === 'string' ? question : question?.question || '',
        options: question?.options || [],
      },
    });
    return new Promise((resolve) => {
      pendingAskUsers.set(id, resolve);
    });
  });
}

function handlePermissionResponse(data: any) {
  const resolve = pendingPermissions.get(data.id);
  if (resolve) {
    pendingPermissions.delete(data.id);
    resolve(data.result);
  }
}

function handlePlanReviewResponse(data: any) {
  const resolve = pendingPlanReviews.get(data.id);
  if (resolve) {
    pendingPlanReviews.delete(data.id);
    resolve(data.result);
  }
}

function handleAskUserResponse(data: any) {
  const resolve = pendingAskUsers.get(data.id);
  if (resolve) {
    pendingAskUsers.delete(data.id);
    resolve(data.result);
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
