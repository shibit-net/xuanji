// ============================================================
// agent-bridge.ts — ChatSession 子进程桥接
// ============================================================
//
// 在独立 Node.js 进程中运行 ChatSession，
// 通过 process.send/process.on 与 Electron 主进程通信。
// 这样 better-sqlite3 等 native 模块使用系统 Node.js 加载，
// 不受 Electron ABI 限制。
//

import { SessionFactory } from '../../src/core/chat/SessionFactory.js';
import type { ChatSession } from '../../src/core/chat/ChatSession.js';
import { getTodoManager } from '../../src/core/tools/TodoManager.js';

let session: ChatSession | null = null;

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
    case 'trigger-startup':
      await handleTriggerStartup();
      break;
    case 'send-message':
      await handleSendMessage(msg.data);
      break;
    case 'interrupt':
      handleInterrupt(msg.data?.message || '');
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

    // ============ 核心规则管理 ============
    case 'core-rules-get-all':
      handleCoreRulesGetAll(msg.requestId);
      break;
    case 'core-rules-update':
      handleCoreRulesUpdate(msg.requestId, msg.data);
      break;
    case 'core-rules-delete':
      handleCoreRulesDelete(msg.requestId, msg.data);
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

    // ============ Todo 管理 ============
    case 'todo-archive-completed':
      handleTodoArchiveCompleted(msg.requestId);
      break;
    case 'todo-get-archived-count':
      handleTodoGetArchivedCount(msg.requestId);
      break;
  }
});

/**
 * 注册 Hook 事件监听器
 */
