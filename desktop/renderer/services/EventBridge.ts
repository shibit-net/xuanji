// ============================================================
// EventBridge - IPC 事件桥接层（唯一事件入口）
// 负责接收后端事件并分发到对应的 store
// ============================================================
// 重要：messageBus.on() 必须在模块级别注册（同步），不能放在
// useEffect 中，否则首帧前到达的 IPC 事件会丢失。
// ============================================================

import { messageBus } from '../utils/MessageBus';
import { formatSceneLabel, formatModelName, generateMessageId } from '../stores/chatStore';
import { useMessageStore, markTaskDisplayStart, agentTaskDisplayStart, agentThinkingBuffer, TASK_DISPLAY_MIN_MS } from '../stores/messageStore';
import { useSessionStore } from '../stores/sessionStore';
import { useActiveAgentStore } from '../stores/activeAgentStore';
import { useRuntimeStore } from '../stores/runtimeStore';
import { useBackgroundTaskStore } from '../stores/backgroundTaskStore';
// generateToolSummaryMessage 已由 messageStore._handleAgentToolEnd 内部调用

// ── 工具函数 ──────────────────────────────────────

function generateFileChangeSummary(change: any): string {
  const { filePath, operation, stats } = change;
  if (!filePath || !operation) return '';
  switch (operation) {
    case 'create':
      return `\n## 📄 新文件 — \`${filePath}\`\n\n共 ${stats?.added || 0} 行\n`;
    case 'edit':
    case 'overwrite':
      return `\n## ✏️ 文件${operation === 'edit' ? '编辑' : '覆盖'} — \`${filePath}\`\n\n+\`${stats?.added || 0}\` 添加｜-\`${stats?.removed || 0}\` 删除\n`;
    default:
      return '';
  }
}

// ── moment 队列（每个至少展示 500ms）──
const momentQueue: Array<{ agentId: string; moment: any }> = [];
let momentQueueRunning = false;
const MOMENT_MIN_DISPLAY_MS = 500;

function enqueueMoment(agentId: string, moment: any) {
  momentQueue.push({ agentId, moment });
  if (!momentQueueRunning) drainMomentQueue();
}

function drainMomentQueue() {
  if (momentQueue.length === 0) { momentQueueRunning = false; return; }
  momentQueueRunning = true;
  const { agentId, moment } = momentQueue.shift()!;
  useRuntimeStore.getState().setAgentMoment(agentId, moment);
  setTimeout(drainMomentQueue, MOMENT_MIN_DISPLAY_MS);
}

// ── 模块级变量 ────────────────────────────────────
// 根 agentId 由意图路由决定（通过 agent:intent-route 事件下发）
let rootAgentId = 'xuanji';

// ============================================================
// 所有 IPC 事件监听器 — 模块导入时同步注册
// ============================================================

// ── Agent 基础事件 ──────────────────────────────────

messageBus.on('agent:intent-route', (data: { agentId: string; confidence: number }) => {
  rootAgentId = data.agentId;
});

messageBus.on('agent:text', (data: string | { text: string; agentId?: string }) => {
  if (typeof data === 'string') {
    useMessageStore.getState()._handleAgentText(data);
    return;
  }
  if (data.agentId && data.agentId !== rootAgentId) {
    // 仅更新 workspace monitor 状态，不创建聊天气泡
    useMessageStore.getState()._promoteSubAgent(data.agentId);

    // 更新 moment 标签为"编写中"
    const rtStore = useRuntimeStore.getState();
    const curMoment = rtStore.agentActivity.currentMoments[data.agentId];
    rtStore.setAgentMoment(data.agentId, {
      type: 'writing', icon: '✍️', label: '编写中',
      durationMs: 0, status: 'running',
      startTime: (curMoment && curMoment.type === 'writing') ? curMoment.startTime : Date.now(),
    });
    // 不再追加到思考气泡——思考气泡只展示推理过程（agent:thinking）
  } else {
    useMessageStore.getState()._handleAgentText(data.text);
  }
});

messageBus.on('agent:conversation-state', (data: { from: string; to: string }) => {
  const chatStatus: Record<string, string> = {
    idle: 'idle', executing: 'thinking', outputting: 'thinking', waiting_async: 'idle',
  };
  useMessageStore.setState({ status: (chatStatus[data.to] || 'idle') as any, _conversationState: data.to as any });
	// workspace monitor 是全局实时监控，不随对话状态转换而重置
	// 子 agent 生命周期由事件驱动：subagent-start → 添加节点，subagent-end → 标记完成
  if (data.to === 'outputting') {
    useMessageStore.setState({ _autoSummarizeActive: false });
  }
});

