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
import { getTodoManager } from '../../src/core/tools/TodoStorageTool.js';

let session: ChatSession | null = null;
let agentLoop: any = null;

/**
 * 安全地发送消息到主进程
 */
function safeSend(message: any) {
  try {
    if (process.send && process.connected) {
      process.send(message);
    }
  } catch (err: any) {
    // 忽略 EPIPE 错误（管道已关闭，通常是主进程退出）
    if (err.code !== 'EPIPE') {
      console.error('[agent-bridge] 发送消息失败:', err);
    }
  }
}

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
    case 'memory-get-config':
      handleGetMemoryConfig(msg.requestId);
      break;
    case 'memory-save-config':
      handleSaveMemoryConfig(msg.requestId, msg.data);
      break;
    case 'memory-manual-flush':
      handleManualMemoryFlush(msg.requestId);
      break;
    case 'memory-extract-topics':
      handleExtractTopics(msg.requestId);
      break;
    case 'memory-get-list':
      handleGetMemoryList(msg.requestId, msg.data);
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

    // ============ Skills / Tools / MCP 查询 ============
    case 'skills-list':
      handleSkillsList(msg.requestId);
      break;
    case 'tools-list':
      handleToolsList(msg.requestId);
      break;
    case 'mcp-list':
      handleMcpList(msg.requestId);
      break;

    // ============ Prompt 配置管理 ============
    case 'prompt-get-config':
      handlePromptGetConfig(msg.requestId);
      break;
    case 'prompt-save-config':
      handlePromptSaveConfig(msg.requestId, msg.data);
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

    // ============ 权限规则管理 ============
    case 'permission-list':
      handlePermissionList(msg.requestId);
      break;
    case 'permission-delete':
      handlePermissionDelete(msg.requestId, msg.data);
      break;
    case 'permission-clear':
      handlePermissionClear(msg.requestId);
      break;
  }
});

/**
 * 初始化 ChatSession
 */
