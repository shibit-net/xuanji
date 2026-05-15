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
import type { UserConfirmation } from '../../src/permission/types.js';
import { getTodoManager } from '../../src/core/tools/TodoManager.js';
import { ChildMessageChannel } from './ipc/MessageBus.js';
import { DownloadManager } from '../../src/core/download/DownloadManager.js';
import { eventBus } from '../../src/core/events/EventBus.js';
import { XuanjiEvent } from '../../src/core/events/events.js';
import { EventForwarder } from '../../src/core/event/EventForwarder.js';
import { IntentRouter } from '../../src/core/routing/IntentRouter.js';
import { SceneClassifier } from '../../src/core/routing/SceneClassifier.js';
import { EmbeddingMatcher } from '../../src/core/routing/EmbeddingMatcher.js';
import { EmbeddingProvider } from '../../src/core/embedding/EmbeddingProvider.js';
import { logger } from '../../src/core/logger/index.js';
import * as path from 'node:path';

let session: ChatSession | null = null;
let currentUserId: string | null = null;

// 意图路由结果：当前使用的 agentId（默认 xuanji）
let routedAgentId = 'xuanji';

// IntentRouter 单例（session 创建后初始化）
let intentRouter: IntentRouter | null = null;

// 防止重复注册 EventBus 监听器导致文本重复发送
let hookEventBridgeRegistered = false;

// Phase 2 EventForwarder 实例（USE_EVENT_FORWARDER=true 时创建）
let eventForwarder: EventForwarder | null = null;

// 🔧 创建子进程消息通道
// 注意：这里仍使用 ChildMessageChannel，因为它是子进程端的通道
// 主进程端会使用 EnhancedMessageChannel 来接收和转发消息
const channel = new ChildMessageChannel({
  name: 'agent-child',
  enableLogging: false,
});

const log = logger.child({ module: 'agent-bridge' });

// 子进程启动完成，通知主进程
channel.send('child-ready', { pid: process.pid });

// ============================================================
// 下载事件转发
// ============================================================
const downloadManager = DownloadManager.getInstance();

// 转发 DownloadManager 事件到主进程
const forwardDownloadEvent = (eventName: string) => {
  downloadManager.on(eventName, (task) => {
    // 子进程任务统一加 child: 前缀，避免与主进程任务 ID 冲突
    const prefixedTask = { ...task, id: `child:${task.id}` };
    channel.send('download:event', { type: eventName, task: prefixedTask });
  });
};

forwardDownloadEvent('task-created');
forwardDownloadEvent('task-started');
forwardDownloadEvent('task-progress');
forwardDownloadEvent('task-completed');
forwardDownloadEvent('task-failed');
forwardDownloadEvent('task-cancelled');

// ============================================================
// 排队消息 IPC 桥接 — ChatSession 通过 EventBus 发出队列事件，
// agent-bridge 转发为 IPC 供渲染进程更新 queuedMessageCount
// ============================================================
eventBus.on('queue:message-queued', () => {
  channel.send('agent:message-queued');
});
eventBus.on('queue:consumed', () => {
  channel.send('agent:queue-consumed');
});

// ============================================================
// 内存监控 — 每 5 分钟记录堆使用量，超过 1GB 触发告警
// ============================================================
const MEMORY_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const HEAP_WARN_THRESHOLD = 512 * 1024 * 1024; // 512MB

setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  log.debug(`Memory: heap=${heapMB}MB rss=${rssMB}MB`);

  if (mem.heapUsed > HEAP_WARN_THRESHOLD) {
    log.warn(`High heap usage: ${heapMB}MB — triggering GC`);
    if (global.gc) {
      global.gc();
    }
  }
}, MEMORY_CHECK_INTERVAL_MS);

// ============================================================
// 待处理请求缓存（Permission / PlanReview / AskUser）
// ============================================================

const pendingPermissions = new Map<string, (result: any) => void>();
const pendingPlanReviews = new Map<string, (result: any) => void>();
const pendingAskUsers = new Map<string, (result: any) => void>();

// ============================================================
// 处理器函数实现
// ============================================================

/**
 * 初始化 ChatSession
 */

/** 更新 MatchAgentTool 的 embedding provider，模型不存在时触发下载 */
function updateMatchAgentEmbedding(sess: ChatSession): void {
  try {
    // 始终尝试创建 EmbeddingProvider（使用默认模型），不依赖 globalConfig.embedding
    const candidate = new EmbeddingProvider();
    if (candidate.modelExists()) {
      const registry = sess.getBaseRegistry();
      const matchAgentTool = registry.get('match_agent');
      if (matchAgentTool && 'setDependencies' in matchAgentTool) {
        (matchAgentTool as any).setDependencies({
          agentRegistry: sess.getAgentRegistry(),
          embeddingProvider: candidate,
        });
        log.info('updateMatchAgentEmbedding: EmbeddingProvider injected into MatchAgentTool');
      }
    } else {
      const globalConfig = sess.getConfig();
      log.info('updateMatchAgentEmbedding: model not found, triggering download');
      triggerEmbeddingModelDownload(globalConfig);
    }
  } catch (err) {
    log.warn('updateMatchAgentEmbedding failed:', err);
  }
}

/** 触发 embedding 模型自动下载：检查缺失文件，通过下载中心下载，下次 rebuild 自动启用 */
function triggerEmbeddingModelDownload(globalConfig: any): void {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const embeddingConfig = globalConfig?.embedding;
    // 使用配置中的 modelId，若未配置则使用默认模型
    const modelId = embeddingConfig?.model || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    const hfMirror = embeddingConfig?.hfMirror || 'https://hf-mirror.com';
    const modelDir = path.join(os.homedir(), '.xuanji', 'embedding-models', modelId);

    const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];
    const baseUrl = `${hfMirror}/${modelId}/resolve/main`;

    let downloadCount = 0;
    for (const file of files) {
      const dest = path.join(modelDir, file);
      if (!fs.existsSync(dest)) {
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        downloadManager.download({
          url: `${baseUrl}/${file}`,
          dest,
          name: `Embedding: ${modelId}/${file}`,
          category: 'model',
        });
        downloadCount++;
      }
    }
    if (downloadCount > 0) {
      log.info(`triggerEmbeddingModelDownload: ${downloadCount} files queued for ${modelId}`);
    }
  } catch (err) {
    log.warn('triggerEmbeddingModelDownload failed:', err);
  }
}

