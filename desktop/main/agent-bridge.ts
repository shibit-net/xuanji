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
import { DownloadManager } from '../../src/core/download/DownloadManager.js';

let session: ChatSession | null = null;
let currentUserId: string | null = null;

// 创建子进程消息通道
const channel = new ChildMessageChannel({
  name: 'agent-child',
  enableLogging: true,
});

// 子进程启动完成，通知主进程
console.log('[agent-bridge] 子进程已启动');
channel.send('child-ready', { pid: process.pid });

// ============================================================
// 下载事件转发
// ============================================================
const downloadManager = DownloadManager.getInstance();

// 转发 DownloadManager 事件到主进程
const forwardDownloadEvent = (eventName: string) => {
  downloadManager.on(eventName, (task) => {
    console.log(`[agent-bridge] DownloadManager 事件: ${eventName}, task:`, task.id, task.name);
    // 子进程任务统一加 child: 前缀，避免与主进程任务 ID 冲突
    const prefixedTask = { ...task, id: `child:${task.id}` };
    console.log(`[agent-bridge] 转发下载事件到主进程: ${eventName}, prefixedTask:`, prefixedTask.id);
    channel.send('download:event', { type: eventName, task: prefixedTask });
    console.log(`[agent-bridge] 下载事件已发送: ${eventName}`);
  });
};

forwardDownloadEvent('task-created');
forwardDownloadEvent('task-started');
forwardDownloadEvent('task-progress');
forwardDownloadEvent('task-completed');
forwardDownloadEvent('task-failed');
forwardDownloadEvent('task-cancelled');

console.log('[agent-bridge] Download events forwarding enabled');

// ============================================================
// 注册消息处理器
// ============================================================

