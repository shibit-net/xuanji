// ============================================================
// agent-bridge.ts — ChatSession 子进程桥接
// ============================================================
//
// 在独立 Node.js 进程中运行 ChatSession，
// 通过 MessageBus 与 Electron 主进程通信。
// 这样 better-sqlite3 等 native 模块使用系统 Node.js 加载，
// 不受 Electron ABI 限制。
//

import { SessionFactory } from '../../src/core/chat/SessionFactory.js';
import type { ChatSession } from '../../src/core/chat/ChatSession.js';
import { getTodoManager } from '../../src/core/tools/TodoManager.js';
import { ChildMessageChannel } from './ipc/MessageBus.js';

let session: ChatSession | null = null;

// 创建子进程消息通道
const channel = new ChildMessageChannel({
  name: 'agent-child',
  enableLogging: true,
});

// 子进程启动完成，通知主进程
console.log('[agent-bridge] 子进程已启动');
channel.send('child-ready', { pid: process.pid });

// ============================================================
// 注册消息处理器
// ============================================================

// 初始化 Session
channel.handle('init', async (data) => {
  return await handleInit(data?.userId);
});

// 触发启动消息
channel.handle('trigger-startup', async () => {
  return await handleTriggerStartup();
});

// 发送用户消息
channel.handle('send-message', async (data) => {
  return await handleSendMessage(data);
});

// 中断执行
channel.handle('interrupt', (data) => {
  handleInterrupt(data?.message || '');
  return { success: true };
});

// 重置会话
channel.handle('reset', () => {
  return handleReset();
});

// 获取状态
channel.handle('get-state', () => {
  return handleGetState();
});

// 获取配置
channel.handle('get-config', () => {
  return handleGetConfig();
});

// 获取完整配置
channel.handle('get-full-config', () => {
  return handleGetFullConfig();
});

// 更新配置
channel.handle('update-config', (data) => {
  return handleUpdateConfig(data);
});

// ============ 会话管理 ============
channel.handle('session-save', (data) => handleSessionSave(data));
channel.handle('session-resume', (data) => handleSessionResume(data));
channel.handle('session-list', () => handleSessionList());
channel.handle('session-delete', (data) => handleSessionDelete(data));
channel.handle('checkpoint-create', (data) => handleCheckpointCreate(data));
channel.handle('checkpoint-list', () => handleCheckpointList());
channel.handle('checkpoint-rewind', (data) => handleCheckpointRewind(data));

// ============ 记忆管理 ============
channel.handle('memory-retrieve', (data) => handleMemoryRetrieve(data));
channel.handle('memory-stats', () => handleMemoryStats());
channel.handle('memory-get-config', () => handleGetMemoryConfig());
channel.handle('memory-save-config', (data) => handleSaveMemoryConfig(data));
channel.handle('memory-manual-flush', () => handleManualMemoryFlush());
channel.handle('memory-extract-topics', () => handleExtractTopics());
channel.handle('memory-get-list', (data) => handleGetMemoryList(data));

// ============ 核心规则管理 ============
channel.handle('core-rules-get-all', () => handleCoreRulesGetAll());
channel.handle('core-rules-update', (data) => handleCoreRulesUpdate(data));
channel.handle('core-rules-delete', (data) => handleCoreRulesDelete(data));

// ============ 工具统计 ============
channel.handle('get-usage-stats', () => handleGetUsageStats());

// ============ Agent 管理 ============
channel.handle('agent-list', () => handleAgentList());
channel.handle('agent-get', (data) => handleAgentGet(data));
channel.handle('agent-create', (data) => handleAgentCreate(data));
channel.handle('agent-update', (data) => handleAgentUpdate(data));
channel.handle('agent-delete', (data) => handleAgentDelete(data));

// ============ Skills / Tools / MCP 查询 ============
channel.handle('skills-list', () => handleSkillsList());
channel.handle('tools-list', () => handleToolsList());
channel.handle('mcp-list', () => handleMcpList());

// ============ 高级功能 ============
channel.handle('compact', (data) => handleCompact(data));
channel.handle('get-diagnostics', () => handleGetDiagnostics());