messageBus.on('agent:thinking', (data: string | { content: string; agentId?: string }) => {
  const content = typeof data === 'string' ? data : data.content;
  const agentId = typeof data === 'object' ? data.agentId : undefined;
  if (agentId && agentId !== rootAgentId) {
    // ── backgroundTaskStore: 子 agent 开始思考 → 任务进入 running ──
    const bgStore = useBackgroundTaskStore.getState();
    const task = bgStore.tasks[agentId];
    if (task && task.lifecycle === 'creating') {
      bgStore.transitionTask(agentId, 'running');
    }

    // 提前创建子 agent 节点，确保后续 setAgentThought / setAgentMoment 能正确关联
    useMessageStore.getState()._promoteSubAgent(agentId);

    const runtimeStore = useRuntimeStore.getState();
    const currentMoment = runtimeStore.agentActivity.currentMoments[agentId];

    // 如果 agent 已是终态（待汇报），不覆盖 moment
    const s = useActiveAgentStore.getState();
    const findAgentStatus = (agent: any, targetId: string): string | null => {
      if (!agent) return null;
      if (agent.id === targetId) return agent.status;
      if (agent.subAgents) {
        for (const sub of agent.subAgents) {
          const found = findAgentStatus(sub, targetId);
          if (found !== null) return found;
        }
      }
      return null;
    };
    const agentThinkingStatus = findAgentStatus(s.mainAgent, agentId);
    if (agentThinkingStatus === 'success' || agentThinkingStatus === 'failed' || agentThinkingStatus === 'done') {
      // 终态 agent 的 thinking 事件不更新 moment，只更新气泡内容（如果有）
    } else if (!currentMoment || currentMoment.type !== 'writing') {
      const isAlreadyThinking = currentMoment && currentMoment.type === 'thinking';
      runtimeStore.setAgentMoment(agentId, {
        type: 'thinking', icon: '🧠', label: '思考中', durationMs: 0, status: 'running',
        startTime: isAlreadyThinking ? currentMoment.startTime : Date.now(),
      });
    }

    // 子 agent thinking 流式追加到 activeAgentStore，ExecutionFlow thought bubble 显示
    // 任务文本至少展示 3 秒，期间思考内容先缓冲
    const activeAgentStore = useActiveAgentStore.getState();
    const taskStart = agentTaskDisplayStart[agentId];
    if (taskStart) {
      const elapsed = Date.now() - taskStart;
      if (elapsed < TASK_DISPLAY_MIN_MS) {
        agentThinkingBuffer[agentId] = (agentThinkingBuffer[agentId] || '') + content;
        return;
      }
      // 3 秒到期：替换任务文本为缓冲的思考内容
      const buffer = agentThinkingBuffer[agentId];
      delete agentTaskDisplayStart[agentId];
      delete agentThinkingBuffer[agentId];
      activeAgentStore.setAgentThought(agentId, (buffer || '') + content);
      return;
    }
    const prev = activeAgentStore.getAgentThought(agentId) || '';
    activeAgentStore.setAgentThought(agentId, prev + content);
  } else {
    useMessageStore.getState()._handleAgentThinking(content);
  }
});

messageBus.on('agent:tool-start', (data: any) => {
  useMessageStore.getState()._handleAgentToolStart(data);
});

messageBus.on('agent:tool-end', (data: any) => {
  useMessageStore.getState()._handleAgentToolEnd(data);
});

messageBus.on('agent:usage', (usage: any) => {
  useMessageStore.getState()._handleAgentUsage(usage);
});

messageBus.on('agent:error', (error: string) => {
  useMessageStore.getState()._handleAgentError(error);
});

messageBus.on('agent:end', (state: any) => {
  useMessageStore.getState()._handleAgentEnd(state);
});

// ── 文件变更 ──────────────────────────────────────

messageBus.on('agent:file-changes', (data: { changes: any[] }) => {
  data.changes.forEach((change) => {
    const summary = generateFileChangeSummary(change);
    if (summary) {
      useMessageStore.getState().addMessage({
        id: generateMessageId('file-change'),
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
        toolSummary: true,
      });
    }
  });
});

// ── 多 Agent 事件 ────────────────────────────────

messageBus.on('agent:team-start', (data: any) => {
  // ── backgroundTaskStore: 注册 team 类型后台任务 ──
  const bgStore = useBackgroundTaskStore.getState();
  const teamName = data.name || 'team';
  if (!bgStore.tasks[teamName]) {
    const members = (data.members || []).map((m: any) => ({
      id: m.subAgentId || m.id,
      name: m.name || m.id,
      lifecycle: 'creating' as const,
    }));
    bgStore.registerTask({
      id: teamName,
      type: 'team',
      name: teamName,
      lifecycle: 'creating',
      strategy: data.strategy,
      members,
      createdAt: Date.now(),
    });
  }

  useMessageStore.getState()._handleTeamStart(data);
});