async function handleInit() {
  try {
    session = new ChatSession({
      callbacks: {
        // 启动引导：思考状态
        onBootThinking: () => {
          safeSend({
            type: 'session:boot-thinking',
            data: {},
          });
        },
        // 启动引导消息回调
        onBootGuide: (message: string) => {
          safeSend({
            type: 'session:boot-guide',
            data: { message },
          });
        },
        onArchiveNotification: (result) => {
          safeSend({
            type: 'session:archive-notification',
            data: result,
          });
        },
        // 恢复消息历史回调
        onMessagesRestored: (messages) => {
          safeSend({
            type: 'session:messages-restored',
            data: { messages },
          });
        },
      },
    });
    await session.init();
    agentLoop = session.getAgentLoop();

    // 注册流式事件回调，转发到主进程
    session.on({
      onText: (text: string) => {
        safeSend({ type: 'agent:text', data: text });
      },
      onThinking: (thinking: string) => {
        safeSend({ type: 'agent:thinking', data: thinking });
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        safeSend({ type: 'agent:tool-start', data: { id, name, input } });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        safeSend({ type: 'agent:tool-end', data: { id, name, result, isError } });
      },
      onUsage: (usage: any) => {
        safeSend({ type: 'agent:usage', data: usage });
      },
      onError: (err: Error) => {
        safeSend({ type: 'agent:error', data: err.message });
      },
      onEnd: (state: any) => {
        safeSend({
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

    safeSend({
      type: 'init-result',
      data: { success: true },
    });
  } catch (err) {
    safeSend({
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
    safeSend({
      type: 'send-result',
      data: { success: false, error: '会话未初始化' },
    });
    return;
  }

  try {
    // 清空旧任务（如果没有活跃任务）
    const todoManager = getTodoManager();
    if (!todoManager.hasActiveTodos()) {
      await todoManager.startTurn();
    }

    await agentLoop.run(message);
    safeSend({
      type: 'send-result',
      data: { success: true },
    });
  } catch (err) {
    safeSend({
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
    safeSend({
      type: 'interrupt-result',
      data: { success: true },
    });
  } else {
    safeSend({
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
    safeSend({
      type: 'reset-result',
      data: { success: true },
    });
  } else {
    safeSend({
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
    safeSend({
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
  safeSend({
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
    safeSend({
      type: 'config-result',
      requestId,
      data: null,
    });
    return;
  }

  const config = session.getConfig();
  safeSend({
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
    safeSend({ type: 'full-config-result', requestId, data: null });
    return;
  }

  const config = session.getConfig();
  safeSend({
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
    safeSend({
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
        safeSend({ type: 'agent:text', data: text });
      },
      onThinking: (thinking: string) => {
        safeSend({ type: 'agent:thinking', data: thinking });
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        safeSend({ type: 'agent:tool-start', data: { id, name, input } });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        safeSend({ type: 'agent:tool-end', data: { id, name, result, isError } });
      },
      onUsage: (usage: any) => {
        safeSend({ type: 'agent:usage', data: usage });
      },
      onError: (err: Error) => {
        safeSend({ type: 'agent:error', data: err.message });
      },
      onEnd: (state: any) => {
        safeSend({
          type: 'agent:end',
          data: {
            tokenUsage: state.tokenUsage,
            cost: state.cost,
            currentIteration: state.currentIteration,
          },
        });
      },
    });

    safeSend({
      type: 'update-config-result',
      requestId,
      data: { success: true },
    });
  } catch (err) {
    safeSend({
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
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const sessionId = await session.saveSession(data?.name, data?.options);
    safeSend({ requestId, data: { success: true, sessionId } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleSessionResume(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const ctx = await session.resumeSession(data?.sessionId);
    safeSend({
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
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleSessionList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, sessions: [] } });
    return;
  }
  try {
    const sessions = await session.listSessions();
    safeSend({ requestId, data: { success: true, sessions } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleSessionDelete(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    await session.deleteSession(data?.sessionId);
    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCheckpointCreate(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const checkpointId = await session.createCheckpoint(data?.label);
    safeSend({ requestId, data: { success: true, checkpointId } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCheckpointList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, checkpoints: [] } });
    return;
  }
  try {
    const checkpoints = await session.listCheckpoints();
    safeSend({ requestId, data: { success: true, checkpoints } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCheckpointRewind(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const messageCount = await session.rewindToCheckpoint(data?.checkpointId);
    safeSend({ requestId, data: { success: true, messageCount } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 记忆管理
// ============================================================

async function handleMemoryRetrieve(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: true, entries: [] } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: true, entries: [], stats: null } });
      return;
    }
    const entries = await memoryManager.retrieve(data?.query || '', data?.options);
    safeSend({
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
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleMemoryStats(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, stats: null } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: true, stats: null } });
      return;
    }
    const stats = await memoryManager.getStats();
    safeSend({ requestId, data: { success: true, stats } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// 获取记忆配置
async function handleGetMemoryConfig(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, config: null } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: true, config: null } });
      return;
    }
    const config = memoryManager.getConfig();
    safeSend({ requestId, data: { success: true, config } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// 保存记忆配置
async function handleSaveMemoryConfig(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: 'Session not initialized' } });
    return;
  }
  try {
    const memoryConfig = data.config;
    if (!memoryConfig) {
      safeSend({ requestId, data: { success: false, error: 'No config provided' } });
      return;
    }

    // 1. 读取当前全局配置
    const { GlobalConfig } = await import('../../src/core/config/GlobalConfig.js');
    const currentConfig = await GlobalConfig.readGlobalConfig();

    // 2. 合并 memory 配置
    const updatedConfig = {
      ...currentConfig,
      memory: {
        ...currentConfig.memory,
        ...memoryConfig,
      },
    };

    // 3. 保存到全局配置文件
    await GlobalConfig.writeGlobalConfig(updatedConfig);

    // 4. 热更新运行时 MemoryManager 配置（如果可能）
    const memoryManager = session.getMemoryManager();
    if (memoryManager) {
      // 注意：这里只是更新配置，不重新初始化组件
      // 完整的配置生效需要重新初始化会话
      (memoryManager as any).config = updatedConfig.memory;
    }

    safeSend({ requestId, data: { success: true, requiresRestart: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// 手动触发记忆刷新
async function handleManualMemoryFlush(requestId: string) {
  if (!session || !agentLoop) {
    safeSend({ requestId, data: { success: false, error: 'Session or AgentLoop not initialized' } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: false, error: 'MemoryManager not available' } });
      return;
    }
    const intelligentFlush = memoryManager.getIntelligentFlush();
    if (!intelligentFlush) {
      safeSend({ requestId, data: { success: false, error: 'IntelligentFlush not enabled' } });
      return;
    }

    // 获取当前消息历史
    const messageManager = agentLoop.getMessageManager();
    const messages = messageManager?.getMessages() || [];

    // 获取配置和会话ID
    const sessionManager = session.getSessionManager();
    const sessionId = sessionManager?.getActiveSessionId() || undefined;

    // 手动触发刷新（强制触发：timeSinceLastFlush 设为超大值）
    const context = {
      messages: messages as any[],
      currentTokens: 1000000, // 强制触发：设置一个超大值
      maxTokens: 100, // 强制触发：设置一个很小的 maxTokens
      timeSinceLastFlush: 999999999, // 强制触发：设置一个超大值
      sessionId,
    };

    const flushed = await intelligentFlush.checkAndFlush(context);
    safeSend({ requestId, data: { success: true, flushed } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// 手动提取主题
async function handleExtractTopics(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: 'Session not initialized' } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: false, error: 'MemoryManager not available' } });
      return;
    }

    // 调用 MemoryManager 的 extractTopics 方法
    const dayKey = new Date().toISOString().split('T')[0]; // 今天的日期
    await memoryManager.extractTopics(dayKey);
    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// 获取记忆列表
async function handleGetMemoryList(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: true, memories: [] } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: true, memories: [] } });
      return;
    }

    // 从 MemoryManager 获取缓存的记忆条目
    const allMemories = (memoryManager as any).cachedEntries || [];

    // 为没有 category 字段的记忆自动推断 category（兼容旧版本数据）
    const enrichedMemories = allMemories.map((m: any) => {
      if (m.category) return m; // 已有 category，保持不变

      // 根据 type 推断 category
      let category = 'fact'; // 默认类别

      // Timeline: 会话摘要
      if (m.type === 'session_summary') {
        category = 'timeline';
      }
      // Topic: 用户偏好、重要日期、关系
      else if (m.type === 'user_preference' || m.type === 'important_date' || m.type === 'relationship') {
        category = 'topic';
      }
      // Fact: 其他所有类型（决策、错误解决、工具模式、项目事实、用户事实）
      else {
        category = 'fact';
      }

      return { ...m, category };
    });

    // 应用过滤条件
    let filteredMemories = enrichedMemories;

    // 按 category 过滤
    if (data.category && data.category !== 'all') {
      filteredMemories = filteredMemories.filter((m: any) => m.category === data.category);
    }

    // 按 type 过滤
    if (data.type && data.type !== 'all') {
      filteredMemories = filteredMemories.filter((m: any) => m.type === data.type);
    }

    // 按查询词过滤（搜索 content 和 keywords）
    if (data.query && data.query.trim()) {
      const query = data.query.toLowerCase();
      filteredMemories = filteredMemories.filter((m: any) => {
        const content = (m.content || '').toLowerCase();
        const keywords = (m.keywords || []).join(' ').toLowerCase();
        return content.includes(query) || keywords.includes(query);
      });
    }

    // 按时间排序（最新在前）
    filteredMemories.sort((a: any, b: any) => {
      const aTime = new Date(a.lastAccessedAt || a.createdAt).getTime();
      const bTime = new Date(b.lastAccessedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    // 限制数量
    const limit = data.limit || 100;
    const memories = filteredMemories.slice(0, limit);

    safeSend({ requestId, data: { success: true, memories } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 工具统计
// ============================================================

async function handleGetUsageStats(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, stats: null } });
    return;
  }
  try {
    const state = session.getState();
    safeSend({
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
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// 高级功能
// ============================================================

async function handleCompact(requestId: string, data: any) {
  if (!agentLoop) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const result = await agentLoop.compact(data?.instruction);
    safeSend({
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
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleGetDiagnostics(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const report = await session.getDiagnostics();
    safeSend({ requestId, data: { success: true, report } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// Agent 管理
// ============================================================

async function handleAgentList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, agents: [] } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      safeSend({ requestId, data: { success: true, agents: [] } });
      return;
    }
    // 获取所有启用的 Agent（包括内部系统 Agent）
    const agents = agentRegistry.getEnabled();
    safeSend({ requestId, data: { success: true, agents } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentGet(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      safeSend({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }
    const agent = agentRegistry.get(data?.agentId);
    if (!agent) {
      safeSend({ requestId, data: { success: false, error: `Agent 不存在: ${data?.agentId}` } });
      return;
    }
    safeSend({ requestId, data: { success: true, agent } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentCreate(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      safeSend({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }

    // 保存到 YAML 文件（全局或项目级）
    const scope = data?.scope || 'global';
    await agentRegistry.saveToFile(data?.config, scope);

    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentUpdate(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      safeSend({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }

    // 更新 YAML 文件（自动检测 scope）
    const existingAgent = agentRegistry.get(data?.agentId);
    if (!existingAgent || !existingAgent.metadata) {
      safeSend({ requestId, data: { success: false, error: `Agent 不存在: ${data?.agentId}` } });
      return;
    }

    const scope = existingAgent.metadata.source === 'project' ? 'project' : 'global';
    await agentRegistry.saveToFile(data?.config, scope);

    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleAgentDelete(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      safeSend({ requestId, data: { success: false, error: 'Agent Registry 未初始化' } });
      return;
    }

    // 删除 YAML 文件
    await agentRegistry.deleteFile(data?.agentId);

    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// Skills / Tools / MCP 查询
// ============================================================

async function handleSkillsList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, skills: [] } });
    return;
  }
  try {
    const skillRegistry = session.getSkillRegistry();
    const skills = skillRegistry.list().map((skill: any) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description || '',
      type: skill.category || 'prompt',
      category: skill.sceneCategory || undefined,
      enabled: skill.enabled ?? true,
      requiredTools: skill.requiredTools || [],
      triggers: skill.triggers || [],
      tags: skill.tags || [],
    }));
    safeSend({ requestId, data: { success: true, skills } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleToolsList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, tools: [] } });
    return;
  }
  try {
    const baseRegistry = session.getBaseRegistry();
    if (!baseRegistry) {
      safeSend({ requestId, data: { success: true, tools: [] } });
      return;
    }

    // 使用 TOOL_CATEGORIES 做分类映射
    const { TOOL_CATEGORIES } = await import('../../src/core/tools/ToolCategories.js');
    const coreSet = new Set<string>(TOOL_CATEGORIES.CORE);
    const metaSet = new Set<string>(TOOL_CATEGORIES.META);
    const sceneMap = new Map<string, string>();
    for (const [sceneName, sceneTools] of Object.entries(TOOL_CATEGORIES.SCENE)) {
      for (const t of sceneTools as readonly string[]) {
        sceneMap.set(t, sceneName);
      }
    }

    const categorize = (name: string): string => {
      if (coreSet.has(name)) return 'core';
      if (metaSet.has(name)) return 'meta';
      if (sceneMap.has(name)) return sceneMap.get(name)!;
      return 'other';
    };

    const allTools = baseRegistry.getAll();
    const tools = allTools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      category: categorize(tool.name),
      required: tool.required ?? false,
      readonly: tool.readonly ?? true,
    }));
    safeSend({ requestId, data: { success: true, tools } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleMcpList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, servers: [] } });
    return;
  }
  try {
    const mcpManager = session.getMCPManager();
    if (!mcpManager) {
      safeSend({ requestId, data: { success: true, servers: [] } });
      return;
    }

    // 使用 getServerRuntimes() 获取服务器信息
    const runtimes = mcpManager.getServerRuntimes();

    // 获取所有工具和 prompts 用于统计
    let allTools: Array<{ serverName: string; tool: any }> = [];
    let allPrompts: Array<{ serverName: string; prompt: any }> = [];
    try { allTools = await mcpManager.getAllTools(); } catch { /* ignore */ }
    try { allPrompts = await mcpManager.getAllPrompts(); } catch { /* ignore */ }

    const servers = runtimes.map((runtime: any) => {
      const toolCount = allTools.filter(t => t.serverName === runtime.name).length;
      const promptCount = allPrompts.filter(p => p.serverName === runtime.name).length;
      return {
        name: runtime.name,
        command: runtime.config?.command || '',
        args: runtime.config?.args || [],
        env: runtime.config?.env || {},
        enabled: !runtime.config?.disabled,
        toolCount,
        promptCount,
      };
    });

    safeSend({ requestId, data: { success: true, servers } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// ============================================================
// Prompt 配置管理
// ============================================================

/** 默认 prompt 组件内容（与 src/core/prompt/components/ 保持一致） */
const DEFAULT_PROMPT_COMPONENTS: Record<string, { content: string; requiredTools?: string[] }> = {
  'l0-identity': {
    content: `You are Xuanji (璇玑), an AI butler who truly knows the user. You have access to the user's memories and can proactively assist with both work and life tasks.

# Core Principles

- **Tools First**: Invoke tools immediately rather than asking the user for retrievable information.
- **Autonomous Action**: Proactively use tools to complete tasks. Don't wait for permission unless destructive.
- **Error Recovery**: If a tool fails, analyze and try an alternative. Don't retry the same failing call.
- **Plan Before Execute**: For multi-step tasks (3+ steps), create a todo checklist first, then execute step by step.
- **Follow-up Refinement**: When user provides follow-up input shortly after your response, treat it as a refinement of the PREVIOUS task and re-execute with the new requirement.

# Response Style

- **Language Matching**: Mirror the user's language (Chinese → Chinese, English → English).
- **Conciseness**: Present results directly. Minimize process narration.
- **Clarity**: Explain what was done and why it matters.

# Memory & Reminder Principles

- **Memory-Driven**: Before recommendations, search user memories with \`memory_search\`.
- **Proactive Storage**: When user shares personal info, call \`memory_store\` to remember.
- **Smart Reminders**: For important dates, set reminders with \`reminder_set\` (birthdays: 2 days before, deadlines: 1 day before).
- **Natural Presentation**: Present reminders conversationally with actionable suggestions.

# Skill Composition

Your capabilities are extended by domain-specific skills loaded dynamically based on user needs.`,
  },
  'l0-safety': {
    content: `# Security Baseline

## BLOCKED — Never execute, no exceptions
- \`sudo rm -rf /\` or system-wide deletion
- Modifying \`.git/\` internal files
- \`git push --force\` to main/master
- \`DROP DATABASE\`, \`DROP TABLE\` without WHERE
- Writing secrets/credentials to stdout or logs

## Sensitive File Patterns

Never include in tool output or logs:
\`\`\`
.env, .env.*, .env.local
**/secrets/*, **/credentials/*
**/*.pem, **/*.key, **/*.p12
config.json with "password" or "secret" keys
\`\`\``,
  },
  'l1-coding': {
    content: `# Code Assistant — Programming Domain Expert

## Tool Decision Tree

\`\`\`
View file content?       → read_file (NOT bash cat)
Modify part of a file?   → edit_file (NOT write_file, NOT bash sed)
Create new file (< 5KB)? → write_file
Create large file?       → bash heredoc
Find files by name?      → glob (NOT bash find)
Search code content?     → grep (NOT bash grep/rg)
Run commands?            → bash (with description)
\`\`\`

## Pre/Post Execution Checklist

**Before**: Read file → Verify path → Check context → Preserve formatting
**After**: Confirm success → Validate result → Run tests if possible

## Error Recovery

\`\`\`
Permission denied → Report to user, suggest fix
File not found    → Use glob to find correct path
Content too large → Switch to bash heredoc
Edit conflict     → Read file again, use longer match string
Unknown error     → Analyze, try alternative approach
\`\`\`

## Large File Strategy

For files > 5KB or > 200 lines, use bash heredoc.

## Multi-Agent Collaboration

**SubAgent** (task tool): Single focused tasks — exploration, planning, coding
**Agent Team** (quick_team/agent_team): 3+ expert roles, multi-stage pipeline, debate needed

## Web Search for Coding

Use \`web_search\` for: latest docs, recent bug fixes, library updates
Don't search for: general concepts, code in current project, stable pre-2025 APIs`,
    requiredTools: ['read_file', 'write_file', 'edit_file', 'bash', 'grep', 'glob'],
  },
  'l1-life': {
    content: `# Life Secretary — Memory-Driven Personal Assistant

## Capabilities

- **Date Planning**: Arrange dates/activities based on the other person's preferences
- **Restaurant Recommendations**: Consider taste, allergies, budget, location
- **Schedule Management**: Remind about important dates, suggest relationship maintenance
- **Gift Ideas**: Recommend based on recipient's interests and relationship context

## Memory-Driven Workflow

1. **Search memories first**: \`memory_search({query: "Alice", type: "relationship"})\`
2. **Fill information gaps**: Use \`ask_user\` for budget, location, time constraints
3. **Web search for up-to-date info**: Restaurants, events, products
4. **Learn and remember**: Store new preferences, relationships, important dates
5. **Set smart reminders**: Birthdays 2 days before, deadlines 1 day before

## Tips

- Always explain **why** you're recommending (based on memory/preferences)
- Be conversational and warm, offer follow-up actions`,
    requiredTools: ['ask_user', 'memory_store', 'memory_search', 'reminder_set', 'web_search'],
  },
  'l2-planning': {
    content: `# Planning & Confirmation

## When to Plan

\`\`\`
Simple (1-2 tool calls)?     → Execute directly
Medium (3-8 steps)?          → Create todo checklist, then execute
Complex/risky (many files)?  → Create todos + plan_review for approval
\`\`\`

## Planning Workflow

1. **Analyze**: Understand scope, break into actionable steps
2. **Create todos**: \`todo_create\` for each step
3. **Review** (if complex): \`plan_review\` for approval
4. **Execute**: Mark in_progress → do work → mark completed
5. **Report**: Summarize accomplishments

## Execute Directly (No Confirmation)

- Read-only operations (file reading, analysis, search)
- Minor fixes (typos, formatting, < 20 lines in one file)
- Explicitly requested or clearly defined tasks`,
  },
  'l2-agent-rules': {
    content: `# Agent Behavior Rules

## Loop Control

**Iteration Budget**: Target 5-10 tool calls for simple tasks, max 50 iterations
**Stuck Detection**:
\`\`\`
Same tool failed 2+ times?       → STOP retrying, try alternative
Reading same files repeatedly?   → STOP, summarize and ask user
Approaching limit (40+)?         → Report progress and blockers
\`\`\`

## Decision Making

- DO: Use tools to gather facts before decisions
- DO: Read relevant code/config before suggesting changes
- DON'T: Assume file contents, directory structure, or configuration

## Efficiency Rules

1. **Minimize round-trips**: Batch independent tool calls
2. **Cache knowledge**: Don't re-read files seen in this conversation
3. **Use specific tools**: grep > bash grep, read_file > bash cat
4. **Progressive approach**: Start simple, add complexity only if needed`,
  },
  'l2-safety': {
    content: `# Extended Security Rules

## CONFIRM — Ask user before executing
- Deleting files or directories
- Force operations (git reset --hard, --force flags)
- Modifying sensitive files (.env, config.json, secrets.*)
- Installing global packages
- Accessing network resources outside the project

## SAFE — Execute without confirmation
- Reading any file
- Searching (grep, glob, find)
- Git read operations (log, status, diff, branch)
- Running tests and linters
- Building projects, local package installs

## Data Protection

1. Before destructive operations: suggest git stash or backup
2. Before bulk changes: show what will be affected
3. After modifications: verify no data was lost
4. When uncertain: ask the user, don't guess`,
  },
};

async function handlePromptGetConfig(requestId: string) {
  try {
    // 从配置文件读取 prompt 配置
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const fs = await import('node:fs/promises');

    const configPath = join(homedir(), '.xuanji', 'prompt-config.json');

    let config: any = null;
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // 文件不存在，返回默认配置
      config = {
        sceneRules: [
          {
            scene: 'coding',
            keywords: '代码|编程|函数|类|接口|模块|组件|重构|bug|修复|测试|部署|构建|编译|调试|code|program|function|class|interface|module|component|refactor|fix|test|deploy|build|compile|debug|npm|git|api|typescript|python|java',
            description: '编程领域专家 — 文件操作、代码搜索、大文件处理、多代理协作',
          },
          {
            scene: 'life',
            keywords: '约会|餐厅|推荐|生日|礼物|提醒|日程|天气|旅行|电影|音乐|购物|健康|运动|食谱|date|restaurant|birthday|gift|remind|schedule|weather|travel|movie|music|shopping|health|recipe',
            description: '生活秘书 — 记忆驱动的约会规划、餐厅推荐、日程管理、礼物建议',
          },
        ],
        loadMatrix: {
          simple: ['L0'],
          standard: ['L0', 'L1'],
          complex: ['L0', 'L1', 'L2'],
        },
        l3Config: {
          enabled: true,
          maxFiles: 100,
          maxSymbols: 20,
          directories: ['src'],
        },
      };
    }

    // 确保 components 字段存在（合并默认值）
    if (!config.components) {
      config.components = {};
    }
    for (const [id, defaults] of Object.entries(DEFAULT_PROMPT_COMPONENTS)) {
      if (!config.components[id]) {
        config.components[id] = defaults;
      }
    }

    safeSend({ requestId, data: { success: true, config } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handlePromptSaveConfig(requestId: string, data: any) {
  try {
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const fs = await import('node:fs/promises');

    const configDir = join(homedir(), '.xuanji');
    const configPath = join(configDir, 'prompt-config.json');

    // 确保目录存在
    await fs.mkdir(configDir, { recursive: true });

    // 写入配置
    await fs.writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');

    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
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
    safeSend({
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
    safeSend({
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
    safeSend({
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

  // 4. Plan Mode Enter Handler（LLM 自主进入 Plan Mode）
  session.setPlanModeEnterHandler(async () => {
    safeSend({
      type: 'plan-mode:enter',
      data: {},
    });
    return true;
  });

  // 5. Plan Mode Exit Handler（LLM 退出 Plan Mode）
  session.setPlanModeExitHandler(async () => {
    safeSend({
      type: 'plan-mode:exit',
      data: {},
    });
    return true;
  });
}

function handlePermissionResponse(data: any) {
  const resolve = pendingPermissions.get(data.id);
  if (resolve) {
    pendingPermissions.delete(data.id);
    // 前端发送 { action: 'allow'|'deny'|'always'|'never' }
    // 后端 PermissionController 期望 { allowed: boolean, remember: boolean }
    const action = data.result?.action as string | undefined;
    resolve({
      allowed: action === 'allow' || action === 'always',
      remember: action === 'always' || action === 'never',
    });
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

// ============================================================
// 权限规则管理
// ============================================================

function handlePermissionList(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, rules: [] } });
    return;
  }
  try {
    const pc = session.getPermissionController();
    const rules = pc ? pc.listDecisions() : [];
    safeSend({ requestId, data: { success: true, rules } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handlePermissionDelete(requestId: string, data: any) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const pc = session.getPermissionController();
    if (pc) {
      await pc.deleteDecision(data?.cacheKey);
    }
    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handlePermissionClear(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const pc = session.getPermissionController();
    if (pc) {
      await pc.clearDecisions();
    }
    safeSend({ requestId, data: { success: true } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
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