function registerHookListeners(hookRegistry: any) {
  hookRegistry.addListener('TeamStart', async (ctx: any) => {
    safeSend({
      type: 'agent:team-start',
      data: {
        teamId: ctx.teamId,
        name: ctx.data?.name,
        strategy: ctx.data?.strategy,
        memberCount: ctx.data?.memberCount,
        members: ctx.data?.members,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('TeamMemberStart', async (ctx: any) => {
    safeSend({
      type: 'agent:team-member-start',
      data: {
        teamId: ctx.teamId,
        memberId: ctx.data?.memberId,
        name: ctx.data?.name,
        role: ctx.data?.role,
        task: ctx.data?.task,
        builtin: ctx.data?.builtin,
        agentType: ctx.data?.agentType, // 🔧 新增：传递 agentType 字段
        strategy: ctx.data?.strategy,
        teamName: ctx.data?.teamName,
        stepIndex: ctx.data?.stepIndex,
        totalSteps: ctx.data?.totalSteps,
        currentRound: ctx.data?.currentRound,
        maxRounds: ctx.data?.maxRounds,
        systemPromptHint: ctx.data?.systemPromptHint,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('TeamMemberEnd', async (ctx: any) => {
    safeSend({
      type: 'agent:team-member-end',
      data: {
        teamId: ctx.teamId,
        memberId: ctx.data?.memberId,
        success: ctx.data?.success,
        duration: ctx.data?.duration,
        resultSummary: ctx.data?.resultSummary,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('TeamEnd', async (ctx: any) => {
    safeSend({
      type: 'agent:team-end',
      data: {
        teamId: ctx.teamId,
        name: ctx.data?.name,
        success: ctx.data?.success,
        duration: ctx.data?.duration,
        error: ctx.data?.error,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('SubAgentStart', async (ctx: any) => {
    const role = ctx.data?.role || 'unknown';
    const isBuiltin = ctx.data?.builtin === true;
    const parentAgentId = ctx.data?.parentAgentId || 'main';

    safeSend({
      type: 'agent:subagent-start',
      data: {
        subAgentId: ctx.subAgentId,
        name: ctx.data?.name || role,
        role: role,
        task: ctx.data?.task,
        builtin: isBuiltin,
        agentType: ctx.data?.agentType, // 🔧 新增：传递 agentType 字段
        parentId: parentAgentId,
      },
    });

    return { success: true };
  });

  hookRegistry.addListener('SubAgentEnd', async (ctx: any) => {
    safeSend({
      type: 'agent:subagent-end',
      data: {
        subAgentId: ctx.subAgentId,
        success: !ctx.data?.timedOut,
        duration: ctx.data?.duration,
      },
    });

    return { success: true };
  });

  hookRegistry.addListener('AgentThinking', async (ctx: any) => {
    safeSend({
      type: 'agent:thinking-start',
      data: {
        agentId: ctx.subAgentId || 'main',
        content: ctx.thinkingContent || '',
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('SkillStart', async (ctx: any) => {
    safeSend({
      type: 'agent:skill-start',
      data: {
        agentId: ctx.subAgentId || 'main',
        skillName: ctx.skillName,
        input: ctx.skillInput,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('SkillEnd', async (ctx: any) => {
    safeSend({
      type: 'agent:skill-end',
      data: {
        agentId: ctx.subAgentId || 'main',
        skillName: ctx.skillName,
        duration: ctx.skillDuration,
        success: ctx.skillSuccess,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('McpToolStart', async (ctx: any) => {
    safeSend({
      type: 'agent:mcp-start',
      data: {
        agentId: ctx.subAgentId || 'main',
        serverName: ctx.mcpServerName,
        toolName: ctx.mcpToolName,
        input: ctx.mcpInput,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('McpToolEnd', async (ctx: any) => {
    safeSend({
      type: 'agent:mcp-end',
      data: {
        agentId: ctx.subAgentId || 'main',
        serverName: ctx.mcpServerName,
        toolName: ctx.mcpToolName,
        duration: ctx.mcpDuration,
        isError: ctx.mcpIsError,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('ToolStart', async (ctx: any) => {
    safeSend({
      type: 'agent:tool-start',
      data: {
        id: ctx.toolId,
        name: ctx.toolName,
        input: ctx.toolInput,
        agentId: ctx.subAgentId || 'main',
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('ToolEnd', async (ctx: any) => {
    safeSend({
      type: 'agent:tool-end',
      data: {
        id: ctx.toolId,
        name: ctx.toolName,
        result: ctx.toolResult,
        isError: ctx.toolIsError,
        agentId: ctx.subAgentId || 'main',
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('MemoryRead', async (ctx: any) => {
    safeSend({
      type: 'agent:memory-read',
      data: {
        agentId: ctx.subAgentId || 'main',
        hitCount: ctx.memoryHitCount,
        layersSearched: ctx.memoryLayersSearched,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('MemoryWrite', async (ctx: any) => {
    safeSend({
      type: 'agent:memory-write',
      data: {
        agentId: ctx.subAgentId || 'main',
        scope: ctx.memoryScope,
        summary: ctx.memorySummary,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('PreCompact', async (ctx: any) => {
    safeSend({
      type: 'agent:compress-start',
      data: {
        agentId: ctx.subAgentId || 'main',
        originalTokens: ctx.originalTokens,
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('PostCompact', async (ctx: any) => {
    safeSend({
      type: 'agent:compress-end',
      data: {
        agentId: ctx.subAgentId || 'main',
        originalTokens: ctx.originalTokens,
        compressedTokens: ctx.compressedTokens,
        compressionRatio: ctx.compressionRatio,
        duration: ctx.duration,
      },
    });
    return { success: true };
  });
}

/**
 * 初始化 ChatSession
 */
async function handleInit() {
  try {
    // 获取当前用户 ID（从认证系统或使用默认值）
    let userId = 'default';
    try {
      const { AuthManager } = await import('./services/auth.js');
      const authManager = AuthManager.getInstance();
      const currentUser = authManager.getCurrentUser();
      if (currentUser?.userId) {
        userId = currentUser.userId;
      }
    } catch (err) {
      console.warn('[agent-bridge] 无法获取当前用户，使用默认用户:', err);
    }

    console.log(`[agent-bridge] 初始化会话，用户: ${userId}`);

    const factory = new SessionFactory(userId);
    session = await factory.create({
      userId,
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

    // 注册流式事件回调，转发到主进程
    registerSessionCallbacks(session);

    // 注入权限交互 Handler
    injectInteractionHandlers();

    // 注册 SubAgent/Team Hook 事件监听，将成员状态变更转发到 renderer
    // 通过 DependencyContainer 获取 HookRegistry
    const container = session.getContainer();
    const hookRegistry = container.resolveSync('hookRegistry');
    registerHookListeners(hookRegistry);

    safeSend({
      type: 'init-complete',
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
 * 注册流式事件回调，转发到主进程
 */
function registerSessionCallbacks(s: ChatSession) {
  const agentLoop = s.getAgentLoop();
  agentLoop.on({
    onText: (text: string) => {
      safeSend({ type: 'agent:text', data: text });
    },
    onThinking: (thinking: string) => {
      console.log('[agent-bridge] onThinking 触发，内容长度:', thinking.length, '前50字符:', thinking.slice(0, 50));
      safeSend({ type: 'agent:thinking', data: thinking });
    },
    onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
      console.log('[agent-bridge] onToolStart 触发:', { id, name, input });
      safeSend({ type: 'agent:tool-start', data: { id, name, input } });
    },
    onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
      safeSend({ type: 'agent:tool-end', data: { id, name, result, isError } });
    },
    onFileChanges: (changes: any[]) => {
      console.log('[agent-bridge] onFileChanges 触发，变更数量:', changes.length);
      safeSend({ type: 'agent:file-changes', data: { changes } });
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
}

/**
 * 触发启动消息（用户登录后调用）
 */
async function handleTriggerStartup() {
  try {
    const { GlobalConfig } = await import('../../src/core/config/GlobalConfig.js');
    const globalConfig = await GlobalConfig.readGlobalConfig();
    const isNewUser = !globalConfig.onboardingDone;

    let hasMemories = false;
    if (!isNewUser && session) {
      const container = session.getContainer();
      const memoryManager = container.resolveSync('memoryManager');
      if (memoryManager) {
        const stats = await (memoryManager as any).getStats?.();
        hasMemories = stats ? stats.total > 0 : false;
      }
    }

    if (isNewUser || hasMemories) {
      await handleSendMessage('__startup__');
    }
  } catch (err) {
    console.warn('[agent-bridge] Failed to trigger startup message:', err);
  }
}

/**
 * 发送消息
 */
async function handleSendMessage(message: string) {
  if (!session) {
    safeSend({
      type: 'send-result',
      data: { success: false, error: '会话未初始化' },
    });
    return;
  }

  try {
    // 🆕 不再自动清空任务，让 LLM 或用户显式管理任务生命周期
    // 如果需要清空任务，LLM 可以调用 todo_clear 工具（需要添加）
    // 或者在创建新任务前检查是否有旧任务需要清理

    await session.run(message);
    safeSend({
      type: 'send-result',
      data: { success: true },
    });
  } catch (err) {
    // 错误已经通过 onError 回调发送到前端，这里只返回结果状态
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
 * - message 为空：停止按钮，调用 stop() 终止 Agent 循环
 * - message 非空：补充输入，调用 interrupt(message) 中断并注入新消息
 */
function handleInterrupt(message: string) {
  if (session) {
    const agentLoop = session.getAgentLoop();
    if (message) {
      agentLoop.interrupt(message);
    } else {
      agentLoop.stop();
    }
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
async function handleGetFullConfig(requestId: string) {
  if (!session) {
    safeSend({ type: 'full-config-result', requestId, data: null });
    return;
  }

  const config = session.getConfig();

  // onboardingDone 和 persona 直接从全局配置文件读取，确保最新值
  const { GlobalConfig } = await import('../../src/core/config/GlobalConfig.js');
  const globalConfig = await GlobalConfig.readGlobalConfig();

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
      persona: globalConfig.persona ?? {},
      onboardingDone: globalConfig.onboardingDone,
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
    if (data.persona !== undefined) {
      globalConfig.persona = data.persona;
      needPersist = true;
    }
    if (data.onboardingDone !== undefined) {
      globalConfig.onboardingDone = data.onboardingDone;
      needPersist = true;
    }

    // 4. 持久化到全局配置文件
    if (needPersist) {
      await GlobalConfig.writeGlobalConfig(globalConfig);
      console.log('[agent-bridge] 配置已保存到文件，apiKey:', globalConfig.provider.apiKey ? `***${globalConfig.provider.apiKey.slice(-4)}` : '(空)');
    }

    // 5. 重新加载完整配置（包含环境变量）并重新创建 session
    const configLoader = new ConfigLoader();
    const fullConfig = await configLoader.load();
    console.log('[agent-bridge] 重新加载配置完成，apiKey:', fullConfig.provider.apiKey ? `***${fullConfig.provider.apiKey.slice(-4)}` : '(空)');
    console.log('[agent-bridge] 环境变量 XUANJI_API_KEY:', process.env.XUANJI_API_KEY ? `***${process.env.XUANJI_API_KEY.slice(-4)}` : '(未设置)');

    // 重新创建 session
    const factory = new SessionFactory();
    session = await factory.create({
      config: fullConfig,
      callbacks: {
        onBootThinking: () => {
          safeSend({ type: 'session:boot-thinking', data: {} });
        },
        onBootGuide: (message: string) => {
          safeSend({ type: 'session:boot-guide', data: { message } });
        },
        onArchiveNotification: (result) => {
          safeSend({ type: 'session:archive-notification', data: result });
        },
        onMessagesRestored: (messages) => {
          safeSend({ type: 'session:messages-restored', data: { messages } });
        },
      },
    });

    // 重新注册事件回调
    registerSessionCallbacks(session);

    // 重新注入权限交互 Handler
    injectInteractionHandlers();

    // 重新注册 Hook 事件监听
    const container = session.getContainer();
    const hookRegistry = container.resolveSync('hookRegistry');
    registerHookListeners(hookRegistry);

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
    const intelligentFlush = memoryManager.getIntelligentFlush();
    if (!intelligentFlush) {
      safeSend({ requestId, data: { success: false, error: 'IntelligentFlush not enabled' } });
      return;
    }

    // 获取当前消息历史
    const messageManager = session.getAgentLoop().getMessageManager();
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

    // 从 MemoryManager 获取所有记忆条目
    const allMemories = memoryManager.getAllEntries ? memoryManager.getAllEntries(2000) : [];

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
// 核心规则管理
// ============================================================

async function handleCoreRulesGetAll(requestId: string) {
  if (!session) {
    safeSend({ requestId, data: { success: true, rules: [] } });
    return;
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      safeSend({ requestId, data: { success: true, rules: [] } });
      return;
    }

    const coreRuleStore = memoryManager.getCoreRuleStore();
    if (!coreRuleStore) {
      safeSend({ requestId, data: { success: true, rules: [] } });
      return;
    }

    const rules = coreRuleStore.getAllRules();
    safeSend({ requestId, data: { success: true, rules } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCoreRulesUpdate(requestId: string, data: { id: string; active?: boolean }) {
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

    const coreRuleStore = memoryManager.getCoreRuleStore();
    if (!coreRuleStore) {
      safeSend({ requestId, data: { success: false, error: 'CoreRuleStore not available' } });
      return;
    }

    const success = coreRuleStore.setActive(data.id, data.active ?? true);
    if (success) {
      safeSend({ requestId, data: { success: true } });
    } else {
      safeSend({ requestId, data: { success: false, error: 'Rule not found' } });
    }
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleCoreRulesDelete(requestId: string, data: { id: string }) {
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

    const coreRuleStore = memoryManager.getCoreRuleStore();
    if (!coreRuleStore) {
      safeSend({ requestId, data: { success: false, error: 'CoreRuleStore not available' } });
      return;
    }

    const success = coreRuleStore.delete(data.id);
    if (success) {
      safeSend({ requestId, data: { success: true } });
    } else {
      safeSend({ requestId, data: { success: false, error: 'Rule not found' } });
    }
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
  if (!session) {
    safeSend({ requestId, data: { success: false, error: '会话未初始化' } });
    return;
  }
  try {
    const result = await session.getAgentLoop().compact(data?.instruction);
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
        multiSelect: question?.multiSelect || false,
        default: question?.default,
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
    // AskUserDialog 发送 { answer: string } 对象，需提取字符串
    // 兼容直接返回字符串的情况（非 GUI 环境）
    const result = data.result;
    const answer: string = typeof result === 'string'
      ? result
      : (result?.answer ?? '');
    resolve(answer);
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

// ============ Todo 管理 ============

async function handleTodoArchiveCompleted(requestId: string) {
  try {
    const todoManager = getTodoManager();
    const count = await todoManager.archiveCompleted();
    safeSend({ requestId, data: { success: true, count } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleTodoGetArchivedCount(requestId: string) {
  try {
    const todoManager = getTodoManager();
    const count = await todoManager.getArchivedCount();
    safeSend({ requestId, data: { success: true, count } });
  } catch (err) {
    safeSend({ requestId, data: { success: false, error: err instanceof Error ? err.message : String(err) } });
  }
}

// 优雅退出
process.on('SIGTERM', async () => {
  console.log('[agent-bridge] SIGTERM received, starting cleanup...');
  if (session) {
    await session.cleanup().catch((err) => {
      console.warn('[agent-bridge] Cleanup error:', err instanceof Error ? err.message : String(err));
    });
  }
  console.log('[agent-bridge] Cleanup completed, exiting');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[agent-bridge] SIGINT received, starting cleanup...');
  if (session) {
    await session.cleanup().catch((err) => {
      console.warn('[agent-bridge] Cleanup error:', err instanceof Error ? err.message : String(err));
    });
  }
  console.log('[agent-bridge] Cleanup completed, exiting');
  process.exit(0);
});

// ============================================================
// 全局错误处理 - 防止子进程静默崩溃
// ============================================================

/**
 * 捕获未处理的异常
 * 当代码中有未捕获的同步错误时触发
 */
process.on('uncaughtException', (err: Error) => {
  console.error('[agent-bridge] ❌ Uncaught Exception:', err);

  // 通知主进程发生了致命错误（格式与 onError 回调一致）
  safeSend({
    type: 'agent:error',
    data: `致命错误: ${err.message}`,
  });

  // 通知 agent:end，让 GUI 恢复到 idle 状态
  safeSend({
    type: 'agent:end',
    data: {
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cost: 0,
      currentIteration: 0,
    },
  });

  // 如果会话正在运行，尝试停止
  if (session) {
    try {
      session.stop();
    } catch (stopErr) {
      console.error('[agent-bridge] Failed to stop session:', stopErr);
    }
  }

  // 延迟退出，确保消息发送成功
  setTimeout(() => {
    console.error('[agent-bridge] Exiting due to uncaught exception');
    process.exit(1);
  }, 100);
});

/**
 * 捕获未处理的 Promise rejection
 * 当 async 函数中有未捕获的错误时触发
 */
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('[agent-bridge] ❌ Unhandled Rejection at:', promise);
  console.error('[agent-bridge] Reason:', reason);

  const errorMessage = reason instanceof Error
    ? reason.message
    : String(reason);

  // 通知主进程发生了未处理的 Promise rejection（格式与 onError 回调一致）
  safeSend({
    type: 'agent:error',
    data: `未处理的异步错误: ${errorMessage}`,
  });

  // 通知 agent:end，让 GUI 恢复到 idle 状态
  safeSend({
    type: 'agent:end',
    data: {
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cost: 0,
      currentIteration: 0,
    },
  });

  // 如果会话正在运行，尝试停止
  if (session) {
    try {
      session.stop();
    } catch (stopErr) {
      console.error('[agent-bridge] Failed to stop session:', stopErr);
    }
  }

  // 延迟退出，确保消息发送成功
  setTimeout(() => {
    console.error('[agent-bridge] Exiting due to unhandled rejection');
    process.exit(1);
  }, 100);
});