messageBus.on('agent:team-member-start', (data: any) => {
  // ── backgroundTaskStore: 成员进入 running ──
  const bgStore = useBackgroundTaskStore.getState();
  const teamName = data.teamName || data.name;
  const memberId = data.subAgentId || data.memberId;

  // 清理 subagent-start 可能先到达而注册的重复 task 条目
  if (memberId && bgStore.tasks[memberId]?.type === 'task') {
    useBackgroundTaskStore.setState(s => {
      const newTasks = { ...s.tasks };
      delete newTasks[memberId];
      return { tasks: newTasks };
    });
  }

  const task = bgStore.tasks[teamName];
  if (task && task.type === 'team') {
    if (task.lifecycle === 'creating') {
      bgStore.transitionTask(teamName, 'running');
    }
    bgStore.transitionMember(teamName, memberId, 'running');
  }

  useMessageStore.getState()._handleTeamMemberStart(data);
});

messageBus.on('agent:team-member-end', (data: any) => {
  // ── backgroundTaskStore: 成员完成/失败 ──
  const bgStore = useBackgroundTaskStore.getState();
  const teamName = data.teamName || '';
  if (teamName && bgStore.tasks[teamName]?.type === 'team') {
    const to = data.success !== false ? 'completed' : 'completed';
    bgStore.transitionMember(teamName, data.subAgentId || data.memberId, to, {
      failureReason: data.failureReason,
      retryCount: data.retryCount,
    });
  }

  useMessageStore.getState()._handleTeamMemberEnd(data);
});

messageBus.on('agent:team-end', (data: any) => {
  // ── backgroundTaskStore: team 整体完成 ──
  const bgStore = useBackgroundTaskStore.getState();
  const teamName = data.name || '';
  if (teamName && bgStore.tasks[teamName]?.type === 'team') {
    // 将所有卡在 creating/running 的成员迁移到 completed，确保 InputArea 计数归零
    const teamTask = bgStore.tasks[teamName];
    for (const m of teamTask.members) {
      if (m.lifecycle === 'creating' || m.lifecycle === 'running') {
        bgStore.transitionMember(teamName, m.id, 'completed', {
          failureReason: data.success === false ? (data.error || '任务已取消') : undefined,
        });
      }
    }
    bgStore.transitionTask(teamName, 'completed');
  }

  useMessageStore.getState()._handleTeamEnd(data);
});

// ── 子 Agent 事件 ────────────────────────────────

messageBus.on('agent:subagent-start', (data: any) => {
  console.log('[EventBridge] agent:subagent-start received:', { subAgentId: data.subAgentId, name: data.name, parentId: data.parentId, task: data.task?.slice(0, 80) });

  // ── backgroundTaskStore: 注册 task 类型后台任务 ──
  const bgStore = useBackgroundTaskStore.getState();
  const taskName = data.name || data.role || data.subAgentId;

  // 跳过团队成员（已由 team-start 注册为 team 任务的成员）
  const isTeamMember = Object.values(bgStore.tasks).some(
    t => t.type === 'team' && t.members.some(m => m.id === data.subAgentId)
  );

  if (!isTeamMember && !bgStore.tasks[data.subAgentId]) {
    bgStore.registerTask({
      id: data.subAgentId,
      type: 'task',
      name: taskName,
      lifecycle: 'creating',
      subAgentId: data.subAgentId,
      members: [{ id: data.subAgentId, name: taskName, lifecycle: 'creating' }],
      createdAt: Date.now(),
    });
  }

  const existingPending = useMessageStore.getState()._pendingSubAgents[data.subAgentId];
  if (!existingPending) {
    useMessageStore.setState((s) => ({
      _pendingSubAgents: {
        ...s._pendingSubAgents,
        [data.subAgentId]: {
          subAgentId: data.subAgentId, name: data.name, role: data.role,
          task: data.task, agentType: data.agentType || 'temporary',
          parentId: data.parentId, streamToUser: !!(data as any).streamToUser,
          scene: (data as any).scene, startTime: Date.now(),
          executionMode: data.executionMode || 'in-process',
        },
      },
    }));
    setTimeout(() => {
      const msgStore = useMessageStore.getState();
      if (msgStore._pendingSubAgents[data.subAgentId]) {
        msgStore._promoteSubAgent(data.subAgentId);
      }
    }, 3000);
  }
});