/** 重建 IntentRouter（热重载：agent 配置变更后调用，不影响已在执行的任务） */
async function rebuildIntentRouter(): Promise<void> {
  if (!session) return;
  try {
    const agentRegistry = session.getAgentRegistry();
    const globalConfig = session.getConfig();
    const sceneClassifier = new SceneClassifier({ agentRegistry, globalConfig });

    const promptBuilder = session.getLayeredPromptBuilder();
    if (promptBuilder) {
      const availableScenes = promptBuilder.getAvailableScenes();
      sceneClassifier.setSceneList(
        availableScenes.map((s) => ({
          scene: s,
          description: promptBuilder.getSceneDescription(s),
          keywords: promptBuilder.getSceneKeywords(s),
        })),
      );
    }

    await sceneClassifier.initialize();

    // 创建 EmbeddingProvider：模型文件存在时启用向量匹配，不存在时触发下载并降级
    let embedder: EmbeddingProvider | null = null;
    try {
      const candidate = new EmbeddingProvider();
      if (candidate.modelExists()) {
        embedder = candidate;
        log.info('rebuildIntentRouter: EmbeddingProvider created (model found)');
      } else {
        log.info('rebuildIntentRouter: Embedding model not downloaded, triggering download and falling back');
        // 触发下载：模型缺失文件通过下载中心下载，下次 rebuild 时自动启用
        triggerEmbeddingModelDownload(globalConfig);
      }
    } catch (err) {
      log.warn('rebuildIntentRouter: Failed to create EmbeddingProvider:', err);
    }

    const embeddingMatcher = new EmbeddingMatcher(agentRegistry, embedder);

    // 将场景列表注入 EmbeddingMatcher，用于向量场景匹配
    if (promptBuilder) {
      const sceneList = promptBuilder.getAvailableScenes().map((s) => ({
        scene: s,
        description: promptBuilder.getSceneDescription(s),
        keywords: promptBuilder.getSceneKeywords(s),
      }));
      embeddingMatcher.setSceneList(sceneList);
    }

    intentRouter = new IntentRouter({ sceneClassifier, embeddingMatcher, agentRegistry });
    log.info('rebuildIntentRouter: IntentRouter rebuilt successfully');

    // 同步更新 MatchAgentTool 的 embedding provider
    updateMatchAgentEmbedding(session);

    // 将场景列表发送到渲染进程，供意图分析面板展示
    if (promptBuilder) {
      const scenePromptList = promptBuilder.getAvailableScenes().map((s) => ({
        scene: s,
        description: promptBuilder.getSceneDescription(s),
        keywords: promptBuilder.getSceneKeywords(s),
      }));
      channel.send('agent:scene-list', { scenes: scenePromptList });
    }
  } catch (err) {
    log.warn('rebuildIntentRouter: IntentRouter rebuild failed:', err);
  }
}