// 初始化 Session
channel.handle('init', async (data) => {
  return await handleInit(data?.userId);
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

// ============ 工具统计 ============
channel.handle('get-usage-stats', () => handleGetUsageStats());

// ============ Agent 管理 ============
channel.handle('agent-list', () => handleAgentList());
channel.handle('agent-get', (data) => handleAgentGet(data));
channel.handle('agent-create', (data) => handleAgentCreate(data));
channel.handle('agent-update', (data) => handleAgentUpdate(data));
channel.handle('agent-delete', (data) => handleAgentDelete(data));

// ============ Tools 查询 ============
channel.handle('tools-list', () => handleToolsList());

// ============ 高级功能 ============
channel.handle('compact', (data) => handleCompact(data));
channel.handle('get-diagnostics', () => handleGetDiagnostics());

// ============ Prompt 配置管理 ============
channel.handle('prompt-get-components', () => handlePromptGetComponents());
channel.handle('prompt-toggle-component', (data) => handlePromptToggleComponent(data));
channel.handle('prompt-update-component', (data) => handlePromptUpdateComponent(data));
channel.handle('prompt-preview', (data) => handlePromptPreview(data));
channel.handle('get-prompt-config', () => handleGetPromptConfig());
channel.handle('save-prompt-config', (data) => handleSavePromptConfig(data));

// ============ 项目管理 ============
channel.handle('projects-list', () => handleProjectsList());
channel.handle('projects-get-rules', (data) => handleProjectsGetRules(data));
channel.handle('projects-save-rules', (data) => handleProjectsSaveRules(data));
channel.handle('projects-get-docs', (data) => handleProjectsGetDocs(data));
channel.handle('projects-read-doc', (data) => handleProjectsReadDoc(data));

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
channel.handle('permission-config-get', () => handlePermissionConfigGet());
channel.handle('permission-config-update', (data) => handlePermissionConfigUpdate(data));
channel.handle('permission-audit-list', (data) => handlePermissionAuditList(data));
channel.handle('permission-audit-stats', () => handlePermissionAuditStats());
channel.handle('permission-audit-clear', () => handlePermissionAuditClear());
channel.handle('permission-denied-list', () => handlePermissionDeniedList());
channel.handle('permission-denied-delete', (data) => handlePermissionDeniedDelete(data));
channel.handle('permission-denied-clear', () => handlePermissionDeniedClear());

// ============ Todo 管理 ============
channel.handle('todo-archive-completed', () => handleTodoArchiveCompleted());
channel.handle('todo-get-archived-count', () => handleTodoGetArchivedCount());

// ============ 下载管理 ============
channel.handle('download-get-tasks', () => {
  const tasks = downloadManager.getAllTasks();
  return { success: true, tasks };
});

channel.handle('download-cancel', (data) => {
  try {
    downloadManager.cancel(data.taskId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

channel.handle('download-clear-finished', () => {
  try {
    downloadManager.clearFinished();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

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
  // ━━━ MainAgent 流程事件 ━━━
  // 注意：prompt:build-event 现在由 LayeredPromptBuilder 直接发送真实事件

  // ModelClassifier 事件
  hookRegistry.addListener('ModelClassifierStart', async (ctx: any) => {
    safeSend({
      type: 'workspace:model-classifier-start',
      data: {
        userInput: ctx.data.userInput,
        model: ctx.data.model,
        sessionId: ctx.sessionId,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('ModelClassifierEnd', async (ctx: any) => {
    safeSend({
      type: 'workspace:model-classifier-end',
      data: {
        userInput: ctx.data.userInput,
        model: ctx.data.model,
        agent: ctx.data.agent,
        scene: ctx.data.scene,
        confidence: ctx.data.confidence,
        durationMs: ctx.data.durationMs,
        sessionId: ctx.sessionId,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  // IntentAnalysis 事件
  hookRegistry.addListener('IntentAnalysisStart', async (ctx: any) => {
    safeSend({
      type: 'workspace:intent-analysis-start',
      data: {
        userInput: ctx.data.userInput,
        sessionId: ctx.sessionId,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('IntentAnalysisEnd', async (ctx: any) => {
    safeSend({
      type: 'workspace:intent-analysis-end',
      data: {
        userInput: ctx.data.userInput,
        scene: ctx.data.scene,
        complexity: ctx.data.complexity,
        confidence: ctx.data.confidence,
        matchMethod: ctx.data.matchMethod,
        intentClassifier: ctx.data.modelClassifier,
        sessionId: ctx.sessionId,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  // ━━━ SubAgent/Team 事件 ━━━
  hookRegistry.addListener('TaskPlanningStart', async (ctx: any) => {
    safeSend({
      type: 'workspace:task-planning-start',
      data: {
        userInput: ctx.userInput,
        sessionId: ctx.sessionId,
        scene: ctx.scene,
        complexity: ctx.complexity,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('TaskPlanningEnd', async (ctx: any) => {
    safeSend({
      type: 'workspace:task-planning-end',
      data: {
        userInput: ctx.userInput,
        sessionId: ctx.sessionId,
        strategy: ctx.strategy,
        tasks: ctx.tasks,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('TaskExecutionStart', async (ctx: any) => {
    safeSend({
      type: 'workspace:task-execution-start',
      data: {
        userInput: ctx.userInput,
        sessionId: ctx.sessionId,
        strategy: ctx.strategy,
        taskCount: ctx.taskCount,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('TaskExecutionEnd', async (ctx: any) => {
    safeSend({
      type: 'workspace:task-execution-end',
      data: {
        userInput: ctx.userInput,
        sessionId: ctx.sessionId,
        success: ctx.success,
        duration: ctx.duration,
        output: ctx.output,
        error: ctx.error,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('ResultAggregationStart', async (ctx: any) => {
    safeSend({
      type: 'workspace:result-aggregation-start',
      data: {
        userInput: ctx.userInput,
        sessionId: ctx.sessionId,
        memberCount: ctx.memberCount,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  hookRegistry.addListener('ResultAggregationEnd', async (ctx: any) => {
    safeSend({
      type: 'workspace:result-aggregation-end',
      data: {
        userInput: ctx.userInput,
        sessionId: ctx.sessionId,
        output: ctx.output,
        timestamp: Date.now(),
      },
    });
    return { success: true };
  });

  // ━━━ 原有的 Team 事件 ━━━

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
        agentType: ctx.data?.agentType,
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
    const data: any = {
      teamId: ctx.teamId,
      name: ctx.data?.name,
      success: ctx.data?.success,
      duration: ctx.data?.duration,
    };
    // 只在有错误时才添加 error 字段
    if (ctx.data?.error !== undefined) {
      data.error = ctx.data.error;
    }
    safeSend({
      type: 'agent:team-end',
      data,
    });
    return { success: true };
  });

  hookRegistry.addListener('SubAgentStart', async (ctx: any) => {
    const role = ctx.data?.role || 'unknown';
    const parentAgentId = ctx.data?.parentAgentId || 'main';

    safeSend({
      type: 'agent:subagent-start',
      data: {
        subAgentId: ctx.subAgentId,
        name: ctx.data?.name || role,
        role: role,
        task: ctx.data?.task,
        agentType: ctx.data?.agentType,
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

    // 保存当前用户 ID
    currentUserId = userId;
    console.log(`[agent-bridge] 初始化会话，用户: ${userId}`);

    // 默认使用 'xuanji' agent，后续可以支持动态切换
    const agentId = 'xuanji';
    const factory = new SessionFactory(userId, agentId);
    session = await factory.create({
      userId,
      agentId,
      callbacks: {
        onBeforeExecution: async (input: string) => {
          // 在执行任务前，如果有项目根目录，切换到该目录
          if (currentProjectRoot) {
            try {
              process.chdir(currentProjectRoot);
              console.log(`[agent-bridge] 切换工作目录到项目根目录: ${currentProjectRoot}`);
            } catch (err) {
              console.warn(`[agent-bridge] 切换目录失败: ${err}`);
            }
          }
        },
        onText: (text: string) => {
          safeSend({ type: 'agent:text', data: text });
        },
        onThinking: (thinking: string) => {
          safeSend({ type: 'agent:thinking', data: thinking });
        },
        onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
          safeSend({ type: 'agent:tool-start', data: { id, name, input } });

          // 从工具调用中提取文件路径，自动检测项目
          detectProjectFromToolCall(name, input);
        },
        onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
          safeSend({ type: 'agent:tool-end', data: { id, name, result, isError } });

          // 如果是 change_directory 工具且执行成功，立即检测项目信息
          if (name === 'change_directory' && !isError) {
            detectProjectFromCwd();
          }
        },
        onFileChanges: (changes: any[]) => {
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
        onArchiveNotification: (result) => {
          safeSend({ type: 'session:archive-notification', data: result });
        },
      },
    });

    // 注入权限交互 Handler
    injectInteractionHandlers();

    // 注册 SubAgent/Team Hook 事件监听，将成员状态变更转发到 renderer
    const container = session.getContainer();
    const hookRegistry = container.resolveSync('hookRegistry');
    registerHookListeners(hookRegistry);

    // 注册 Prompt 构建事件监听器
    const promptBuilder = session.getLayeredPromptBuilder();
    console.log('[agent-bridge] promptBuilder 存在:', !!promptBuilder);
    if (promptBuilder) {
      console.log('[agent-bridge] 注册 promptBuilder 事件监听器');
      promptBuilder.addEventListener((event) => {
        console.log('[agent-bridge] 收到 promptBuilder 事件:', event.type, event);
        safeSend({
          type: 'prompt:build-event',
          data: event,
        });
        console.log('[agent-bridge] 已转发 prompt:build-event');
      });
    }

    // 🔧 初始化时不自动扫描项目，避免显示 xuanji 自身的路径
    // 项目信息会在用户明确打开/切换项目时通过 detectProjectFromCwd() 或 detectProjectFromFile() 发送
    console.log('[agent-bridge] 初始化完成，等待用户打开项目');

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
      embedding: config.embedding ? {
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        cacheEnabled: config.embedding.cacheEnabled,
        cacheMaxSize: config.embedding.cacheMaxSize,
        hfMirror: config.embedding.hfMirror,
      } : undefined,
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
    embedding: config.embedding ? {
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
      cacheEnabled: config.embedding.cacheEnabled,
      cacheMaxSize: config.embedding.cacheMaxSize,
      hfMirror: config.embedding.hfMirror,
    } : {
      model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      dimensions: 384,
      cacheEnabled: true,
      cacheMaxSize: 100,
      hfMirror: 'https://hf-mirror.com',
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
    const { GlobalConfig } = await import('../../src/core/config/GlobalConfig.js');
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

    // 3. 合并新配置（用户级配置）
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

    // 5. 处理项目级配置（embedding）
    if (data.embedding !== undefined) {
      const projectRoot = process.cwd();
      const projectConfig = await GlobalConfig.readProjectConfig(projectRoot);
      projectConfig.embedding = data.embedding;
      await GlobalConfig.writeProjectConfig(projectConfig, projectRoot);
      console.log('[agent-bridge] 项目配置已保存（embedding）');
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
        onText: (text: string) => {
          safeSend({ type: 'agent:text', data: text });
        },
        onThinking: (thinking: string) => {
          safeSend({ type: 'agent:thinking', data: thinking });
        },
        onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
          safeSend({ type: 'agent:tool-start', data: { id, name, input } });

          // 从工具调用中提取文件路径，自动检测项目
          detectProjectFromToolCall(name, input);
        },
        onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
          safeSend({ type: 'agent:tool-end', data: { id, name, result, isError } });

          // 如果是 change_directory 工具且执行成功，立即检测项目信息
          if (name === 'change_directory' && !isError) {
            detectProjectFromCwd();
          }
        },
        onFileChanges: (changes: any[]) => {
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
        onArchiveNotification: (result) => {
          safeSend({ type: 'session:archive-notification', data: result });
        },
      },
    });

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
// 核心规则管理
// ============================================================




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
// Tools 查询
// ============================================================

async function handleToolsList() {
  console.log('[agent-bridge handleToolsList] 开始处理');
  console.log('[agent-bridge handleToolsList] session:', !!session);

  if (!session) {
    console.warn('[agent-bridge handleToolsList] session 不存在，返回空数组');
    return { success: true, tools: [] };
  }
  try {
    const baseRegistry = session.getBaseRegistry();
    console.log('[agent-bridge handleToolsList] baseRegistry:', !!baseRegistry);

    if (!baseRegistry) {
      console.warn('[agent-bridge handleToolsList] baseRegistry 不存在，返回空数组');
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
    console.log('[agent-bridge handleToolsList] allTools 数量:', allTools.length);

    const tools = allTools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      category: categorize(tool.name),
      required: tool.required ?? false,
      readonly: tool.readonly ?? true,
    }));

    console.log('[agent-bridge handleToolsList] 返回工具数量:', tools.length);
    console.log('[agent-bridge handleToolsList] 前3个工具:', tools.slice(0, 3));

    return { success: true, tools };
  } catch (err) {
    console.error('[agent-bridge handleToolsList] 异常:', err);
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
        // 🆕 传递上下文信息到前端
        context: question?.context || {},
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

function handlePermissionConfigGet() {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    const config = pc ? pc.getConfig() : null;
    return { success: true, config };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePermissionConfigUpdate(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    if (pc && data?.updates) {
      await pc.updateConfig(data.updates);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function handlePermissionAuditList(data: any) {
  if (!session) {
    return { success: true, logs: [] };
  }
  try {
    const pc = session.getPermissionController();
    const logs = pc ? pc.listAuditLogs(data?.options || {}) : [];
    return { success: true, logs };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function handlePermissionAuditStats() {
  if (!session) {
    return { success: true, stats: { totalChecks: 0, allowedCount: 0, deniedCount: 0, allowRate: 0 } };
  }
  try {
    const pc = session.getPermissionController();
    const stats = pc ? pc.getAuditStats() : { totalChecks: 0, allowedCount: 0, deniedCount: 0, allowRate: 0 };
    return { success: true, stats };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePermissionAuditClear() {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    if (pc) {
      await pc.clearAuditLogs();
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function handlePermissionDeniedList() {
  if (!session) {
    return { success: true, deniedOps: [] };
  }
  try {
    const pc = session.getPermissionController();
    const deniedOps = pc ? pc.listDeniedOperations() : [];
    return { success: true, deniedOps };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePermissionDeniedDelete(data: any) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    if (pc && data?.key) {
      await pc.deleteDeniedOperation(data.key);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePermissionDeniedClear() {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const pc = session.getPermissionController();
    if (pc) {
      await pc.clearDeniedOperations();
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Prompt 组件管理
// ============================================================

async function handlePromptGetComponents() {
  if (!session) {
    return { success: true, components: [] };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: true, components: [] };
    }
    const allComponents = builder.getAllComponents();

    // 调用 render() 获取内容
    const components = await Promise.all(
      allComponents.map(async (c: any) => {
        let content = '';
        try {
          // render 可能是同步或异步的
          const rendered = c.render({});
          content = typeof rendered === 'string' ? rendered : await rendered;
        } catch (err) {
          console.error(`Failed to render component ${c.id}:`, err);
          content = '[渲染失败]';
        }

        return {
          id: c.id,
          name: c.name,
          layer: c.layer,
          priority: c.priority,
          estimatedTokens: c.estimatedTokens,
          enabled: c.enabled ?? true,
          scenes: c.scenes,
          complexity: c.complexity,
          content,
          dynamic: c.dynamic ?? false,
          match: c.match ? {
            keywords: c.match.keywords?.source || '',
            description: c.match.description || '',
          } : undefined,
        };
      })
    );

    return { success: true, components };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePromptToggleComponent(data: { id: string; enabled: boolean }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }
    await builder.toggleComponent(data.id, data.enabled);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePromptUpdateComponent(data: { id: string; content?: string; keywords?: string }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }
    await builder.updateComponent(data.id, { content: data.content, keywords: data.keywords });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePromptPreview(data: { scene?: string; complexity?: string }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }
    const result = await builder.build({
      scene: (data.scene as any) || 'coding',
      complexity: (data.complexity as any) || 'standard',
    });
    return { success: true, prompt: result.prompt, components: result.components, estimatedTokens: result.estimatedTokens };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleGetPromptConfig() {
  return { success: true, config: {} };
}

async function handleSavePromptConfig(_data: any) {
  return { success: true };
}

// ============ 项目管理 ============

/**
 * 获取所有项目列表
 */
async function handleProjectsList() {
  try {
    // 优先使用全局 currentUserId
    let userId = currentUserId;

    // 如果没有，尝试从 authState 获取（兼容性）
    if (!userId) {
      const { getAuthState } = await import('./config/auth.js');
      const authState = getAuthState();
      userId = authState?.user?.userId;
    }

    if (!userId) {
      return { success: false, error: '用户未登录' };
    }

    const { ProjectRegistry } = await import('../../src/core/project/ProjectRegistry.js');
    const registry = new ProjectRegistry(userId);
    const projects = await registry.list();

    return { success: true, projects };
  } catch (err) {
    console.error('[agent-bridge] 获取项目列表失败:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '获取项目列表失败',
    };
  }
}

/**
 * 获取项目规则文件内容
 */
async function handleProjectsGetRules(data: any) {
  try {
    const { projectPath } = data;
    if (!projectPath) {
      return { success: false, error: '缺少 projectPath 参数' };
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 按优先级读取规则文件
    const ruleFiles = [
      path.join(projectPath, 'XUANJI.md'),
      path.join(projectPath, '.xuanji', 'rules.md'),
    ];

    for (const filePath of ruleFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          success: true,
          rules: content,
          filePath,
        };
      } catch {
        // 文件不存在，继续尝试下一个
      }
    }

    // 所有文件都不存在
    return {
      success: true,
      rules: '',
      filePath: ruleFiles[0], // 默认使用第一个文件路径
    };
  } catch (err) {
    console.error('[agent-bridge] 获取项目规则失败:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '获取项目规则失败',
    };
  }
}

/**
 * 保存项目规则文件
 */
async function handleProjectsSaveRules(data: any) {
  try {
    const { projectPath, rules, filePath } = data;
    if (!projectPath || rules === undefined) {
      return { success: false, error: '缺少必要参数' };
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 确定保存路径
    const targetPath = filePath || path.join(projectPath, 'XUANJI.md');

    // 确保目录存在
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });

    // 保存文件
    await fs.writeFile(targetPath, rules, 'utf-8');

    console.log('[agent-bridge] 项目规则已保存:', targetPath);
    return { success: true };
  } catch (err) {
    console.error('[agent-bridge] 保存项目规则失败:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '保存项目规则失败',
    };
  }
}

/**
 * 获取项目的所有 xuanji 文档文件列表
 */
async function handleProjectsGetDocs(data: any) {
  try {
    const { projectPath } = data;
    if (!projectPath) {
      return { success: false, error: '缺少 projectPath 参数' };
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const docs: Array<{ name: string; path: string; relativePath: string }> = [];

    // 检查 XUANJI.md
    const xuanjiMd = path.join(projectPath, 'XUANJI.md');
    try {
      await fs.access(xuanjiMd);
      docs.push({
        name: 'XUANJI.md',
        path: xuanjiMd,
        relativePath: 'XUANJI.md',
      });
    } catch {
      // 文件不存在
    }

    // 检查 .xuanji 目录
    const xuanjiDir = path.join(projectPath, '.xuanji');
    try {
      const entries = await fs.readdir(xuanjiDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const fullPath = path.join(xuanjiDir, entry.name);
          docs.push({
            name: entry.name,
            path: fullPath,
            relativePath: `.xuanji/${entry.name}`,
          });
        }
      }
    } catch {
      // 目录不存在或无法读取
    }

    return {
      success: true,
      docs,
    };
  } catch (err) {
    console.error('[agent-bridge] 获取项目文档列表失败:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '获取项目文档列表失败',
    };
  }
}

/**
 * 读取指定文档文件的内容
 */
async function handleProjectsReadDoc(data: any) {
  try {
    const { filePath } = data;
    if (!filePath) {
      return { success: false, error: '缺少 filePath 参数' };
    }

    const fs = await import('node:fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');

    return {
      success: true,
      content,
    };
  } catch (err) {
    console.error('[agent-bridge] 读取文档失败:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '读取文档失败',
    };
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

// ============================================================
// 项目自动检测
// ============================================================

let currentProjectRoot: string | null = null;

/**
 * 从当前工作目录检测项目信息
 */
async function detectProjectFromCwd() {
  try {
    const cwd = process.cwd();
    const { ProjectScanner } = await import('../../src/context/ProjectScanner.js');
    const scanner = new ProjectScanner();
    const projectMetadata = scanner.scan(cwd);

    // 如果检测到项目，且与当前项目不同，更新项目信息
    if ((projectMetadata.type !== 'unknown' || projectMetadata.hasGit) &&
        projectMetadata.rootPath !== currentProjectRoot) {
      currentProjectRoot = projectMetadata.rootPath;

      // 获取 git 分支信息
      let gitBranch: string | null = null;
      if (projectMetadata.hasGit) {
        try {
          const { execSync } = await import('node:child_process');
          gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectMetadata.rootPath,
            encoding: 'utf-8',
          }).trim();
        } catch (err) {
          console.warn('[agent-bridge] 获取 git 分支失败:', err);
        }
      }

      // 注册项目到 ProjectRegistry
      await registerProjectToRegistry(projectMetadata.rootPath);

      safeSend({
        type: 'project:info',
        data: {
          type: projectMetadata.type,
          hasGit: projectMetadata.hasGit,
          rootPath: projectMetadata.rootPath,
          configFiles: projectMetadata.configFiles,
          gitBranch,
        },
      });

      console.log('[agent-bridge] 切换到项目:', projectMetadata.type, projectMetadata.rootPath, gitBranch ? `(${gitBranch})` : '');
    }
  } catch (err) {
    console.warn('[agent-bridge] 从当前目录检测项目失败:', err);
  }
}

/**
 * 注册项目到 ProjectRegistry（内部工具函数）
 */
async function registerProjectToRegistry(rootPath: string) {
  if (!currentUserId) return;
  try {
    const { ProjectRegistry } = await import('../../src/core/project/ProjectRegistry.js');
    const registry = new ProjectRegistry(currentUserId);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const hasXuanjiMd = fs.existsSync(path.join(rootPath, 'XUANJI.md'));
    const hasRulesMd = fs.existsSync(path.join(rootPath, '.xuanji', 'rules.md'));
    await registry.register(rootPath, hasXuanjiMd || hasRulesMd);
  } catch (err) {
    console.warn('[agent-bridge] 注册项目到 ProjectRegistry 失败:', err);
  }
}

/**
 * 从工具调用中提取文件路径，自动检测项目
 */
async function detectProjectFromToolCall(toolName: string, input: Record<string, unknown>) {
  // 只处理文件相关工具
  const fileTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
  if (!fileTools.includes(toolName)) return;

  // 提取文件路径
  let filePath: string | null = null;
  if (input.file_path && typeof input.file_path === 'string') {
    filePath = input.file_path;
  } else if (input.path && typeof input.path === 'string') {
    filePath = input.path;
  }

  if (!filePath) return;

  // 如果不是绝对路径，跳过
  const path = await import('node:path');
  if (!path.isAbsolute(filePath)) return;

  try {
    const { ProjectScanner } = await import('../../src/context/ProjectScanner.js');
    const scanner = new ProjectScanner();

    // 从文件路径的目录开始扫描
    const fs = await import('node:fs');
    const stats = await fs.promises.stat(filePath).catch(() => null);
    const startDir = stats?.isDirectory() ? filePath : path.dirname(filePath);

    const projectMetadata = scanner.scan(startDir);

    // 如果检测到项目，且与当前项目不同，更新项目信息
    if ((projectMetadata.type !== 'unknown' || projectMetadata.hasGit) &&
        projectMetadata.rootPath !== currentProjectRoot) {
      currentProjectRoot = projectMetadata.rootPath;

      // 注册项目到 ProjectRegistry
      await registerProjectToRegistry(projectMetadata.rootPath);

      // 获取 git 分支信息
      let gitBranch: string | null = null;
      if (projectMetadata.hasGit) {
        try {
          const { execSync } = await import('node:child_process');
          gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectMetadata.rootPath,
            encoding: 'utf-8',
          }).trim();
        } catch (err) {
          console.warn('[agent-bridge] 获取 git 分支失败:', err);
        }
      }

      safeSend({
        type: 'project:info',
        data: {
          type: projectMetadata.type,
          hasGit: projectMetadata.hasGit,
          rootPath: projectMetadata.rootPath,
          configFiles: projectMetadata.configFiles,
          gitBranch,
        },
      });

      console.log('[agent-bridge] 检测到新项目:', projectMetadata.type, projectMetadata.rootPath, gitBranch ? `(${gitBranch})` : '');
    }
  } catch (err) {
    console.warn('[agent-bridge] 项目检测失败:', err);
  }
}