messageBus.on('agent:subagent-text', (data: { agentId: string; text: string }) => {
  useMessageStore.getState()._promoteSubAgent(data.agentId);

  const rtStore2 = useRuntimeStore.getState();
  const curMoment2 = rtStore2.agentActivity.currentMoments[data.agentId];
  rtStore2.setAgentMoment(data.agentId, {
    type: 'writing', icon: '✍️', label: '编写中',
    durationMs: 0, status: 'running',
    startTime: (curMoment2 && curMoment2.type === 'writing') ? curMoment2.startTime : Date.now(),
  });

  const { _streamToUserMap } = useMessageStore.getState();
  const agentName = _streamToUserMap[data.agentId];
  if (agentName) {
    useMessageStore.getState()._handleSubAgentText(data.agentId, agentName, data.text);
  }
});

messageBus.on('agent:subagent-end', (data: { subAgentId: string; success: boolean; duration?: number }) => {
  const activeAgentStore = useActiveAgentStore.getState();

  // 检查是否为团队成员（团队成员由 _handleTeamEnd 统一设置汇报 moment）
  const findAgentInTree = (agent: any, targetId: string): any => {
    if (!agent) return null;
    if (agent.id === targetId) return agent;
    if (agent.subAgents) {
      for (const sub of agent.subAgents) {
        const found = findAgentInTree(sub, targetId);
        if (found) return found;
      }
    }
    return null;
  };
  const agentNode = findAgentInTree(activeAgentStore.mainAgent, data.subAgentId);
  const isTeamMember = agentNode?.multiAgent?.type === 'agent_team';

  // 失败也保留节点，等待 auto-summarize-start 统一清理
  if (!data.success) {
    // ── backgroundTaskStore: 非团队成员 → completed ──
    if (!isTeamMember) {
      useBackgroundTaskStore.getState().transitionTask(data.subAgentId, 'completed');
    }

    useMessageStore.getState()._promoteSubAgent(data.subAgentId);
    activeAgentStore.setAgentStatus(data.subAgentId, 'failed');

    // 结束父 agent 的异步 task 工具 timeline
    const taskParentInfo = useMessageStore.getState()._taskParentMap[data.subAgentId];
    if (taskParentInfo) {
      const rtStore3 = useRuntimeStore.getState();
      rtStore3.updateToolCall(taskParentInfo.toolId, { status: 'error' });
      rtStore3.finishTimelineEvent(taskParentInfo.agentId, taskParentInfo.toolId, data.duration || 0, 'error');
      useMessageStore.setState((s) => {
        const newMap = { ...s._taskParentMap };
        delete newMap[data.subAgentId];
        return { _taskParentMap: newMap };
      });
    }

    useMessageStore.setState((s) => {
      const newMap = { ...s._streamToUserMap };
      delete newMap[data.subAgentId];
      const newStreams = { ...s._subAgentStreams };
      delete newStreams[data.subAgentId];
      return { _streamToUserMap: newMap, _subAgentStreams: newStreams };
    });

    // 团队成员失败也不在此设置汇报 moment，等待 _handleTeamEnd 统一处理
    if (!isTeamMember) {
      const runtimeStore = useRuntimeStore.getState();
      const currentMoment = runtimeStore.agentActivity.currentMoments[data.subAgentId];
      const taskStartTime = currentMoment?.startTime || Date.now();
      runtimeStore.setAgentMoment(data.subAgentId, {
        type: 'reporting', icon: '⚠️', label: '执行失败',
        durationMs: 0, status: 'running', startTime: taskStartTime,
      });
    }
    return;
  }

  // 成功
  // ── backgroundTaskStore: 非团队成员 → completed ──
  if (!isTeamMember) {
    useBackgroundTaskStore.getState().transitionTask(data.subAgentId, 'completed');
  }

  useMessageStore.getState()._promoteSubAgent(data.subAgentId);
  activeAgentStore.setAgentStatus(data.subAgentId, 'success');

  activeAgentStore.setAgentThought(data.subAgentId, '');
  // 任务展示：仅非团队成员在此设置，团队成员由 _handleTeamEnd 统一处理
  if (!isTeamMember) {
    markTaskDisplayStart(data.subAgentId);
  }

  // 结束父 agent 的异步 task 工具 timeline
  const taskParentInfo = useMessageStore.getState()._taskParentMap[data.subAgentId];
  if (taskParentInfo) {
    const rtStore2 = useRuntimeStore.getState();
    rtStore2.updateToolCall(taskParentInfo.toolId, {
      status: data.success ? 'success' : 'error',
      duration: data.duration,
    });
    rtStore2.finishTimelineEvent(
      taskParentInfo.agentId, taskParentInfo.toolId,
      data.duration || 0, data.success ? 'success' : 'error'
    );
    useMessageStore.setState((s) => {
      const newMap = { ...s._taskParentMap };
      delete newMap[data.subAgentId];
      return { _taskParentMap: newMap };
    });
  }

  useMessageStore.setState((s) => {
    const newMap = { ...s._streamToUserMap };
    delete newMap[data.subAgentId];
    const newStreams = { ...s._subAgentStreams };
    delete newStreams[data.subAgentId];
    return { _streamToUserMap: newMap, _subAgentStreams: newStreams };
  });

  // 团队成员不在此设置汇报 moment，由 _handleTeamEnd 统一处理
  if (!isTeamMember) {
    const rtStore = useRuntimeStore.getState();
    const curMoment = rtStore.agentActivity.currentMoments[data.subAgentId];
    const tStartTime = curMoment?.startTime || Date.now();
    rtStore.setAgentMoment(data.subAgentId, {
      type: 'reporting', icon: '📤', label: '汇报中',
      durationMs: 0, status: 'running', startTime: tStartTime,
    });
  }
});