// ============ Prompt 配置管理 ============
channel.handle('get-prompt-config', () => handleGetPromptConfig());
channel.handle('save-prompt-config', (data) => handleSavePromptConfig(data));

// ============ 权限交互响应 ============
channel.handle('permission-response', (data) => {
  handlePermissionResponse(data);
  return { success: true };
});
channel.handle('plan-review-response', (data) => {
  handlePlanReviewResponse(data);
  return { success: true };
});
channel.handle('ask-user-response', (data) => {
  handleAskUserResponse(data);
  return { success: true };
});

// ============ 权限规则管理 ============
channel.handle('permission-list', () => handlePermissionList());
channel.handle('permission-delete', (data) => handlePermissionDelete(data));
channel.handle('permission-clear', () => handlePermissionClear());

// ============ Todo 管理 ============
channel.handle('todo-archive-completed', () => handleTodoArchiveCompleted());
channel.handle('todo-get-archived-count', () => handleTodoGetArchivedCount());

// ============ 关闭 ============
channel.on('shutdown', () => {
  console.log('[agent-bridge] 收到关闭信号');
  process.exit(0);
});

// ============================================================
// Hook 事件监听器
// ============================================================

/**
 * 安全地发送消息到主进程（用于事件通知）
 */
function safeSend(message: { type: string; data?: any }) {
  channel.send(message.type, message.data);
}

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
/**
 * 初始化 ChatSession
 * @param userId - 用户 ID，由主进程传递
 */
