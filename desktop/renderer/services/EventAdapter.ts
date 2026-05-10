/**
 * EventAdapter — 将 IPC 事件路由到 Phase 1 Zustand stores。
 *
 * 与 EventBridge 并行运行，写入不同的 stores：
 * - AgentStateMachine 替代 activeAgentStore + runtimeStore.agentActivity
 * - AsyncTaskStore 替代 backgroundTaskStore
 * - ConversationStore 合并 messageStore.status + _conversationState + runtimeStore.processing
 * - CitationStore 从 messageStore.citations 拆出
 *
 * 通过 registerEventAdapter() 注册，带幂等性守卫。
 */

import { messageBus } from '../utils/MessageBus';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useAsyncTaskStore } from '../stores/AsyncTaskStore';
import { useConversationStore } from '../stores/ConversationStore';
import { useCitationStore } from '../stores/CitationStore';

let registered = false;

export function registerEventAdapter(): void {
  if (registered) return;
  registered = true;

  // ============================================================
  // ConversationStore
  // ============================================================

  messageBus.on('agent:started', () => {
    useConversationStore.getState().onAgentStarted();
  });

  messageBus.on('agent:end', () => {
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

  messageBus.on('agent:started', (data: { model?: string; agentId?: string }) => {
    const agentId = data?.agentId || 'xuanji';
    const store = useAgentStateMachine.getState();
    if (!store.agentMap[agentId]) {
      store.transition({ type: 'AGENT_CREATED', agentId, name: 'Xuanji', agentType: 'main' });
    }
  });

  messageBus.on('agent:text', (data: string | { text: string; agentId?: string }) => {
    const text = typeof data === 'string' ? data : data.text;
    const agentId = typeof data === 'object' && data.agentId ? data.agentId : 'xuanji';
    useAgentStateMachine.getState().transition({ type: 'TEXT_DELTA', agentId, text });
  });

  messageBus.on('agent:thinking', (data: string | { content: string; agentId?: string }) => {
    const content = typeof data === 'string' ? data : data.content;
    const agentId = typeof data === 'object' && data.agentId ? data.agentId : 'xuanji';
    useAgentStateMachine.getState().transition({ type: 'THINKING_DELTA', agentId, content });
  });

  messageBus.on('agent:tool-start', (data: { id: string; name: string; input: any; agentId?: string }) => {
    const agentId = data.agentId || 'xuanji';
    useAgentStateMachine.getState().transition({
      type: 'TOOL_START', agentId, toolId: data.id, toolName: data.name, toolInput: data.input || {},
    });
  });

  messageBus.on('agent:tool-end', (data: { id: string; name: string; result?: string; isError?: boolean; agentId?: string }) => {
    const agentId = data.agentId || 'xuanji';
    useAgentStateMachine.getState().transition({
      type: 'TOOL_END', agentId, toolId: data.id, toolName: data.name, result: data.result, isError: data.isError,
    });
  });

  messageBus.on('agent:end', () => {
    useAgentStateMachine.getState().transition({ type: 'CLEANUP_COMPLETED_TASKS' });
  });

  // ============================================================
  // AgentStateMachine + AsyncTaskStore — subagent events
  // ============================================================

  messageBus.on('agent:subagent-start', (data: { subAgentId: string; name: string; role?: string; task?: string; agentType?: string; parentId?: string; streamToUser?: boolean; scene?: string; executionMode?: 'acp' | 'in-process' }) => {
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: data.subAgentId,
      name: data.name,
      parentId: data.parentId,
      agentType: data.agentType || 'temporary',
      taskType: 'task',
      executionMode: data.executionMode || 'in-process',
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
        name: data.name, parentAgentId: data.parentId,
      });
      taskStore.transition({ type: 'TASK_STARTED', taskId: data.subAgentId });
    }
  });

  messageBus.on('agent:subagent-end', (data: { subAgentId: string; success: boolean }) => {
    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END', agentId: data.subAgentId, success: data.success,
    });

    const taskStore = useAsyncTaskStore.getState();
    if (taskStore.tasks[data.subAgentId]?.taskType === 'task') {
      taskStore.transition({ type: 'TASK_COMPLETED', taskId: data.subAgentId });
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

  messageBus.on('agent:team-start', (data: { teamId: string; name: string; goal?: string; strategy?: string; memberCount?: number; maxRounds?: number; members?: Array<{ id: string; name?: string; role?: string }> }) => {
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: data.teamId,
      name: data.name,
      taskType: 'team',
      multiAgent: { type: 'agent_team', strategy: data.strategy, teamName: data.name, goal: data.goal },
    });

    const members = (data.members || []).map((m) => ({
      id: m.id, name: m.name || m.id, lifecycle: 'creating' as const,
    }));
    useAsyncTaskStore.getState().transition({
      type: 'TASK_CREATED', taskId: data.teamId, taskType: 'team',
      name: data.name, strategy: data.strategy, members,
    });
  });

  messageBus.on('agent:team-member-start', (data: { teamId?: string; teamName?: string; memberId?: string; subAgentId?: string; name?: string; role?: string; stepIndex?: number; totalSteps?: number; debateRole?: string; executionMode?: 'acp' | 'in-process' }) => {
    const teamId = data.teamId || data.teamName || '';
    const memberId = data.subAgentId || data.memberId;
    if (!memberId) return;

    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: memberId,
      name: data.name || memberId,
      parentId: data.teamName || teamId,
      taskType: 'team',
      multiAgent: { type: 'agent_team', teamName: data.teamName, memberId, stepIndex: data.stepIndex, totalSteps: data.totalSteps, debateRole: data.debateRole },
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
    const descendants = agentStore.getDescendantIds(teamId);
    for (const id of descendants) {
      agentStore.transition({ type: 'AUTO_SUMMARIZE_START', agentId: id });
    }
    agentStore.transition({ type: 'AUTO_SUMMARIZE_START', agentId: teamId });

    const taskStore = useAsyncTaskStore.getState();
    if (taskStore.tasks[teamId]?.taskType === 'team') {
      taskStore.transition({ type: 'TASK_COMPLETED', taskId: teamId });
      taskStore.transition({ type: 'TASK_CLEARED', taskId: teamId });
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
}