// ── 异步任务汇总 ────────────────────────────────

messageBus.on('agent:auto-summarize-start', (data?: { subAgentId?: string; groupId?: string }) => {
  useMessageStore.setState({ _autoSummarizeActive: true });
  const activeAgentStore = useActiveAgentStore.getState();
  const mainAgent = activeAgentStore.mainAgent;
  if (mainAgent) activeAgentStore.setAgentStatus(mainAgent.id, 'thinking');

  if (data?.subAgentId && mainAgent) {
    const findParentId = (agent: any, targetId: string): string | null => {
      if (!agent || !agent.subAgents) return null;
      for (const sub of agent.subAgents) {
        if (sub.id === targetId) return agent.id;
        const found = findParentId(sub, targetId);
        if (found) return found;
      }
      return null;
    };

    // team-exec- 前缀：团队级别的汇总，找到 teamName 对应的所有成员一起清理
    if (data.subAgentId.startsWith('team-exec-')) {
      const teamName = data.subAgentId.replace('team-exec-', '').replace(/-?\d+$/, '');

      // ── backgroundTaskStore: team 任务已汇报 → cleared ──
      const bgStore = useBackgroundTaskStore.getState();
      if (bgStore.tasks[teamName]) {
        bgStore.transitionTask(teamName, 'cleared');
      }

      const findTeamMembers = (agent: any): string[] => {
        if (!agent || !agent.subAgents) return [];
        const members: string[] = [];
        for (const sub of agent.subAgents) {
          if (sub.multiAgent?.teamName === teamName) members.push(sub.id);
          members.push(...findTeamMembers(sub));
        }
        return members;
      };
      const memberIds = findTeamMembers(mainAgent);
      if (memberIds.length > 0) {
        const parentId = findParentId(mainAgent, memberIds[0]) || mainAgent.id;
        const rtStore = useRuntimeStore.getState();
        useMessageStore.setState((s) => {
          const newPending = { ...s._pendingSubAgents };
          for (const mid of memberIds) {
            delete newPending[mid];
            activeAgentStore.removeSubAgent(parentId, mid);
            rtStore.finishAgentMoment(mid, 'success');
            rtStore.clearAgentActivity(mid);
            // 清理模块级 map 残留
            delete agentTaskDisplayStart[mid];
            delete agentThinkingBuffer[mid];
          }
          // 清理 citationOutputs 中已移除 agent 的条目
          const newCitations = { ...s.citationOutputs };
          for (const mid of memberIds) {
            delete newCitations[mid];
          }
          return { _pendingSubAgents: newPending, citationOutputs: newCitations };
        });
      }
    } else {
      // ── backgroundTaskStore: task 子 agent 已汇报 → cleared ──
      const bgStore = useBackgroundTaskStore.getState();
      if (bgStore.tasks[data.subAgentId]) {
        bgStore.transitionTask(data.subAgentId, 'cleared');
      }

      // 单个子 agent 清理（task 工具创建）
      const parentId = findParentId(mainAgent, data.subAgentId);
      if (parentId) {
        const rtStore = useRuntimeStore.getState();
        useMessageStore.setState((s) => {
          const newPending = { ...s._pendingSubAgents };
          delete newPending[data.subAgentId!];
          activeAgentStore.removeSubAgent(parentId, data.subAgentId!);
          rtStore.finishAgentMoment(data.subAgentId!, 'success');
          rtStore.clearAgentActivity(data.subAgentId!);
          // 清理模块级 map 残留
          delete agentTaskDisplayStart[data.subAgentId!];
          delete agentThinkingBuffer[data.subAgentId!];
          // 清理 citationOutputs
          const newCitations = { ...s.citationOutputs };
          delete newCitations[data.subAgentId!];
          return { _pendingSubAgents: newPending, citationOutputs: newCitations };
        });
      }
    }
  }
});

// ── 引用数据 ─────────────────────────────────────