async function handleInit(userId?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const uid = userId || currentUserId || 'default';
    log.info(`handleInit: creating session for userId=${uid}`);

    // 在创建 session 之前，先切换到配置的 workspace 目录
    // 确保 FilteredToolRegistry.workingDir 指向 workspace 而非项目根目录
    try {
      const configLoader = new (await import('@/core/config/ConfigLoader')).ConfigLoader(uid, 'xuanji');
      const config = await configLoader.load();
      const os = await import('node:os');
      const path = await import('node:path');
      const fs = await import('node:fs');
      const workspacePath = config.workspacePath || path.join(os.homedir(), '.xuanji', 'workspace');
      if (!fs.existsSync(workspacePath)) {
        fs.mkdirSync(workspacePath, { recursive: true });
      }
      process.chdir(workspacePath);
      log.info(`handleInit: chdir to workspace: ${workspacePath}`);
    } catch (e) {
      log.warn('handleInit: failed to chdir to workspace, using process.cwd()', e);
    }

    const factory = new SessionFactory(uid);
    const newSession = await factory.create({
      callbacks: {
        onAutoSummarize: (subAgentId?: string, groupId?: string) => {
          channel.send('agent:auto-summarize-start', { subAgentId, groupId });
        },
        onCitationData: (citations: Array<{ agentName: string; originalOutput: string; duration: number; tokensUsed: { input: number; output: number } }>) => {
          channel.send('agent:citation-data', citations);
        },
      },
      onMissingEmbedding: () => {
        // MatchAgentTool 发现向量模型不可用时触发下载
        const cfg = newSession.getConfig();
        triggerEmbeddingModelDownload(cfg);
      },
    });
    session = newSession;
    currentUserId = uid;
    log.info('handleInit: session created successfully');

    // 注册工具执行钩子 — 自动检测文件操作涉及的项目并注册到 ProjectRegistry
    try {
      const agentLoop = session.getAgentLoop();
      const toolRegistry = agentLoop?.getToolRegistry();
      if (toolRegistry && 'setOnBeforeExecute' in toolRegistry) {
        (toolRegistry as any).setOnBeforeExecute((name: string, input: Record<string, unknown>) => {
          detectProjectFromToolCall(name, input);
        });
      }
    } catch (e) {
      log.warn('Failed to set tool execute hook:', e);
    }

    // 初始化 MatchAgentTool 的 embedding provider
    updateMatchAgentEmbedding(newSession);

    // 初始化 IntentRouter（hot-reload: rebuildIntentRouter 复用）
    await rebuildIntentRouter();

    // 注册权限确认处理器 — 将子进程的权限请求桥接到渲染进程 UI
    session.setConfirmationHandler(async (request, guardResult) => {
      const id = `${request.toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<UserConfirmation>((resolve) => {
        pendingPermissions.set(id, resolve);
        channel.send('permission:request', {
          id,
          tool: request.toolName,
          toolName: request.toolName,
          args: request.input,
          input: request.input,
          risk: guardResult.riskLevel,
          riskLevel: guardResult.riskLevel,
          reason: guardResult.description,
          description: guardResult.description,
          suggestion: guardResult.context?.suggestion,
          cacheKey: guardResult.cacheKey,
        });
      });
    });

    // 注册持久化事件桥接（Feature flag 共存）
    if (process.env.USE_EVENT_FORWARDER === 'true') {
      if (!eventForwarder) {
        eventForwarder = new EventForwarder(
          (eventType: string, data: any) => channel.send(eventType, data),
        );
      }
      eventForwarder.register();
      // 将 AsyncTaskStateMachine 注入 EventForwarder，使其能发出 agent:async-task-update IPC 事件
      const orchestrator = session!.getTaskOrchestrator();
      eventForwarder.setAsyncTaskStateMachine(orchestrator.getAsyncTaskStateMachine());
      log.info('handleInit: EventForwarder registered (new path)');
    } else {
      registerHookEventBridge();
    }

    // 初始化 workspace：注册到 ProjectRegistry + 生成 XUANJI.md + 发送 project:info
    await initWorkspace();

    // 发送 init-complete 通知
    channel.send('init-complete', { success: true });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('handleInit failed:', msg);
    return { success: false, error: msg };
  }
}


/**
 * 统一用户操作入口（Phase 2 新路径）。
 * 前端发送 { type: 'SEND_MESSAGE' | 'INTERRUPT', message?: string }，
 * 调用 session.userAction() 由 SessionStateMachine 驱动，替代旧 handler 分发。
 */
async function handleUserAction(data: { type: string; message?: string }): Promise<void> {
  if (!session) {
    log.warn('handleUserAction: session is null');
    return;
  }
  try {
    if (data.type === 'SEND_MESSAGE' && data.message) {
      const features = session.getConfig()?.features;
      const intentEnabled = features?.enableIntentAnalysis !== false; // 默认 true
      if (intentRouter && intentEnabled) {
        channel.send('agent:intent-route:start');
        const route = await intentRouter.route(data.message, (progress) => {
          channel.send('agent:intent-route:progress', progress);
        });
        routedAgentId = route.agentId;
        await session.switchForegroundAgent(route.agentId, route.scene, route.complexity);
        const agentConfig = session.getAgentRegistry()?.get(route.agentId);
        // 先发送路由结果（展示面板），再发送前台切换（React Flow 节点）
        channel.send('agent:intent-route', {
          agentId: route.agentId,
          confidence: route.confidence,
          method: route.method,
          scene: route.scene,
          complexity: route.complexity,
          reason: route.reason,
          modelName: route.modelName,
        });
        channel.send('agent:switch-foreground', { agentId: route.agentId, name: route.agentId, agentType: agentConfig?.category || undefined });
      } else {
        // 意图分析关闭或未初始化 → 直接使用 xuanji
        routedAgentId = 'xuanji';
        channel.send('agent:intent-route:start');
        await session.switchForegroundAgent('xuanji', undefined, 'complex');
        channel.send('agent:intent-route', { agentId: 'xuanji', confidence: 1.0, method: 'default', scene: '', complexity: 'complex' });
        channel.send('agent:switch-foreground', { agentId: 'xuanji', name: 'xuanji', agentType: 'system' });
      }
    }
    log.info('[DIAG] handleUserAction: calling session.userAction, type=' + data.type + ' message=' + (data.message || '').substring(0, 40));
    await session.userAction(data);
    log.info('[DIAG] handleUserAction: session.userAction returned');
  } catch (err) {
    log.error('handleUserAction failed:', err);
  }
}


/**
 * 重置会话
 */
function handleReset(): { success: boolean; error?: string } {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    session.reset();
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取会话状态
 */
function handleGetState(): { success: boolean; state?: any; error?: string } {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const state = session.getState();
    return { success: true, state };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取配置
 */
function handleGetConfig(): { success: boolean; config?: any; error?: string } {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const config = session.getConfig();
    return { success: true, config };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取完整配置
 */
function handleGetFullConfig(): { success: boolean; config?: any; error?: string } {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const config = session.getConfig();
    return { success: true, config };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 更新配置（支持动态重载 + 持久化到磁盘）
 *
 * 前端发送格式: { section: 'ui' | 'tools' | 'provider' | 'workspace' | 'embedding', sectionData: {...} }
 */
async function handleUpdateConfig(data: any): Promise<{ success: boolean; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const { updateRuntimeConfig, getRuntimeConfig } = await import('../../src/core/config/RuntimeConfig.js');

    if (data?.section && data?.sectionData) {
      const partial: Record<string, unknown> = {};

      switch (data.section) {
        case 'ui':
          partial.ui = data.sectionData;
          // workspacePath 通过 ui section 传递时，提升到顶层
          if (data.sectionData.workspacePath !== undefined) {
            partial.workspacePath = data.sectionData.workspacePath;
          }
          break;
        case 'tools':
          partial.tools = data.sectionData;
          break;
        case 'provider':
          partial.provider = data.sectionData;
          break;
        case 'workspace':
          partial.workspacePath = data.sectionData.workspacePath;
          break;
        case 'embedding':
          partial.embedding = data.sectionData;
          break;
        case 'features':
          partial.features = data.sectionData;
          break;
      }

      if (Object.keys(partial).length > 0) {
        updateRuntimeConfig(partial as any);
        // 同步 DI 容器中的 config 引用（updateRuntimeConfig 创建了新对象，容器保留旧引用）
        const updated = getRuntimeConfig();
        if (updated) {
          session.getContainer().unregister('config');
          session.getContainer().registerSingleton('config', updated);
        }
        log.info(`Config updated: section=${data.section}`);
      }
    }

    // 持久化到 config.json，确保重启后配置不丢失
    if (currentUserId) {
      try {
        const { getUserConfigPath } = await import('../../src/core/config/PathManager.js');
        const configPath = getUserConfigPath(currentUserId);
        const currentConfig = session.getConfig();
        const fs = await import('node:fs/promises');
        await fs.writeFile(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
        log.info(`Config persisted to ${configPath}`);
      } catch (persistErr) {
        log.warn('Failed to persist config:', persistErr);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 保存会话快照
 */
async function handleSessionSave(data: { name?: string; options?: any }): Promise<{ success: boolean; sessionId?: string; error?: string }> {
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

/**
 * 恢复会话
 */
async function handleSessionResume(data: { sessionId: string }): Promise<{ success: boolean; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    await session.resumeSession(data?.sessionId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取会话列表
 */
async function handleSessionList(): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
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

/**
 * 删除会话
 */
async function handleSessionDelete(data: { sessionId: string }): Promise<{ success: boolean; error?: string }> {
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

/**
 * 创建检查点
 */
async function handleCheckpointCreate(data: { label?: string }): Promise<{ success: boolean; checkpointId?: string; error?: string }> {
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

/**
 * 获取检查点列表
 */
async function handleCheckpointList(): Promise<{ success: boolean; checkpoints?: any[]; error?: string }> {
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

/**
 * 回滚到指定检查点
 */
async function handleCheckpointRewind(data: { checkpointId: string }): Promise<{ success: boolean; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    await session.rewindToCheckpoint(data?.checkpointId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取用量统计
 */
async function handleGetUsageStats(): Promise<{ success: boolean; stats?: any; error?: string }> {
  if (!session) {
    return { success: true, stats: { totalTokens: 0, totalCost: 0, totalRuns: 0 } };
  }
  try {
    // 尝试从 AgentLoop 获取 token 使用统计
    const agentLoop = session.getAgentLoop();
    const stats = (agentLoop as any).getUsageStats?.() || { totalTokens: 0, totalCost: 0, totalRuns: 0 };
    return { success: true, stats };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取 Agent 列表
 */
async function handleAgentList(): Promise<{ success: boolean; agents?: any[]; error?: string }> {
  if (!session) {
    return { success: true, agents: [] };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    const agents = agentRegistry.getAll();
    return { success: true, agents };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取单个 Agent 详情
 */
async function handleAgentGet(data: { agentId: string }): Promise<{ success: boolean; agent?: any; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    const agent = agentRegistry.get(data?.agentId);
    if (!agent) {
      return { success: false, error: 'Agent 不存在' };
    }
    return { success: true, agent };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 创建 Agent
 */
async function handleAgentCreate(data: { config: any }): Promise<{ success: boolean; agent?: any; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    const configManager = (agentRegistry as any).configManager;
    if (configManager?.createAgent) {
      const agent = await configManager.createAgent(data?.config);
      agentRegistry.register(agent);
      return { success: true, agent };
    }
    // 回退：直接 register（仅内存）
    agentRegistry.register(data?.config);
    return { success: true, agent: data?.config };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 更新 Agent 配置（保存到磁盘 + 动态热重载 provider）
 */
async function handleAgentUpdate(data: { agentId: string; config: any }): Promise<{ success: boolean; agent?: any; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    const configManager = (agentRegistry as any).configManager;
    if (!configManager?.updateAgent) {
      return { success: false, error: 'AgentConfigManager 不支持 update' };
    }

    const existing = agentRegistry.get(data?.agentId);
    if (!existing) {
      return { success: false, error: 'Agent 不存在' };
    }

    const agentId = existing.id;
    const updated = await configManager.updateAgent(existing, data?.config || {});

    // 更新内存中的 AgentRegistry 缓存（让 agentRegistry.get() 返回新的合并结果）
    agentRegistry.register(updated);

    // 热重载：仅在更新当前前台 agent 时 reload AppConfig / RuntimeConfig / provider
    // 系统 agent（如 scene-classifier）只需重建 IntentRouter，不应替换主 agent 的 provider
    if (currentUserId && agentId === session.currentAgentId) {
      try {
        const { ConfigLoader } = await import('../../src/core/config/ConfigLoader.js');
        const { setRuntimeConfig } = await import('../../src/core/config/RuntimeConfig.js');
        const { ProviderManager } = await import('../../src/core/providers/ProviderManager.js');

        const configLoader = new ConfigLoader(currentUserId, agentId);
        const newConfig = await configLoader.load();

        // 更新 DI 容器中的 config 单例（先 unregister 避免重复注册报错）
        const container = session.getContainer();
        container.unregister('config');
        container.registerSingleton('config', newConfig);
        // 同步更新全局 RuntimeConfig
        setRuntimeConfig(newConfig);

        // 用新配置重建 provider，注入 AgentLoop
        const providerManager = new ProviderManager(newConfig);
        const agentConfigWithOverride = agentRegistry.get(agentId);
        const newProvider = providerManager.getProvider(agentConfigWithOverride);
        session.getAgentLoop().updateProvider(newProvider);

        log.info(`Agent ${agentId} config updated and provider reloaded: model=${newConfig.provider.model}`);
      } catch (reloadErr) {
        // 热重载失败不阻塞 agent 配置保存结果的返回
        log.warn('Provider hot-reload failed after agent update:', reloadErr);
      }
    } else if (currentUserId && agentId !== session.currentAgentId) {
      log.info(`Agent ${agentId} is not the current foreground agent (${session.currentAgentId}), skipping provider reload`);
    }

    // 热重载 IntentRouter：agent 配置变更后重新创建 SceneClassifier + EmbeddingMatcher
    // 不影响已在执行的任务，仅影响下次 route() 调用
    await rebuildIntentRouter();

    return { success: true, agent: updated };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 删除 Agent
 */
async function handleAgentDelete(data: { agentId: string }): Promise<{ success: boolean; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentRegistry = session.getAgentRegistry();
    await agentRegistry.deleteFile(data?.agentId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取工具列表
 */
function handleToolsList(): { success: boolean; tools?: any[]; error?: string } {
  if (!session) {
    return { success: true, tools: [] };
  }
  try {
    const baseRegistry = session.getBaseRegistry();
    const schemas = baseRegistry.getSchemas();
    return { success: true, tools: schemas };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 压缩会话上下文
 */
async function handleCompact(data?: any): Promise<{ success: boolean; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const agentLoop = session.getAgentLoop();
    if (typeof (agentLoop as any).compact === 'function') {
      await (agentLoop as any).compact(data);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取诊断信息
 */
async function handleGetDiagnostics(): Promise<{ success: boolean; diagnostics?: any; error?: string }> {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const diagnostics = await session.getDiagnostics();
    return { success: true, diagnostics };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// 注册消息处理器
// ============================================================

// 初始化 Session
channel.handle('init', async (data) => {
  log.info('init called with userId:', data?.userId);
  const result = await handleInit(data?.userId);
  log.info('init completed:', JSON.stringify(result));
  return result;
});


// 统一用户操作（Phase 2 新路径，替代 send-message + interrupt 分发）
channel.handle('user-action', async (data) => {
  await handleUserAction(data);
  return { success: true };
});

// 意图分析（独立调用，不执行 agent）
channel.handle('analyze-intent', async (prompt) => {
  if (!intentRouter) {
    return { success: false, error: 'IntentRouter 未初始化' };
  }
  try {
    const route = await intentRouter.route(prompt);
    return { success: true, route };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
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
channel.handle('prompt-delete-component', (data) => handlePromptDeleteComponent(data));
channel.handle('prompt-create-component', (data) => handlePromptCreateComponent(data));

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
/**
 * 注册 Hook 事件监听器 — 通过 EventBus 统一接收 HookRegistry 转发
 */
function registerHookEventBridge() {
  // 防止重复注册：多次 init 会导致同一事件有多个监听器，
  // 每个监听器都向渲染进程发送消息，造成字符级重复（如"辩辩辩"）
  if (hookEventBridgeRegistered) return;
  hookEventBridgeRegistered = true;

  // ── 每个 hook 类型订阅独立 EventBus 事件，直接访问类型化 payload ──

  // SubAgent
  eventBus.on(XuanjiEvent.HOOK_SUBAGENT_START, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:subagent-start', data: {
      subAgentId: ctx.subAgentId,
      name: d.name, role: d.role, task: d.task, agentType: d.agentType,
      parentId: d.parentId || d.parentAgentId, scene: d.scene, streamToUser: d.streamToUser,
      executionMode: d.executionMode,
      isAsync: d.isAsync ?? false,
    }});
  });
  eventBus.on(XuanjiEvent.HOOK_SUBAGENT_TEXT, (ctx) => {
    safeSend({ type: 'agent:subagent-text', data: { agentId: ctx.subAgentId, text: ctx.text } });
  });
  eventBus.on(XuanjiEvent.HOOK_SUBAGENT_END, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:subagent-end', data: { subAgentId: ctx.subAgentId, success: d.success, duration: d.duration, timedOut: d.timedOut } });
  });

  // Team
  eventBus.on(XuanjiEvent.HOOK_TEAM_START, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:team-start', data: { teamId: ctx.teamId, name: d.name, goal: d.goal, strategy: d.strategy, memberCount: d.memberCount, maxRounds: d.maxRounds, members: d.members } });
  });
  eventBus.on(XuanjiEvent.HOOK_TEAM_MEMBER_START, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:team-member-start', data: {
      teamId: ctx.teamId, memberId: d.memberId, subAgentId: d.subAgentId,
      name: d.name, role: d.role, task: d.task, agentType: d.agentType,
      strategy: d.strategy, teamName: d.teamName,
      stepIndex: d.stepIndex, totalSteps: d.totalSteps,
      currentRound: d.currentRound, maxRounds: d.maxRounds, systemPromptHint: d.systemPromptHint,
      debateRole: d.debateRole, scene: d.scene, executionMode: (d as any).executionMode,
    }});
  });
  eventBus.on(XuanjiEvent.HOOK_TEAM_MEMBER_END, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:team-member-end', data: { teamId: ctx.teamId, memberId: d.memberId, subAgentId: d.subAgentId, success: d.success, duration: d.duration, resultSummary: d.resultSummary, teamName: d.teamName, failureReason: d.failureReason, retryCount: d.retryCount } });
  });
  eventBus.on(XuanjiEvent.HOOK_TEAM_END, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:team-end', data: { teamId: ctx.teamId, name: d.name, success: d.success, duration: d.duration, error: d.error, timedOut: (d as any).timedOut, cancelled: (d as any).cancelled } });
  });

  // TeamSubMember（层级策略 leader 动态创建 worker）
  eventBus.on(XuanjiEvent.HOOK_TEAM_SUB_MEMBER_START, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:team-submember-start', data: {
      teamId: ctx.teamId, parentMemberId: ctx.parentMemberId,
      memberId: d.memberId, subAgentId: d.subAgentId,
      name: d.name, role: d.role, task: d.task, agentType: d.agentType,
      scene: d.scene, executionMode: d.executionMode,
      strategy: d.strategy, teamName: d.teamName,
      stepIndex: d.stepIndex, totalSteps: d.totalSteps,
      systemPromptHint: d.systemPromptHint,
    }});
  });
  eventBus.on(XuanjiEvent.HOOK_TEAM_SUB_MEMBER_END, (ctx) => {
    const d = ctx.data;
    safeSend({ type: 'agent:team-submember-end', data: {
      teamId: ctx.teamId, parentMemberId: ctx.parentMemberId,
      memberId: d.memberId, subAgentId: d.subAgentId,
      memberName: d.memberName, success: d.success,
      duration: d.duration, resultSummary: d.resultSummary,
    }});
  });

  // Skill
  eventBus.on(XuanjiEvent.HOOK_SKILL_START, (ctx) => {
    safeSend({ type: 'agent:skill-start', data: { name: ctx.name } });
  });
  eventBus.on(XuanjiEvent.HOOK_SKILL_END, (ctx) => {
    safeSend({ type: 'agent:skill-end', data: { name: ctx.name, success: ctx.success } });
  });

  // Memory
  eventBus.on(XuanjiEvent.HOOK_MEMORY_READ, (ctx) => {
    safeSend({ type: 'agent:memory-read', data: { query: ctx.query, results: ctx.results } });
  });
  eventBus.on(XuanjiEvent.HOOK_MEMORY_WRITE, (ctx) => {
    safeSend({ type: 'agent:memory-write', data: { content: ctx.content } });
  });

  // Compress
  eventBus.on(XuanjiEvent.HOOK_COMPACT_PRE, () => {
    safeSend({ type: 'agent:compress-start', data: {} });
  });
  eventBus.on(XuanjiEvent.HOOK_COMPACT_POST, (ctx) => {
    safeSend({ type: 'agent:compress-end', data: { original: ctx.originalTokens, compressed: ctx.compressedTokens, ratio: ctx.compressionRatio } });
  });

  // Workspace 流程事件
  eventBus.on(XuanjiEvent.HOOK_MODEL_CLASSIFIER_START, (ctx) => {
    safeSend({ type: 'workspace:model-classifier-start', data: { userInput: ctx.userInput, model: ctx.model, sessionId: (ctx as any).sessionId, timestamp: (ctx as any).timestamp } });
  });
  eventBus.on(XuanjiEvent.HOOK_MODEL_CLASSIFIER_END, (ctx) => {
    safeSend({ type: 'workspace:model-classifier-end', data: { userInput: ctx.userInput, model: ctx.model, agent: ctx.agent, scene: ctx.scene, complexity: ctx.complexity, durationMs: ctx.durationMs, sessionId: (ctx as any).sessionId, timestamp: (ctx as any).timestamp } });
  });
  eventBus.on(XuanjiEvent.HOOK_INTENT_ANALYSIS_START, (ctx) => {
    safeSend({ type: 'workspace:intent-analysis-start', data: { userInput: ctx.userInput, sessionId: (ctx as any).sessionId, timestamp: (ctx as any).timestamp } });
  });
  eventBus.on(XuanjiEvent.HOOK_INTENT_ANALYSIS_END, (ctx) => {
    safeSend({ type: 'workspace:intent-analysis-end', data: { userInput: ctx.userInput, scene: ctx.scene, complexity: ctx.complexity, confidence: ctx.confidence, matchMethod: ctx.matchMethod, intentClassifier: ctx.intentClassifier, sessionId: (ctx as any).sessionId, timestamp: (ctx as any).timestamp } });
  });
  eventBus.on(XuanjiEvent.HOOK_TASK_PLANNING_START, (ctx) => {
    safeSend({ type: 'workspace:task-planning-start', data: { userInput: ctx.userInput, sessionId: (ctx as any).sessionId, scene: ctx.scene, complexity: ctx.complexity, timestamp: (ctx as any).timestamp } });
  });
  eventBus.on(XuanjiEvent.HOOK_TASK_PLANNING_END, (ctx) => {
    safeSend({ type: 'workspace:task-planning-end', data: { userInput: ctx.userInput, sessionId: (ctx as any).sessionId, strategy: ctx.strategy, tasks: ctx.tasks, timestamp: (ctx as any).timestamp } });
  });
  eventBus.on(XuanjiEvent.HOOK_TASK_EXECUTION_START, (ctx) => {
    safeSend({ type: 'workspace:task-execution-start', data: { userInput: ctx.userInput } });
  });
  eventBus.on(XuanjiEvent.HOOK_TASK_EXECUTION_END, (ctx) => {
    safeSend({ type: 'workspace:task-execution-end', data: { userInput: ctx.userInput, results: ctx.results, summary: ctx.summary } });
  });
  eventBus.on(XuanjiEvent.HOOK_RESULT_AGGREGATION_START, () => {
    safeSend({ type: 'workspace:result-aggregation-start', data: {} });
  });
  eventBus.on(XuanjiEvent.HOOK_RESULT_AGGREGATION_END, (ctx) => {
    safeSend({ type: 'workspace:result-aggregation-end', data: { results: ctx.results } });
  });

  // ── EventBus 原生事件转发 ──
  // 根 agent 的 AgentLoop._userId === currentUserId，映射到 routedAgentId
  // 子 agent 的 AgentLoop._userId 是其 subAgentId，保留原值

  // 异步任务失败（含取消）→ 渲染进程立即更新节点
  eventBus.on(XuanjiEvent.ASYNC_TASK_FAILED, (payload) => {
    safeSend({ type: 'agent:task-failed', data: {
      groupId: payload.groupId,
      subAgentId: payload.subAgentId,
      status: payload.status,
      error: payload.error,
    }});
  });
  // 异步任务完成 → 渲染进程更新状态栏
  eventBus.on(XuanjiEvent.ASYNC_TASK_COMPLETED, (payload) => {
    safeSend({ type: 'agent:task-completed', data: {
      groupId: payload.groupId,
      subAgentId: payload.subAgentId,
    }});
  });

  eventBus.on(XuanjiEvent.AGENT_STARTED, (payload) => {
    const agentId = payload.userId || routedAgentId;
    const isForeground = !payload.userId || payload.userId === currentUserId;
    log.info(`[DIAG] EventBus AGENT_STARTED: model=${payload.model} agentId=${agentId} isForeground=${isForeground}`);
    safeSend({ type: 'agent:started', data: { model: payload.model, agentId, isForeground } });
  });
  eventBus.on(XuanjiEvent.AGENT_TEXT_DELTA, (payload) => {
    const agentId = (payload.agentId && payload.agentId !== currentUserId) ? payload.agentId : routedAgentId;
    safeSend({ type: 'agent:text', data: { text: payload.text, agentId } });
  });
  eventBus.on(XuanjiEvent.AGENT_THINKING_DELTA, (payload) => {
    const agentId = (payload.agentId && payload.agentId !== currentUserId) ? payload.agentId : routedAgentId;
    safeSend({ type: 'agent:thinking', data: { content: payload.content, agentId } });
  });
  eventBus.on(XuanjiEvent.AGENT_TOOL_START, (payload) => {
    const agentId = (payload.agentId && payload.agentId !== currentUserId) ? payload.agentId : routedAgentId;
    safeSend({ type: 'agent:tool-start', data: { id: payload.id, name: payload.name, input: payload.input, agentId } });
  });
  eventBus.on(XuanjiEvent.AGENT_TOOL_END, (payload) => {
    const agentId = (payload.agentId && payload.agentId !== currentUserId) ? payload.agentId : routedAgentId;
    safeSend({ type: 'agent:tool-end', data: { id: payload.id, name: payload.name, result: payload.result, isError: payload.isError, agentId, metadata: payload.metadata } });
  });
  eventBus.on(XuanjiEvent.AGENT_ERROR, (payload) => {
    safeSend({ type: 'agent:error', data: payload.error });
  });
  eventBus.on(XuanjiEvent.CONVERSATION_STATE_CHANGED, (payload) => {
    safeSend({ type: 'agent:conversation-state', data: { from: payload.from, to: payload.to } });
  });
  eventBus.on(XuanjiEvent.AGENT_COMPLETED, (payload) => {
    const agentId = payload.userId || routedAgentId;
    safeSend({ type: 'agent:end', data: { tokenUsage: payload.tokenUsage, agentId } });
  });
  eventBus.on(XuanjiEvent.AGENT_FILE_CHANGES, (payload) => {
    safeSend({ type: 'agent:file-changes', data: { changes: payload.changes } });
  });
  eventBus.on(XuanjiEvent.AGENT_PROMPT_COMPONENTS, (payload) => {
    safeSend({ type: 'agent:prompt-components', data: payload });
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
          enabled: (c.layer === 'L0' || c.layer === 'L3') ? true : (c.enabled ?? true),
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

async function handlePromptUpdateComponent(data: { id: string; content?: string; keywords?: string; scenes?: string[] }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }
    await builder.updateComponent(data.id, { content: data.content, keywords: data.keywords, scenes: data.scenes });
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

async function handlePromptDeleteComponent(data: { id: string }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }
    await builder.deleteComponent(data.id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handlePromptCreateComponent(data: {
  id: string; name: string; layer: string; priority: number;
  estimatedTokens: number; scenes?: string[]; content: string;
  match?: { keywords: string; description: string };
  requiredTools?: string[]; thinking?: boolean;
  suitableFor?: string[]; requiredCapabilities?: string[];
  collaborationHint?: string;
}) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const builder = session.getLayeredPromptBuilder();
    if (!builder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }
    await builder.createComponent(data);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============ 项目管理 ============

/**
 * 获取所有项目列表
 */
async function handleProjectsList() {
  try {
    const userId = currentUserId;

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
  if (session) {
    await session.cleanup().catch((err) => {
      console.warn('[agent-bridge] Cleanup error:', err instanceof Error ? err.message : String(err));
    });
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (session) {
    await session.cleanup().catch((err) => {
      console.warn('[agent-bridge] Cleanup error:', err instanceof Error ? err.message : String(err));
    });
  }
  process.exit(0);
});

// ============================================================

/**
 * 捕获未处理的异常
 * 当代码中有未捕获的同步错误时触发
 */
process.on('uncaughtException', (err: Error) => {
  console.error('❌ Uncaught Exception:', err);

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
  console.error('❌ Unhandled Rejection at:', promise);
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
/** 记住 change_directory 切换的目标路径，用于 onToolEnd 时通知渲染进程 */
let pendingChangePath: string | null = null;

/**
 * 初始化默认 workspace 目录
 * 启动时将 currentProjectRoot 设置为用户配置的 workspace 路径
 * 如果未配置，默认使用 ~/.xuanji/workspace/
 */
async function initWorkspace() {
  try {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    // 从配置中读取 workspacePath，未设置则使用默认值
    let workspacePath = '';
    if (session) {
      const config = session.getConfig();
      workspacePath = config.workspacePath || '';
    }
    if (!workspacePath) {
      workspacePath = path.join(os.homedir(), '.xuanji', 'workspace');
    }

    // 确保 workspace 目录存在
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    // 确保 workspace 有 XUANJI.md（L3 项目上下文和 SystemPromptManager 依赖此文件）
    const xuanjiMdPath = path.join(workspacePath, 'XUANJI.md');
    if (!fs.existsSync(xuanjiMdPath)) {
      const workspaceName = path.basename(workspacePath);
      const timestamp = new Date().toISOString().split('T')[0];
      const content = `# ${workspaceName}

## 工作区信息

- **路径**: ${workspacePath}
- **创建时间**: ${timestamp}
- **用途**: xuanji 默认工作区

## 项目概述

> 此工作区用于 xuanji 的日常开发编辑工作。
> 当你操作其他项目的文件时，xuanji 会自动识别并在对应项目中创建项目文档。

## 工作记录

> xuanji 在此工作区中进行的所有操作记录
`;
      fs.writeFileSync(xuanjiMdPath, content, 'utf-8');
    }

    currentProjectRoot = workspacePath;

    // 切换到 workspace 目录，确保后续 ProjectScanner 等逻辑从 workspace 开始扫描
    try {
      process.chdir(workspacePath);
    } catch {}

    // 发送初始 workspace 信息到 renderer
    safeSend({
      type: 'project:info',
      data: {
        type: 'workspace',
        hasGit: false,
        rootPath: workspacePath,
        configFiles: [],
        gitBranch: null,
      },
    });

    // 注册 workspace 到 ProjectRegistry（hasRules=true 因为有 XUANJI.md）
    await registerProjectToRegistry(workspacePath);
  } catch (err) {
    console.warn('[agent-bridge] 初始化 workspace 失败:', err);
  }
}

/**
 * 从配置中获取工作目录路径
 * 不再从 process.cwd() 自动扫描项目，始终使用配置的 workspacePath
 */
async function detectProjectFromCwd() {
  try {
    const os = await import('node:os');
    const path = await import('node:path');

    // 从配置中读取 workspacePath
    let workspacePath = '';
    if (session) {
      const config = session.getConfig();
      workspacePath = config.workspacePath || '';
    }
    if (!workspacePath) {
      workspacePath = path.join(os.homedir(), '.xuanji', 'workspace');
    }

    if (workspacePath !== currentProjectRoot) {
      currentProjectRoot = workspacePath;

      // 获取 git 分支信息
      let gitBranch: string | null = null;
      const fs = await import('node:fs');
      const gitDir = path.join(workspacePath, '.git');
      if (fs.existsSync(gitDir)) {
        try {
          const { execSync } = await import('node:child_process');
          gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: workspacePath,
            encoding: 'utf-8',
          }).trim();
        } catch {}
      }

      await registerProjectToRegistry(workspacePath);

      safeSend({
        type: 'project:info',
        data: {
          type: 'workspace',
          hasGit: false,
          rootPath: workspacePath,
          configFiles: [],
          gitBranch,
        },
      });
    }
  } catch (err) {
    console.warn('[agent-bridge] 从配置读取工作目录失败:', err);
  }
}

/**
 * 注册项目到 ProjectRegistry（内部工具函数）
 * 如果项目没有 XUANJI.md，自动生成一份基础项目文档
 */
async function registerProjectToRegistry(rootPath: string) {
  if (!currentUserId) return;
  try {
    const { ProjectRegistry } = await import('../../src/core/project/ProjectRegistry.js');
    const registry = new ProjectRegistry(currentUserId);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const hasXuanjiMd = fs.existsSync(path.join(rootPath, 'XUANJI.md'));
    const hasRulesMd = fs.existsSync(path.join(rootPath, '.xuanji', 'rules.md'));
    const hasRules = hasXuanjiMd || hasRulesMd;

    await registry.register(rootPath, hasRules);

    // 自动生成项目文档（仅对非 workspace 目录的项目，且尚无文档时）
    const defaultWorkspace = path.join(os.homedir(), '.xuanji', 'workspace');
    if (!hasRules && rootPath !== defaultWorkspace) {
      await autoGenerateProjectDocs(rootPath);
    }
  } catch (err) {
    console.warn('[agent-bridge] 注册项目到 ProjectRegistry 失败:', err);
  }
}

/**
 * 为新检测到的项目自动生成基础 XUANJI.md
 * 包含项目元数据，后续 Agent 执行时会加载到 L3 系统提示中
 */
async function autoGenerateProjectDocs(rootPath: string) {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { ProjectScanner } = await import('../../src/context/ProjectScanner.js');

    const scanner = new ProjectScanner();
    const metadata = scanner.scan(rootPath);

    const projectName = path.basename(rootPath);
    const timestamp = new Date().toISOString().split('T')[0];

    let content = `# ${projectName}

## 项目信息

- **类型**: ${metadata.type}
- **路径**: ${rootPath}
- **首次分析时间**: ${timestamp}
- **Git 仓库**: ${metadata.hasGit ? '是' : '否'}
`;

    if (metadata.configFiles && metadata.configFiles.length > 0) {
      content += `- **配置文件**: ${metadata.configFiles.join(', ')}\n`;
    }

    content += `
## 项目概述

> 此文档由 xuanji 自动生成。Agent 在操作此项目时将根据实际代码结构持续更新。

## 目录结构

> 待 Agent 分析后填充

## 技术栈

> 待 Agent 分析后填充

## 关键约定

> 待 Agent 分析后填充
`;

    // 写入 XUANJI.md
    const xuanjiMdPath = path.join(rootPath, 'XUANJI.md');
    fs.writeFileSync(xuanjiMdPath, content, 'utf-8');

    // 更新 ProjectRegistry 中的 hasRules 标志
    if (currentUserId) {
      const { ProjectRegistry } = await import('../../src/core/project/ProjectRegistry.js');
      const registry = new ProjectRegistry(currentUserId);
      await registry.register(rootPath, true);
    }
  } catch (err) {
    console.warn('[agent-bridge] 自动生成项目文档失败:', err);
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
  const pathModule = await import('node:path');
  if (!pathModule.isAbsolute(filePath)) return;

  try {
    const { ProjectScanner } = await import('../../src/context/ProjectScanner.js');
    const scanner = new ProjectScanner();

    // 从文件路径的目录开始扫描
    const fs = await import('node:fs');
    const stats = await fs.promises.stat(filePath).catch(() => null);
    const startDir = stats?.isDirectory() ? filePath : pathModule.dirname(filePath);

    const projectMetadata = scanner.scan(startDir);

    // 检测到有效项目且不是当前 workspace，注册到 ProjectRegistry
    if (projectMetadata && projectMetadata.rootPath && projectMetadata.rootPath !== currentProjectRoot) {
      await registerProjectToRegistry(projectMetadata.rootPath);
    }
  } catch (err) {
    console.warn('[agent-bridge] 项目检测失败:', err);
  }
}

