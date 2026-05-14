/**
 * EventAdapter — 将 IPC 事件路由到 Phase 1 Zustand stores。
 *
 * 与 EventBridge 并行运行，写入不同的 stores：
 * - AgentStateMachine 替代 activeAgentStore + runtimeStore.agentActivity
 * - AsyncTaskStore 替代 backgroundTaskStore
 * - ConversationStore 合并 messageStore.status + _conversationState + runtimeStore.processing
 * - CitationStore 从 messageStore.citations 拆出
 * - messageStore 消息流桥接（流式文本、气泡生命周期）
 *
 * 通过 registerEventAdapter() 注册，带幂等性守卫。
 */

import { messageBus } from '../utils/MessageBus';
import { flowLogger } from '../utils/flow/flowLogger';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useAsyncTaskStore } from '../stores/AsyncTaskStore';
import { useConversationStore } from '../stores/ConversationStore';
import { useCitationStore } from '../stores/CitationStore';
import { useMessageStore, generateMessageId } from '../stores/messageStore';
import { useSessionInitStore } from '../stores/SessionInitStore';
import { useIntentRoutingStore, makeStage } from '../stores/IntentRoutingStore';

let registered = false;

export function registerEventAdapter(): void {
  if (registered) return;
  registered = true;

  function getDefaultAgentId(): string {
    return useAgentStateMachine.getState().foregroundAgentId || 'xuanji';
  }

  // 异步子 agent：其文本不应直接进入对话框，而应通过 TaskCompletionHandler 汇报
  const asyncSubAgentIds = new Set<string>();

  // 待清理的 task/team：等到主 agent 的 agent:end 才统一清除
  const pendingCleanupIds = new Set<string>();

  // ============================================================
  // IntentRoutingStore — 意图路由生命周期
  // ============================================================

  messageBus.on('agent:intent-route:start', () => {
    flowLogger.log('EventAdapter', 'RECV agent:intent-route:start');
    useIntentRoutingStore.getState().transition({ type: 'ROUTE_START' });
  });

  messageBus.on('agent:intent-route:progress', (data: {
    level: 'L1' | 'L2' | 'L3';
    status: 'start' | 'done';
    method: 'llm' | 'embedding' | 'default';
    durationMs: number;
    success: boolean;
    agentId?: string;
    scene?: string;
    complexity?: 'simple' | 'complex';
    confidence?: number;
    matchCount?: number;
    reason?: string;
    modelName?: string;
  }) => {
    if (data.status === 'start') {
      useIntentRoutingStore.getState().transition({
        type: 'ROUTE_STAGE',
        stage: makeStage({
          level: data.level,
          method: data.method,
          status: 'running',
          durationMs: 0,
          modelName: data.modelName,
        }),
      });
    } else {
      useIntentRoutingStore.getState().transition({
        type: 'ROUTE_STAGE',
        stage: makeStage({
          level: data.level,
          method: data.method,
          status: data.success ? 'success' : 'skipped',
          durationMs: data.durationMs,
          scene: data.scene,
          agentId: data.agentId,
          complexity: data.complexity,
          confidence: data.confidence,
          matchCount: data.matchCount,
          modelName: data.modelName,
        }),
      });
    }
  });

  // 暂存意图路由结果中的 scene，供后续 SET_FOREGROUND_AGENT 使用
  let pendingScene: string | undefined;
  let pendingComplexity: string | undefined;

  messageBus.on('agent:scene-list', (data: { scenes: Array<{ scene: string; description: string; keywords: string }> }) => {
    useIntentRoutingStore.getState().transition({ type: 'SET_SCENE_PROMPTS', scenes: data.scenes });
  });

  messageBus.on('agent:prompt-components', (data: { layers: Array<{ layer: number; components: Array<{ id: string; name: string }> }>; totalComponents: number; estimatedTokens: number }) => {
    useIntentRoutingStore.getState().transition({
      type: 'SET_PROMPT_COMPONENTS',
      layers: data.layers,
      totalComponents: data.totalComponents,
      estimatedTokens: data.estimatedTokens,
    });
  });

  messageBus.on('agent:intent-route', (data: {
    agentId: string; confidence: number; method: string; scene?: string;
    complexity?: string; reason?: string; modelName?: string;
  }) => {
    flowLogger.log('EventAdapter', 'RECV agent:intent-route', 'agentId:', data.agentId, 'method:', data.method, 'scene:', data.scene);
    pendingScene = data.scene;
    pendingComplexity = data.complexity;
    useConversationStore.getState().setRoutingInfo({
      agentId: data.agentId,
      confidence: data.confidence,
      method: data.method,
      scene: data.scene,
    });
    useIntentRoutingStore.getState().transition({
      type: 'ROUTE_COMPLETE',
      result: {
        agentId: data.agentId,
        confidence: data.confidence,
        method: data.method as 'llm' | 'embedding' | 'default',
        scene: data.scene,
        complexity: data.complexity,
        reason: data.reason,
        modelName: data.modelName,
      },
    });
  });

  // ============================================================
  // AgentStateMachine — 前台切换 + 排队通知
  // ============================================================

  messageBus.on('agent:switch-foreground', (data: { agentId: string; name: string; agentType?: string }) => {
    flowLogger.log('EventAdapter', 'RECV agent:switch-foreground', 'agentId:', data.agentId, 'name:', data.name, 'agentType:', data.agentType);
    useAgentStateMachine.getState().transition({
      type: 'SET_FOREGROUND_AGENT', agentId: data.agentId, name: data.name,
    });
    // 将意图路由结果中的 scene/complexity 和 agentType 写入 agent
    if (pendingScene || pendingComplexity || data.agentType) {
      const s = useAgentStateMachine.getState();
      const agent = s.agentMap[data.agentId];
      if (agent) {
        const patch: Partial<import('../stores/AgentStateMachine').AgentState> = {};
        if (pendingScene) patch.scene = pendingScene;
        if (data.agentType) patch.agentType = data.agentType;
        useAgentStateMachine.setState({
          agentMap: {
            ...s.agentMap,
            [data.agentId]: { ...agent, ...patch },
          },
        });
      }
      pendingScene = undefined;
      pendingComplexity = undefined;
    }
  });

  messageBus.on('agent:message-queued', () => {
    useAgentStateMachine.getState().transition({ type: 'QUEUED_MESSAGE' });
  });

  messageBus.on('agent:queue-consumed', () => {
    useAgentStateMachine.getState().transition({ type: 'CLEAR_QUEUED_MESSAGE' });
  });

  // ============================================================
  // ConversationStore
  // ============================================================

  messageBus.on('agent:started', (data?: any) => {
    flowLogger.log('EventAdapter', 'RECV agent:started', 'data:', data);
    useConversationStore.getState().onAgentStarted();
    // 不在此处 ROUTE_RESET — 意图分析结果持续展示到下一轮 ROUTE_START 自动清除
  });

  messageBus.on('agent:end', () => {
    flowLogger.log('EventAdapter', 'RECV agent:end — triggering cleanup');
    useConversationStore.getState().onAgentCompleted();
  });

  messageBus.on('agent:conversation-state', (data: { from: string; to: string }) => {
    const stateMap: Record<string, 'idle' | 'executing' | 'outputting' | 'waiting_async'> = {
      idle: 'idle', executing: 'executing', outputting: 'outputting', waiting_async: 'waiting_async',
    };
    useConversationStore.getState().setConversationState(stateMap[data.to] || 'idle');
  });

  messageBus.on('agent:skill-start', (data: { name?: string; skillName?: string }) => {
    const name = data.name || data.skillName;
    if (name) useConversationStore.getState().setActiveSkill({ name });
  });

  messageBus.on('agent:skill-end', () => {
    useConversationStore.getState().setActiveSkill(null);
  });

  messageBus.on('project:info', (data: { type: string; hasGit: boolean; rootPath: string; configFiles: string[]; gitBranch?: string }) => {
    const projectName = data.rootPath.split('/').pop() || data.rootPath;
    useConversationStore.getState().setContextInfo({
      workingDirectory: data.rootPath,
      projectInfo: { name: projectName, type: data.type, hasGit: data.hasGit, rootPath: data.rootPath, gitBranch: data.gitBranch },
    });
  });

  // ============================================================
  // AgentStateMachine — streaming + tool events
  // ============================================================

  messageBus.on('agent:started', (data: { model?: string; agentId?: string; isForeground?: boolean }) => {
    // 前台 agent：由 SET_FOREGROUND_AGENT 负责创建/维护，此处不重复创建
    if (data?.isForeground) return;
  });

  messageBus.on('agent:text', (data: string | { text: string; agentId?: string }) => {
    const text = typeof data === 'string' ? data : data.text;
    const agentId = typeof data === 'object' && data.agentId ? data.agentId : getDefaultAgentId();
    useAgentStateMachine.getState().transition({ type: 'TEXT_DELTA', agentId, text });
  });

  messageBus.on('agent:thinking', (data: string | { content: string; agentId?: string }) => {
    const content = typeof data === 'string' ? data : data.content;
    const agentId = typeof data === 'object' && data.agentId ? data.agentId : getDefaultAgentId();
    useAgentStateMachine.getState().transition({ type: 'THINKING_DELTA', agentId, content });
  });

  messageBus.on('agent:tool-start', (data: { id: string; name: string; input: any; agentId?: string }) => {
    const agentId = data.agentId || getDefaultAgentId();
    useAgentStateMachine.getState().transition({
      type: 'TOOL_START', agentId, toolId: data.id, toolName: data.name, toolInput: data.input || {},
    });
  });

  messageBus.on('agent:tool-end', (data: { id: string; name: string; result?: string; isError?: boolean; agentId?: string }) => {
    const agentId = data.agentId || getDefaultAgentId();
    useAgentStateMachine.getState().transition({
      type: 'TOOL_END', agentId, toolId: data.id, toolName: data.name, result: data.result, isError: data.isError,
    });
  });

  messageBus.on('agent:end', () => {
    flowLogger.log('EventAdapter', 'RECV agent:end (cleanup) — foreground:', useAgentStateMachine.getState().foregroundAgentId);
    const store = useAgentStateMachine.getState();
    // 客户端合成：前台完成后回 pending（后端不知道 foregroundAgentId）
    if (store.foregroundAgentId) {
      store.transition({ type: 'FOREGROUND_COMPLETE', agentId: store.foregroundAgentId });
    }
    store.transition({ type: 'CLEANUP_COMPLETED_TASKS' });
    // 清理 AsyncTaskStore 中待处理的 task/team
    for (const id of pendingCleanupIds) {
      useAsyncTaskStore.getState().transition({ type: 'TASK_CLEARED', taskId: id });
    }
    pendingCleanupIds.clear();
    store.transition({ type: 'CLEAR_QUEUED_MESSAGE' });
  });

  // ============================================================
  // AgentStateMachine + AsyncTaskStore — subagent events
  // ============================================================

  messageBus.on('agent:subagent-start', (data: { subAgentId: string; name: string; role?: string; task?: string; agentType?: string; parentId?: string; streamToUser?: boolean; scene?: string; executionMode?: 'acp' | 'in-process'; isAsync?: boolean }) => {
    flowLogger.log('EventAdapter', 'RECV agent:subagent-start', 'subAgentId:', data.subAgentId, 'name:', data.name, 'agentType:', data.agentType, 'parentId:', data.parentId, 'isAsync:', data.isAsync);
    if (data.isAsync) asyncSubAgentIds.add(data.subAgentId);
    const state = useAgentStateMachine.getState();
    // 如果后端 parentId 是 xuanji 或 main（占位符），替换为当前消息来源的前台 agent
    const parentId = (data.parentId && data.parentId !== 'xuanji' && data.parentId !== 'main')
      ? data.parentId
      : (state.lastMessageAgentId || state.foregroundAgentId || 'xuanji');
    state.transition({
      type: 'AGENT_CREATED',
      agentId: data.subAgentId,
      name: data.name,
      parentId: parentId,
      agentType: data.agentType || 'temporary',
      taskType: 'task',
      executionMode: data.executionMode || 'in-process',
      scene: data.scene,
      streamToUser: data.streamToUser,
    });

    // AsyncTaskStore — 仅当不是 team member 时创建 task
    const taskStore = useAsyncTaskStore.getState();
    const isTeamMember = Object.values(taskStore.tasks).some(
      (t) => t.taskType === 'team' && t.members.some((m) => m.id === data.subAgentId),
    );
    if (!isTeamMember) {
      taskStore.transition({
        type: 'TASK_CREATED', taskId: data.subAgentId, taskType: 'task',
        name: data.name, parentAgentId: parentId,
      });
      taskStore.transition({ type: 'TASK_STARTED', taskId: data.subAgentId });
    }
  });

  messageBus.on('agent:subagent-end', (data: { subAgentId: string; success: boolean }) => {
    const isAsync = asyncSubAgentIds.has(data.subAgentId);
    asyncSubAgentIds.delete(data.subAgentId);
    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END', agentId: data.subAgentId, success: data.success, isAsync,
    });

    const taskStore = useAsyncTaskStore.getState();
    if (taskStore.tasks[data.subAgentId]?.taskType === 'task') {
      taskStore.transition({ type: 'TASK_COMPLETED', taskId: data.subAgentId });
      // 同步 task 推迟到主 agent 的 agent:end 再清理
      if (!isAsync) {
        pendingCleanupIds.add(data.subAgentId);
      }
    }
  });

  messageBus.on('agent:task-failed', (data: { subAgentId?: string; groupId?: string; error?: string }) => {
    const agentId = data.subAgentId || data.groupId;
    if (!agentId) return;
    useAgentStateMachine.getState().transition({ type: 'TASK_FAILED', agentId, error: data.error });
    useAsyncTaskStore.getState().transition({ type: 'TASK_CANCELLED', taskId: agentId });
  });

  messageBus.on('agent:task-completed', (data: { subAgentId?: string; groupId?: string }) => {
    const taskId = data.subAgentId || data.groupId;
    if (!taskId) return;
    if (useAsyncTaskStore.getState().tasks[taskId]) {
      useAsyncTaskStore.getState().transition({ type: 'TASK_COMPLETED', taskId });
    }
  });

  // ============================================================
  // AgentStateMachine + AsyncTaskStore — team events
  // ============================================================

  messageBus.on('agent:team-start', (data: { teamId: string; name: string; goal?: string; strategy?: string; memberCount?: number; maxRounds?: number; members?: Array<{ id: string; name?: string; role?: string; agentType?: string; scene?: string; executionMode?: string; task?: string; stepIndex?: number; totalSteps?: number; debateRole?: string; subAgentId?: string }> }) => {
    const state = useAgentStateMachine.getState();
    const parentId = state.lastMessageAgentId || state.foregroundAgentId || undefined;
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: data.teamId,
      name: data.name,
      parentId,
      agentType: 'team',
      taskType: 'team',
      multiAgent: { type: 'agent_team', strategy: data.strategy, teamName: data.name, goal: data.goal, maxRounds: data.maxRounds },
    });

    // 预创建所有团队成员（一起出现，未执行的保持 pending/排队中）
    for (const m of (data.members || [])) {
      useAgentStateMachine.getState().transition({
        type: 'AGENT_CREATED',
        agentId: m.subAgentId || m.id,
        name: m.name || m.id,
        parentId: data.teamId,
        agentType: m.agentType || m.role || 'team-member',
        taskType: 'team',
        scene: m.scene,
        executionMode: (m.executionMode as 'acp' | 'in-process') || 'acp',
        task: m.task,
        multiAgent: {
          type: 'agent_team',
          teamName: data.name,
          memberId: m.id,
          stepIndex: m.stepIndex,
          totalSteps: m.totalSteps,
          debateRole: m.debateRole as any,
        },
      });
    }

    const members = (data.members || []).map((m) => ({
      id: m.id, name: m.name || m.id, lifecycle: 'creating' as const,
    }));
    useAsyncTaskStore.getState().transition({
      type: 'TASK_CREATED', taskId: data.teamId, taskType: 'team',
      name: data.name, strategy: data.strategy, members,
    });
  });

  messageBus.on('agent:team-member-start', (data: { teamId?: string; teamName?: string; memberId?: string; subAgentId?: string; name?: string; role?: string; agentType?: string; stepIndex?: number; totalSteps?: number; currentRound?: number; maxRounds?: number; debateRole?: string; executionMode?: 'acp' | 'in-process'; scene?: string }) => {
    const teamId = data.teamId || data.teamName || '';
    const memberId = data.subAgentId || data.memberId;
    if (!memberId) return;

    // team member 输出走 team pipeline 回主 agent，不直接进对话框
    asyncSubAgentIds.add(memberId);

    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: memberId,
      name: data.name || memberId,
      parentId: data.teamName || teamId,
      agentType: data.agentType || 'team-member',
      taskType: 'team',
      executionMode: data.executionMode,
      scene: data.scene,
      multiAgent: { type: 'agent_team', teamName: data.teamName, memberId, stepIndex: data.stepIndex, totalSteps: data.totalSteps, currentRound: data.currentRound, maxRounds: data.maxRounds, debateRole: data.debateRole },
    });

    if (teamId) {
      const taskStore = useAsyncTaskStore.getState();
      if (taskStore.tasks[teamId]?.lifecycle === 'creating') {
        taskStore.transition({ type: 'TASK_STARTED', taskId: teamId, subAgentId: memberId });
      }
      taskStore.transition({ type: 'MEMBER_STATE_CHANGED', taskId: teamId, memberId, lifecycle: 'running' });
    }
  });

  messageBus.on('agent:team-member-end', (data: { teamId?: string; teamName?: string; memberId?: string; subAgentId?: string; success: boolean }) => {
    const teamId = data.teamId || data.teamName;
    const memberId = data.subAgentId || data.memberId;
    if (!memberId) return;

    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END', agentId: memberId, success: data.success !== false,
    });

    if (teamId) {
      useAsyncTaskStore.getState().transition({
        type: 'MEMBER_STATE_CHANGED', taskId: teamId, memberId, lifecycle: 'completed',
      });
    }
  });

  messageBus.on('agent:team-end', (data: { teamId?: string; name?: string; success?: boolean }) => {
    const teamId = data.teamId || data.name;
    if (!teamId) return;

    const agentStore = useAgentStateMachine.getState();
    // 成员只清理 asyncSubAgentIds，节点和 task 推迟到主 agent 的 agent:end 再清除
    const descendants = agentStore.getDescendantIds(teamId);
    for (const id of descendants) {
      asyncSubAgentIds.delete(id);
    }
    // 将 team 节点标记为 reporting（汇报中），供 CLEANUP_COMPLETED_TASKS 识别
    agentStore.transition({ type: 'SUBAGENT_END', agentId: teamId, success: data.success !== false, isAsync: true });

    const taskStore = useAsyncTaskStore.getState();
    if (taskStore.tasks[teamId]?.taskType === 'team') {
      taskStore.transition({ type: 'TASK_COMPLETED', taskId: teamId });
      pendingCleanupIds.add(teamId);
    }
  });

  // ============================================================
  // AgentStateMachine + AsyncTaskStore — auto-summarize
  // ============================================================

  messageBus.on('agent:auto-summarize-start', (data?: { subAgentId?: string; groupId?: string }) => {
    const store = useAgentStateMachine.getState();
    if (data?.subAgentId) {
      store.transition({ type: 'AUTO_SUMMARIZE_START', agentId: data.subAgentId });
    } else {
      store.transition({ type: 'CLEANUP_COMPLETED_TASKS' });
    }

    const taskId = data?.subAgentId || data?.groupId;
    if (taskId) {
      const taskStore = useAsyncTaskStore.getState();
      if (taskStore.tasks[taskId]) {
        taskStore.transition({ type: 'TASK_CLEARED', taskId });
      }
    }
  });

  // ============================================================
  // CitationStore
  // ============================================================

  messageBus.on('agent:citation-data', (citations: Array<{ agentName: string; originalOutput: string; duration?: number; tokensUsed?: any }>) => {
    if (!Array.isArray(citations)) return;
    const store = useCitationStore.getState();
    for (const c of citations) {
      if (c.agentName) {
        store.addCitation(c.agentName, {
          agentId: c.agentName,
          agentName: c.agentName,
          files: [],
          summary: c.originalOutput?.slice(0, 200),
          timestamp: Date.now(),
          originalOutput: c.originalOutput,
          duration: c.duration,
          tokensUsed: c.tokensUsed,
        });
      }
    }
  });

  // ============================================================
  // messageStore — 消息流桥接
  // ============================================================

  messageBus.on('agent:started', (data: { model?: string; agentId?: string; isForeground?: boolean }) => {
    if (data?.isForeground === false) return;
    const msgId = generateMessageId('stream');
    const msgStore = useMessageStore.getState();
    msgStore.startStreaming(msgId);
  });

  messageBus.on('agent:text', (data: string | { text: string; agentId?: string }) => {
    const text = typeof data === 'string' ? data : data.text;
    const agentId = typeof data === 'object' && data.agentId ? data.agentId : getDefaultAgentId();
    // 异步子 agent 的文本走 TaskCompletionHandler 汇报，不直接进入对话框
    if (asyncSubAgentIds.has(agentId)) return;
    useMessageStore.getState().appendStreamingText(text);
    // 追踪当前正在输出文本到对话框的 agent，供 MessageBubble 显示编辑状态
    useAgentStateMachine.setState({ streamingAgentId: agentId });
  });

  messageBus.on('agent:end', (data?: { tokenUsage?: any; agentId?: string }) => {
    // 异步子 agent 的 end 不关闭流式气泡（走 TaskCompletionHandler 汇报）
    // 同步子 agent 和主 agent 的 end 关闭气泡
    if (data?.agentId && asyncSubAgentIds.has(data.agentId)) return;
    useMessageStore.getState().finishStreaming();
    useAgentStateMachine.setState({ streamingAgentId: null });
  });

  // ============================================================
  // SessionInitStore — session 生命周期
  // ============================================================

  messageBus.on('session:init-start', () => {
    useSessionInitStore.getState().transition({ type: 'INIT_START' });
  });

  messageBus.on('session:init-complete', () => {
    useSessionInitStore.getState().transition({ type: 'INIT_COMPLETE' });
  });

  messageBus.on('session:init-failed', (data: { error: string }) => {
    useSessionInitStore.getState().transition({ type: 'INIT_FAILED', error: data.error });
  });

  messageBus.on('session:init-restarting', () => {
    useSessionInitStore.getState().transition({ type: 'INIT_RESTARTING' });
  });

  messageBus.on('agent:crash', (data: { message: string }) => {
    useSessionInitStore.getState().transition({ type: 'CHILD_CRASH', message: data.message });
  });

  // 所有监听器就绪后，触发 session 初始化
  useSessionInitStore.getState().triggerInit();
}