messageBus.on('agent:citation-data', (citations: any[]) => {
  if (Array.isArray(citations)) {
    useMessageStore.setState((s) => {
      const updated = { ...s.citationOutputs };
      for (const c of citations) {
        if (c.agentName && c.originalOutput) {
          const existing = updated[c.agentName] || [];
          updated[c.agentName] = [...existing, c];
        }
      }
      return { citationOutputs: updated };
    });
  }
});

// ── 可视化监控事件 ──────────────────────────────

messageBus.on('agent:thinking-start', (data: { agentId: string; content: string }) => {
  const isMainAgent = !data.agentId || data.agentId === 'xuanji' || data.agentId === 'main';
  if (isMainAgent && useMessageStore.getState()._autoSummarizeActive) {
    const activeAgentStore = useActiveAgentStore.getState();
    const mainAgent = activeAgentStore.mainAgent;
    if (mainAgent) {
      const doneIds = mainAgent.subAgents
        .filter(sub => (sub.status === 'success' || sub.status === 'failed') && sub.multiAgent?.type !== 'agent_team')
        .map(sub => sub.id);
      if (doneIds.length > 0) {
        const rtStore = useRuntimeStore.getState();
        useMessageStore.setState((s) => {
          const newPending = { ...s._pendingSubAgents };
          const newCitations = { ...s.citationOutputs };
          for (const id of doneIds) {
            delete newPending[id];
            activeAgentStore.removeSubAgent(mainAgent.id, id);
            rtStore.finishAgentMoment(id, 'success');
            rtStore.clearAgentActivity(id);
            delete agentTaskDisplayStart[id];
            delete agentThinkingBuffer[id];
            delete newCitations[id];
          }
          return { _pendingSubAgents: newPending, citationOutputs: newCitations };
        });
      }
    }
  }

  useMessageStore.getState()._promoteSubAgent(data.agentId);

  const store = useRuntimeStore.getState();
  const activeAgentStore = useActiveAgentStore.getState();
  if (data.agentId && data.content) {
    // 尊重 3s 任务展示缓冲期，内容先缓冲
    const taskStart = agentTaskDisplayStart[data.agentId];
    if (taskStart) {
      const elapsed = Date.now() - taskStart;
      if (elapsed < TASK_DISPLAY_MIN_MS) {
        agentThinkingBuffer[data.agentId] = (agentThinkingBuffer[data.agentId] || '') + data.content;
      } else {
        const buffer = agentThinkingBuffer[data.agentId];
        delete agentTaskDisplayStart[data.agentId];
        delete agentThinkingBuffer[data.agentId];
        activeAgentStore.setAgentThought(data.agentId, (buffer || '') + data.content);
      }
    } else {
      const currentThought = activeAgentStore.getAgentThought(data.agentId) || '';
      activeAgentStore.setAgentThought(data.agentId, currentThought + data.content);
    }
  }

  const SCENE_MIN_DISPLAY_MS = 3000;
  const currentMoment = store.agentActivity.currentMoments[data.agentId];
  const sceneElapsed = currentMoment?.startTime ? Date.now() - currentMoment.startTime : SCENE_MIN_DISPLAY_MS;
  const remaining = SCENE_MIN_DISPLAY_MS - sceneElapsed;
  const taskStartTime = currentMoment?.startTime || Date.now();

  const setThinkingMoment = () => {
    const s = useActiveAgentStore.getState();
    const findAgentStatus = (agent: any, targetId: string): string | null => {
      if (!agent) return null;
      if (agent.id === targetId) return agent.status;
      if (agent.subAgents) {
        for (const sub of agent.subAgents) {
          const found = findAgentStatus(sub, targetId);
          if (found !== null) return found;
        }
      }
      return null;
    };
    const agentStatus = findAgentStatus(s.mainAgent, data.agentId);
    if (agentStatus === 'success' || agentStatus === 'failed' || agentStatus === 'done') return;

    useRuntimeStore.getState().setAgentMoment(data.agentId, {
      type: 'thinking', icon: '💭', label: '思考中',
      durationMs: 0, status: 'running', startTime: taskStartTime,
    });
  };

  if (remaining > 0) {
    setTimeout(setThinkingMoment, remaining);
  } else {
    setThinkingMoment();
  }
});

messageBus.on('agent:skill-start', (data: { agentId: string; skillName: string; input?: any }) => {
  const id = `skill-${Date.now()}`;
  const store = useRuntimeStore.getState();
  store.addTimelineEvent(data.agentId, {
    id, icon: '✨', label: data.skillName.slice(0, 20),
    status: 'running', startTime: Date.now(),
  });
  store.addRecentEvent({
    agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
    description: `执行 Skill: ${data.skillName}`, icon: '✨',
  });
});