async function handleInit(userId?: string) {
  try {
    // 如果没有传递 userId，尝试从 authState 获取（兼容旧逻辑）
    if (!userId) {
      try {
        const { getAuthState } = await import('./config/auth.js');
        const authState = getAuthState();
        if (authState?.user?.userId) {
          userId = authState.user.userId;
        }
      } catch (err) {
        console.warn('[agent-bridge] 无法从 authState 获取用户:', err);
      }
    }

    if (!userId) {
      console.error('[agent-bridge] 用户未登录，无法初始化 session');
      // 发送初始化失败事件
      safeSend({
        type: 'init-complete',
        data: { success: false, error: '用户未登录' },
      });
      return { success: false, error: '用户未登录' };
    }

    console.log(`[agent-bridge] 初始化会话，用户: ${userId}`);

    // 默认使用 'xuanji' agent，后续可以支持动态切换
    const agentId = 'xuanji';
    const factory = new SessionFactory(userId, agentId);
    session = await factory.create({
      userId,
      agentId,
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

    // 发送初始化完成事件
    safeSend({
      type: 'init-complete',
      data: { success: true },
    });
    console.log('[agent-bridge] Session 初始化完成');

    // 返回成功结果
    return { success: true };
  } catch (err) {
    console.error('[agent-bridge] Session 初始化失败:', err);
    const error = err instanceof Error ? err.message : String(err);

    // 发送初始化失败事件
    safeSend({
      type: 'init-complete',
      data: { success: false, error },
    });

    // 返回失败结果
    return { success: false, error };
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
    if (!session) {
      console.warn('[agent-bridge] Session 未初始化，无法触发启动消息');
      return;
    }

    const config = session.getConfig();
    const isNewUser = !config.onboardingDone;

    let hasMemories = false;
    if (!isNewUser) {
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
    return { success: false, error: '会话未初始化' };
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
function handleGetState() {
  if (!session) {
    safeSend({ type: 'state-result', data: {
        status: 'idle',
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
      },
    });
    return null;
  }

  const state = session.getState();
  safeSend({ type: 'state-result', data: {
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
function handleGetConfig() {
  if (!session) {
    safeSend({ type: 'config-result', data: null,
    });
    return null;
  }

  const config = session.getConfig();
  safeSend({ type: 'config-result', data: {
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
async function handleGetFullConfig() {
  if (!session) {
    return null;
  }

  const config = session.getConfig();

  return {
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
    persona: config.persona ?? {},
    onboardingDone: config.onboardingDone,
  };
}

/**
 * 更新配置（设置页面保存时调用）
 */
async function handleUpdateConfig(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }

  try {
    // 获取当前用户 ID
    const { getAuthState } = await import('./config/auth.js');
    const authState = getAuthState();
    const userId = authState?.user?.userId;

    if (!userId) {
      return { success: false, error: '用户未登录' };
    }

    const { ConfigLoader } = await import('../../src/core/config/ConfigLoader.js');
    const { getUserConfigPath } = await import('../../src/core/config/PathManager.js');
    const { readFile, writeFile } = await import('node:fs/promises');

    // 1. 读取用户配置文件
    const configPath = getUserConfigPath(userId);
    const content = await readFile(configPath, 'utf-8');
    const userConfigFile = JSON.parse(content);

    // 2. 确保 config.provider 对象存在
    if (!userConfigFile.config) {
      userConfigFile.config = {};
    }
    if (!userConfigFile.config.provider) {
      userConfigFile.config.provider = {};
    }

    // 3. 合并新配置
    let needPersist = false;
    if (data.apiKey && !data.apiKey.startsWith('***')) {
      userConfigFile.config.provider.apiKey = data.apiKey;
      needPersist = true;
    }
    if (data.model) {
      userConfigFile.config.provider.model = data.model;
      needPersist = true;
    }
    if (data.adapter) {
      userConfigFile.config.provider.adapter = data.adapter;
      needPersist = true;
    }
    if (data.baseURL !== undefined) {
      userConfigFile.config.provider.baseURL = data.baseURL;
      needPersist = true;
    }
    if (data.persona !== undefined) {
      userConfigFile.config.persona = data.persona;
      needPersist = true;
    }
    if (data.onboardingDone !== undefined) {
      userConfigFile.config.onboardingDone = data.onboardingDone;
      needPersist = true;
    }

    // 4. 持久化到用户配置文件
    if (needPersist) {
      userConfigFile.updatedAt = new Date().toISOString();
      await writeFile(configPath, JSON.stringify(userConfigFile, null, 2), 'utf-8');
      console.log('[agent-bridge] 用户配置已保存，userId:', userId);
    }

    // 5. 重新加载完整配置并重新创建 session
    const agentId = 'xuanji'; // 默认使用 xuanji agent
    const configLoader = new ConfigLoader(userId, agentId);
    const fullConfig = await configLoader.load();
    console.log('[agent-bridge] 重新加载配置完成');

    // 重新创建 session
    const { SessionFactory } = await import('../../src/core/chat/SessionFactory.js');
    const factory = new SessionFactory(userId, agentId);
    session = await factory.create({
      userId,
      agentId,
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

    safeSend({ type: 'update-config-result', data: { success: true },
    });
  } catch (err) {
    safeSend({ type: 'update-config-result', data: {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

// ============================================================
// 会话管理
// ============================================================

async function handleSessionSave(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const sessionId = await session.saveSession(data?.name, data?.options);
    return { success: true, sessionId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleSessionResume(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const ctx = await session.resumeSession(data?.sessionId);
    safeSend({ data: {
        success: true,
        sessionId: ctx.sessionId,
        usage: ctx.usage,
        historyMessages: ctx.historyMessages,
        messageCount: ctx.messages?.length || 0,
      },
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleSessionList() {
  if (!session) {
    return { success: true, sessions: [] };
  }
  try {
    const sessions = await session.listSessions();
    return { success: true, sessions };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleSessionDelete(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    await session.deleteSession(data?.sessionId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCheckpointCreate(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const checkpointId = await session.createCheckpoint(data?.label);
    return { success: true, checkpointId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCheckpointList() {
  if (!session) {
    return { success: true, checkpoints: [] };
  }
  try {
    const checkpoints = await session.listCheckpoints();
    return { success: true, checkpoints };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCheckpointRewind(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const messageCount = await session.rewindToCheckpoint(data?.checkpointId);
    return { success: true, messageCount };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// 记忆管理
// ============================================================

async function handleMemoryRetrieve(data: any) {
  if (!session) {
    return { success: true, entries: [] };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: true, entries: [], stats: null };
    }
    const entries = await memoryManager.retrieve(data?.query || '', data?.options);
    safeSend({ data: {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleMemoryStats() {
  if (!session) {
    return { success: true, stats: null };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: true, stats: null };
    }
    const stats = await memoryManager.getStats();
    return { success: true, stats };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 获取记忆配置
async function handleGetMemoryConfig() {
  if (!session) {
    return { success: true, config: null };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: true, config: null };
    }
    const config = memoryManager.getConfig();
    return { success: true, config };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 保存记忆配置
async function handleSaveMemoryConfig(data: any) {
  if (!session) {
    return { success: false, error: 'Session not initialized' };
  }
  try {
    const memoryConfig = data.config;
    if (!memoryConfig) {
      return { success: false, error: 'No config provided' };
    }

    // 获取当前用户 ID
    const { getAuthState } = await import('./config/auth.js');
    const authState = getAuthState();
    const userId = authState?.user?.userId;

    if (!userId) {
      return { success: false, error: '用户未登录' };
    }

    // 1. 读取用户配置文件
    const { getUserConfigPath } = await import('../../src/core/config/PathManager.js');
    const { readFile, writeFile } = await import('node:fs/promises');
    const configPath = getUserConfigPath(userId);
    const content = await readFile(configPath, 'utf-8');
    const userConfigFile = JSON.parse(content);

    // 2. 合并 memory 配置
    if (!userConfigFile.config) {
      userConfigFile.config = {};
    }
    userConfigFile.config.memory = {
      ...userConfigFile.config.memory,
      ...memoryConfig,
    };

    // 3. 保存到用户配置文件
    userConfigFile.updatedAt = new Date().toISOString();
    await writeFile(configPath, JSON.stringify(userConfigFile, null, 2), 'utf-8');

    // 4. 热更新运行时 MemoryManager 配置（如果可能）
    const memoryManager = session.getMemoryManager();
    if (memoryManager) {
      // 注意：这里只是更新配置，不重新初始化组件
      // 完整的配置生效需要重新初始化会话
      (memoryManager as any).config = userConfigFile.config.memory;
    }

    return { success: true, requiresRestart: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 手动触发记忆刷新
async function handleManualMemoryFlush() {
  if (!session) {
    return { success: false, error: 'Session not initialized' };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: false, error: 'MemoryManager not available' };
    }
    const intelligentFlush = memoryManager.getIntelligentFlush();
    if (!intelligentFlush) {
      return { success: false, error: 'IntelligentFlush not enabled' };
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
    return { success: true, flushed };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 手动提取主题
async function handleExtractTopics() {
  if (!session) {
    return { success: false, error: 'Session not initialized' };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: false, error: 'MemoryManager not available' };
    }

    // 调用 MemoryManager 的 extractTopics 方法
    const dayKey = new Date().toISOString().split('T')[0]; // 今天的日期
    await memoryManager.extractTopics(dayKey);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 获取记忆列表
async function handleGetMemoryList(data: any) {
  if (!session) {
    return { success: true, memories: [] };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: true, memories: [] };
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

    return { success: true, memories };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// 核心规则管理
// ============================================================

async function handleCoreRulesGetAll() {
  if (!session) {
    return { success: true, rules: [] };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: true, rules: [] };
    }

    const coreRuleStore = memoryManager.getCoreRuleStore();
    if (!coreRuleStore) {
      return { success: true, rules: [] };
    }

    const rules = coreRuleStore.getAllRules();
    return { success: true, rules };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCoreRulesUpdate(data: { id: string; active?: boolean }) {
  if (!session) {
    return { success: false, error: 'Session not initialized' };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: false, error: 'MemoryManager not available' };
    }

    const coreRuleStore = memoryManager.getCoreRuleStore();
    if (!coreRuleStore) {
      return { success: false, error: 'CoreRuleStore not available' };
    }

    const success = coreRuleStore.setActive(data.id, data.active ?? true);
    if (success) {
      return { success: true };
    } else {
      return { success: false, error: 'Rule not found' };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCoreRulesDelete(data: { id: string }) {
  if (!session) {
    return { success: false, error: 'Session not initialized' };
  }
  try {
    const memoryManager = session.getMemoryManager();
    if (!memoryManager) {
      return { success: false, error: 'MemoryManager not available' };
    }

    const coreRuleStore = memoryManager.getCoreRuleStore();
    if (!coreRuleStore) {
      return { success: false, error: 'CoreRuleStore not available' };
    }

    const success = coreRuleStore.delete(data.id);
    if (success) {
      return { success: true };
    } else {
      return { success: false, error: 'Rule not found' };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// 工具统计
// ============================================================

async function handleGetUsageStats() {
  if (!session) {
    return { success: true, stats: null };
  }
  try {
    const state = session.getState();
    safeSend({ data: {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// 高级功能
// ============================================================

async function handleCompact(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const result = await session.getAgentLoop().compact(data?.instruction);
    safeSend({ data: {
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleGetDiagnostics() {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const report = await session.getDiagnostics();
    return { success: true, report };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Agent 管理
// ============================================================

/**
 * 获取 Agent 列表
 */
async function handleAgentList() {
  if (!session) {
    return { success: true, agents: [] };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      return { success: true, agents: [] };
    }
    // 获取所有 Agent（包括禁用的），用于 GUI 管理界面
    const agents = agentRegistry.getAll();
    return { success: true, agents };
  } catch (err) {
    console.error('[agent-bridge] 获取 Agent 列表失败:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleAgentGet(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      return { success: false, error: 'Agent Registry 未初始化' };
    }
    const agent = agentRegistry.get(data?.agentId);
    if (!agent) {
      return { success: false, error: `Agent 不存在: ${data?.agentId}` };
    }
    return { success: true, agent };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleAgentCreate(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      return { success: false, error: 'Agent Registry 未初始化' };
    }

    // 保存到 YAML 文件（全局或项目级）
    const scope = data?.scope || 'global';
    await agentRegistry.saveToFile(data?.config, scope);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleAgentUpdate(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      return { success: false, error: 'Agent Registry 未初始化' };
    }

    // 更新 YAML 文件（自动检测 scope）
    const existingAgent = agentRegistry.get(data?.agentId);
    if (!existingAgent || !existingAgent.metadata) {
      return { success: false, error: `Agent 不存在: ${data?.agentId}` };
    }

    const scope = existingAgent.metadata.source === 'project' ? 'project' : 'global';
    await agentRegistry.saveToFile(data?.config, scope);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleAgentDelete(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      return { success: false, error: 'Agent Registry 未初始化' };
    }

    // 删除 YAML 文件
    await agentRegistry.deleteFile(data?.agentId);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Skills / Tools / MCP 查询
// ============================================================

async function handleSkillsList() {
  if (!session) {
    return { success: true, skills: [] };
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
    return { success: true, skills };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleToolsList() {
  if (!session) {
    return { success: true, tools: [] };
  }
  try {
    const baseRegistry = session.getBaseRegistry();
    if (!baseRegistry) {
      return { success: true, tools: [] };
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
    return { success: true, tools };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleMcpList() {
  if (!session) {
    return { success: true, servers: [] };
  }
  try {
    const mcpManager = session.getMCPManager();
    if (!mcpManager) {
      return { success: true, servers: [] };
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

    return { success: true, servers };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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

function handlePermissionList() {
  if (!session) {
    return { success: true, rules: [] };
  }
  try {
    const pc = session.getPermissionController();
    const rules = pc ? pc.listDecisions() : [];
    return { success: true, rules };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePermissionDelete(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    if (pc) {
      await pc.deleteDecision(data?.cacheKey);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePermissionClear() {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    if (pc) {
      await pc.clearDecisions();
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============ Todo 管理 ============

async function handleTodoArchiveCompleted() {
  try {
    const todoManager = getTodoManager();
    const count = await todoManager.archiveCompleted();
    return { success: true, count };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleTodoGetArchivedCount() {
  try {
    const todoManager = getTodoManager();
    const count = await todoManager.getArchivedCount();
    return { success: true, count };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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