messageBus.on('agent:skill-end', (_data: { agentId: string; skillName: string; duration?: number; success?: boolean }) => {
  // Skill 完成时暂不需要额外处理
});

messageBus.on('agent:memory-read', (data: { agentId: string; hitCount?: number; layersSearched?: number }) => {
  const store = useRuntimeStore.getState();
  const eventId = `memory-read-${Date.now()}`;
  store.addTimelineEvent(data.agentId, {
    id: eventId, icon: '📖', label: `回忆${data.hitCount ?? 0}条`,
    status: 'running', startTime: Date.now(),
  });
  store.addRecentEvent({
    agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
    description: `记忆检索: ${data.hitCount ?? 0} 条命中`, icon: '📖',
  });
  setTimeout(() => {
    store.finishTimelineEvent(data.agentId, eventId, 300, 'success');
  }, 300);
});

messageBus.on('agent:memory-write', (data: { agentId: string; scope?: string; summary?: string }) => {
  const store = useRuntimeStore.getState();
  const eventId = `memory-write-${Date.now()}`;
  store.addTimelineEvent(data.agentId, {
    id: eventId, icon: '💾', label: (data.summary || '写入记忆').slice(0, 20),
    status: 'running', startTime: Date.now(),
  });
  store.addRecentEvent({
    agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
    description: `记忆写入: ${data.summary || data.scope || ''}`, icon: '💾',
  });
  setTimeout(() => {
    store.finishTimelineEvent(data.agentId, eventId, 500, 'success');
  }, 500);
});

messageBus.on('agent:compress-start', (data: { agentId: string; originalTokens?: number }) => {
  const store = useRuntimeStore.getState();
  store.setAgentMoment(data.agentId, {
    type: 'thinking', icon: '🗜️', label: '压缩上下文中...',
    durationMs: 0, status: 'running',
  });
  store.addRecentEvent({
    agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
    description: `开始压缩上下文 (${data.originalTokens ?? 0} tokens)`, icon: '🗜️',
  });
});

messageBus.on('agent:compress-end', (data: { agentId: string; originalTokens?: number; compressedTokens?: number; compressionRatio?: number; duration?: number }) => {
  const store = useRuntimeStore.getState();
  const ratio = data.compressionRatio ? Math.round(data.compressionRatio * 100) : 0;
  store.finishAgentMoment(data.agentId, 'success');
  store.addRecentEvent({
    agentName: data.agentId === 'main' ? 'Xuanji' : data.agentId,
    description: `上下文已压缩: ${data.originalTokens ?? 0} → ${data.compressedTokens ?? 0} tokens (${ratio}%)`,
    icon: '✅',
  });
  if (data.agentId === 'main') {
    useMessageStore.getState().addMessage({
      id: generateMessageId('compress'),
      role: 'system',
      content: `🗜️ 上下文已自动压缩：${data.originalTokens ?? 0} → ${data.compressedTokens ?? 0} tokens (减少 ${ratio}%)\n\n为了保持对话流畅，历史消息已被智能压缩。您的完整对话历史仍然保留在界面中。`,
      timestamp: Date.now(),
    });
  }
});

// ── Prompt 构建事件 ──────────────────────────────

messageBus.on('prompt:build-event', (event: { type: string; timestamp: number; agentId: string; data?: any }) => {
  const runtimeStore = useRuntimeStore.getState();
  const mainAgentId = useActiveAgentStore.getState().mainAgent?.id || 'xuanji';
  const agentId = (!event.agentId || event.agentId === 'xuanji' || event.agentId === 'main') ? mainAgentId : event.agentId;

  switch (event.type) {
    case 'build:start':
      runtimeStore.startPromptBuild();
      break;
    case 'intent:match': {
      const matchData = event.data;
      if (matchData.type === 'match:trying') {
        const label = matchData.method === 'keyword' ? '关键词' : matchData.method === 'embedding' ? 'Embedding' : matchData.method;
        enqueueMoment(agentId, { type: 'thinking', icon: '🔍', label, durationMs: 0, status: 'running' });
      } else if (matchData.type === 'match:success') {
        const label = matchData.method === 'keyword' ? '关键词' : matchData.method === 'embedding' ? 'Embedding' : matchData.method;
        enqueueMoment(agentId, { type: 'thinking', icon: '✅', label, durationMs: 0, status: 'success' });
      } else if (matchData.type === 'match:failed') {
        const label = matchData.method === 'keyword' ? '关键词' : matchData.method === 'embedding' ? 'Embedding' : matchData.method;
        enqueueMoment(agentId, { type: 'thinking', icon: '❌', label, durationMs: 0, status: 'error' });
      }
      break;
    }
    case 'intent:analyzing':
      enqueueMoment(agentId, { type: 'thinking', icon: '🔍', label: '分析意图', durationMs: 0, status: 'running' });
      break;
    case 'intent:analyzed':
      runtimeStore.setPromptIntent({
        scene: event.data?.scene || 'coding',
        complexity: event.data?.complexity || 'standard',
        confidence: event.data?.confidence || 1,
      });
      enqueueMoment(agentId, { type: 'thinking', icon: '🎯', label: formatSceneLabel(event.data?.scene || 'coding'), durationMs: 0, status: 'running' });
      break;
    case 'components:selected':
      if (event.data?.components) {
        for (const c of event.data.components) {
          runtimeStore.addPromptComponent({
            id: c.id, name: c.name,
            layer: parseInt((c.layer || 'L0').replace('L', ''), 10),
            source: c.source || 'builtin',
          });
        }
        const names = event.data.components.map((c: any) => c.name).slice(0, 3);
        const displayText = names.join('\n') + (event.data.components.length > 3 ? '\n...' : '');
        enqueueMoment(agentId, { type: 'thinking', icon: '🧩', label: displayText, durationMs: 0, status: 'running' });
      }
      break;
    case 'build:complete':
      runtimeStore.finishPromptBuild(event.data?.layers
        ? { layers: event.data.layers, totalTokens: event.data.estimatedTokens }
        : undefined);
      runtimeStore.finishAgentMoment(agentId, 'success');
      break;
  }
});

// ── ModelClassifier 事件 ─────────────────────────

messageBus.on('workspace:model-classifier-start', (data: any) => {
  const activeAgentStore = useActiveAgentStore.getState();
  if (activeAgentStore.mainAgent) {
    const classifierAgent: import('../stores/activeAgentStore').AgentState = {
      id: 'intent-classifier', name: '意图分析', status: 'executing',
      currentThought: `🎯 ${formatModelName(data.model)}`,
      currentTools: [], subAgents: [], agentType: 'builtin',
      stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
    };
    activeAgentStore.addSubAgent(activeAgentStore.mainAgent.id, classifierAgent);
  }
});

messageBus.on('workspace:model-classifier-end', (_data: any) => {
  setTimeout(() => {
    const activeAgentStore = useActiveAgentStore.getState();
    if (activeAgentStore.mainAgent) {
      activeAgentStore.removeSubAgent(activeAgentStore.mainAgent.id, 'intent-classifier');
    }
  }, 500);
});

// ── 项目信息 ─────────────────────────────────────

messageBus.on('project:info', (data: { type: string; hasGit: boolean; rootPath: string; configFiles: string[]; gitBranch?: string }) => {
  const runtimeStore = useRuntimeStore.getState();
  const projectName = data.rootPath.split('/').pop() || data.rootPath;
  runtimeStore.setContextInfo({
    workingDirectory: data.rootPath,
    projectInfo: {
      name: projectName, type: data.type, hasGit: data.hasGit,
      rootPath: data.rootPath, gitBranch: data.gitBranch,
    },
  });
});

messageBus.on('init-complete', (data: { success: boolean; agentId?: string; workspacePath?: string }) => {
  if (data.success && data.workspacePath) {
    const runtimeStore = useRuntimeStore.getState();
    if (!runtimeStore.contextInfo?.workingDirectory) {
      const projectName = data.workspacePath.split('/').pop() || data.workspacePath;
      runtimeStore.setContextInfo({
        workingDirectory: data.workspacePath,
        projectInfo: { name: projectName, type: 'workspace', hasGit: false, rootPath: data.workspacePath },
      });
    }
  }
});

// ── 权限/Plan Mode ────────────────────────────

messageBus.on('permission:request', (data: any) => {
  useSessionStore.getState().setPermissionRequest(data);
});
messageBus.on('plan-review:request', (data: any) => {
  useSessionStore.getState().setPlanReviewRequest(data);
});
messageBus.on('ask-user:request', (data: any) => {
  useSessionStore.getState().setAskUserRequest(data);
});
messageBus.on('plan-mode:enter', () => {
  useSessionStore.getState().setPlanMode(true);
});
messageBus.on('plan-mode:exit', () => {
  useSessionStore.getState().setPlanMode(false);
});

// ============================================================
// initEventBridge — 仅处理需要异步初始化的部分
// 监听器已在模块导入时同步注册，此处只做 agentInit
// ============================================================

let initialized = false;

export function initEventBridge(): void {
  if (initialized || typeof window === 'undefined' || !window.electron) return;
  initialized = true;

  // 初始化配置（异步）
  window.electron.agentInit().then((result) => {
    if (result.success && result.config?.model) {
      useMessageStore.setState((state) => ({
        stats: { ...state.stats, model: result.config.model },
      }));
    }
  }).catch(() => {});
}
