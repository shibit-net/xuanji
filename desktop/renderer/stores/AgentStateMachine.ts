/**
 * AgentStateMachine — 替代 activeAgentStore + runtimeStore.agentActivity。
 *
 * 核心改进：
 * - agentMap: Record<string, AgentState> — 扁平 O(1) Map，消灭 4 种递归树搜索
 * - transition(event) — 统一事件入口，ensureAgent + updateMoment 集中处理
 * - 终态保护在 transition 开头统一执行，消灭 7+ 处分散的防御检查
 */

import { create } from 'zustand';
import { storeEventBus } from '../utils/StoreEventBus';

// ============================================================
// 类型定义
// ============================================================

export type AgentStatus =
  | 'pending'
  | 'thinking'
  | 'executing'
  | 'writing'
  | 'reporting'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'cleared';

export interface AgentMoment {
  agentId: string;
  label: string;
  icon?: string;
  status: AgentStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface ToolExecution {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  error?: string;
}

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  parentId: string | null;
  currentThought?: string;
  currentTask?: string;
  currentTools: ToolExecution[];
  currentResponse?: string;
  agentType?: string;
  scene?: string;
  executionMode?: 'acp' | 'in-process';
  streamToUser?: boolean;
  taskType?: 'task' | 'team';
  moment?: AgentMoment;
  multiAgent?: {
    type: string;
    strategy?: string;
    teamName?: string;
    memberId?: string;
    stepIndex?: number;
    totalSteps?: number;
    currentRound?: number;
    maxRounds?: number;
    debateRole?: string;
    goal?: string;
  };
  stats: {
    tokenUsage: { input: number; output: number; cached: number };
    cost: number;
    toolCount: number;
  };
  createdAt: number;
}

export type AgentEvent =
  | { type: 'AGENT_CREATED'; agentId: string; name: string; parentId?: string; agentType?: string; taskType?: 'task' | 'team'; executionMode?: 'acp' | 'in-process'; streamToUser?: boolean; multiAgent?: AgentState['multiAgent'] }
  | { type: 'THINKING_DELTA'; agentId: string; content: string; taskDescription?: string }
  | { type: 'TOOL_START'; agentId: string; toolId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'TOOL_END'; agentId: string; toolId: string; toolName: string; result?: string; isError?: boolean }
  | { type: 'TEXT_DELTA'; agentId: string; text: string }
  | { type: 'SUBAGENT_END'; agentId: string; success: boolean }
  | { type: 'AUTO_SUMMARIZE_START'; agentId: string }
  | { type: 'TASK_FAILED'; agentId: string; error?: string }
  | { type: 'CLEANUP'; agentId: string }
  | { type: 'CLEANUP_COMPLETED_TASKS' };

// ============================================================
// 终态集合
// ============================================================

const TERMINAL_STATUSES: Set<AgentStatus> = new Set(['success', 'failed', 'cancelled', 'cleared']);

function isTerminal(status: AgentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ============================================================
// Zustand Store
// ============================================================

interface AgentStateMachineStore {
  mainAgent: string | null;
  agentMap: Record<string, AgentState>;

  transition: (event: AgentEvent) => void;
  getAgentById: (id: string) => AgentState | undefined;
  findParentId: (id: string) => string | null;
  getCurrentMoments: () => AgentMoment[];
  getDescendantIds: (parentId: string) => string[];
  clearAll: () => void;
}

export const useAgentStateMachine = create<AgentStateMachineStore>((set, get) => ({
  mainAgent: null,
  agentMap: {},

  transition: (event) => {
    set((s) => {
      const next = { ...s.agentMap };
      let main = s.mainAgent;

      // 统一入口：非 AGENT_CREATED 事件，agent 不存在则自动创建（替代 6 处 _promoteSubAgent）
      if (event.type !== 'AGENT_CREATED' && event.type !== 'CLEANUP_COMPLETED_TASKS') {
        const e = event as any;
        if (e.agentId && !next[e.agentId]) {
          const ensured = ensureAgent(next, main, e.agentId, e.agentId);
          Object.assign(next, ensured.agentMap);
          main = ensured.mainAgent;
        }
      }

      // 终态屏障：终态 agent 的非清理事件直接静默忽略
      if (event.type !== 'AGENT_CREATED' && event.type !== 'CLEANUP' && event.type !== 'CLEANUP_COMPLETED_TASKS') {
        const e = event as any;
        if (e.agentId && next[e.agentId] && isTerminal(next[e.agentId].status)) {
          return { agentMap: next, mainAgent: main };
        }
      }

      switch (event.type) {
        case 'AGENT_CREATED':
          return applyAgentCreated(s, next, event);

        case 'THINKING_DELTA':
          return applyThinkingDelta(s, next, event);

        case 'TOOL_START':
          return applyToolStart(s, next, event);

        case 'TOOL_END':
          return applyToolEnd(s, next, event);

        case 'TEXT_DELTA':
          return applyTextDelta(s, next, event);

        case 'SUBAGENT_END':
          return applySubAgentEnd(s, next, event);

        case 'AUTO_SUMMARIZE_START':
          return applyAutoSummarize(s, next, event);

        case 'TASK_FAILED':
          return applyTaskFailed(s, next, event);

        case 'CLEANUP':
          return applyCleanup(s, next, event);

        case 'CLEANUP_COMPLETED_TASKS':
          return applyCleanupCompleted(s, next);

        default:
          return s;
      }
    });
  },

  getAgentById: (id) => get().agentMap[id],

  findParentId: (id) => get().agentMap[id]?.parentId ?? null,

  getCurrentMoments: () =>
    Object.values(get().agentMap)
      .filter((a) => a.moment && !isTerminal(a.status))
      .map((a) => a.moment!),

  getDescendantIds: (parentId) => {
    const result: string[] = [];
    for (const [id, a] of Object.entries(get().agentMap)) {
      if (a.parentId === parentId) {
        result.push(id);
        result.push(...get().getDescendantIds(id));
      }
    }
    return result;
  },

  clearAll: () => set({ mainAgent: null, agentMap: {} }),
}));

// ============================================================
// 事件处理器（纯函数，操作 draft state）
// ============================================================

function ensureAgent(
  agentMap: Record<string, AgentState>,
  mainAgent: string | null,
  agentId: string,
  name?: string,
  parentId?: string,
  options?: { agentType?: string; taskType?: 'task' | 'team'; executionMode?: 'acp' | 'in-process'; streamToUser?: boolean; multiAgent?: AgentState['multiAgent'] },
): { agentMap: Record<string, AgentState>; mainAgent: string | null } {
  if (agentMap[agentId]) return { agentMap, mainAgent };

  const agent: AgentState = {
    id: agentId,
    name: name ?? agentId,
    status: 'pending',
    parentId: parentId ?? null,
    currentTools: [],
    agentType: options?.agentType,
    taskType: options?.taskType,
    executionMode: options?.executionMode,
    streamToUser: options?.streamToUser,
    multiAgent: options?.multiAgent,
    stats: { tokenUsage: { input: 0, output: 0, cached: 0 }, cost: 0, toolCount: 0 },
    createdAt: Date.now(),
  };

  const newMap = { ...agentMap, [agentId]: agent };
  const newMain = mainAgent ?? (parentId ? mainAgent : agentId);
  return { agentMap: newMap, mainAgent: newMain };
}

function updateMoment(agent: AgentState, status: AgentStatus, label?: string, icon?: string): AgentState {
  const momentLabels: Record<string, { label: string; icon?: string }> = {
    pending: { label: '排队中', icon: 'hourglass_empty' },
    thinking: { label: '思考中', icon: 'psychology' },
    executing: { label: '执行中', icon: 'terminal' },
    writing: { label: '输出中', icon: 'edit' },
    reporting: { label: '待汇报', icon: 'summarize' },
    success: { label: '已完成', icon: 'check_circle' },
    failed: { label: '失败', icon: 'error' },
    cancelled: { label: '已取消', icon: 'cancel' },
  };

  const ml = momentLabels[status] ?? { label: label ?? status, icon };
  const prevMoment = agent.moment;

  if (prevMoment && prevMoment.status === status) return agent;

  const moment: AgentMoment = {
    agentId: agent.id,
    label: label ?? ml.label,
    icon: icon ?? ml.icon,
    status,
    startTime: Date.now(),
  };

  // 计算前一个 moment 的 duration
  if (prevMoment && !prevMoment.endTime) {
    prevMoment.endTime = Date.now();
    prevMoment.duration = prevMoment.endTime - prevMoment.startTime;
  }

  return { ...agent, moment };
}

// ── 各事件处理 ──

function applyAgentCreated(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'AGENT_CREATED' },
): Partial<AgentStateMachineStore> {
  const result = ensureAgent(next, s.mainAgent, event.agentId, event.name, event.parentId, {
    agentType: event.agentType,
    taskType: event.taskType,
    executionMode: event.executionMode,
    streamToUser: event.streamToUser,
    multiAgent: event.multiAgent,
  });

  if (event.parentId && next[event.parentId]) {
    const parent = { ...next[event.parentId] };
    if (parent.status === 'pending') {
      parent.status = 'thinking';
      next[event.parentId] = parent;
    }
  }

  return { agentMap: result.agentMap, mainAgent: result.mainAgent };
}

function applyThinkingDelta(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'THINKING_DELTA' },
): Partial<AgentStateMachineStore> {
  const agent = { ...next[event.agentId] };

  // pending → thinking（ensureAgent 已在 transition 入口完成）
  if (agent.status === 'pending') {
    Object.assign(agent, updateMoment(agent, 'thinking'));
    agent.status = 'thinking';
  }

  agent.currentThought = (agent.currentThought ?? '') + event.content;
  next[event.agentId] = agent;
  return { agentMap: next };
}

function applyToolStart(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'TOOL_START' },
): Partial<AgentStateMachineStore> {
  const agent = { ...next[event.agentId] };

  // 去重
  if (agent.currentTools.some((t) => t.id === event.toolId)) {
    return { agentMap: next };
  }

  const tool: ToolExecution = {
    id: event.toolId,
    name: event.toolName,
    input: event.toolInput,
    status: 'running',
    startTime: Date.now(),
  };

  agent.currentTools = [...agent.currentTools, tool];
  agent.status = 'executing';
  Object.assign(agent, updateMoment(agent, 'executing', event.toolName, 'terminal'));

  next[event.agentId] = agent;
  return { agentMap: next };
}

function applyToolEnd(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'TOOL_END' },
): Partial<AgentStateMachineStore> {
  const agent = next[event.agentId];
  if (!agent) return s;

  const updatedTools = agent.currentTools.map((t) =>
    t.id === event.toolId
      ? { ...t, status: event.isError ? ('error' as const) : ('success' as const), output: event.result, endTime: Date.now() }
      : t,
  );

  // 检查是否存在指定工具
  const hasTool = agent.currentTools.some((t) => t.id === event.toolId);
  if (!hasTool) return s;

  const allDone = updatedTools.every((t) => t.status === 'success' || t.status === 'error');
  const newStatus: AgentStatus = allDone ? 'thinking' : agent.status;

  const updated = {
    ...agent,
    currentTools: updatedTools,
    status: newStatus,
    stats: { ...agent.stats, toolCount: agent.stats.toolCount + 1 },
  };

  if (allDone) {
    Object.assign(updated, updateMoment(updated, 'thinking'));
  }

  next[event.agentId] = updated;

  // 通知 AsyncTaskStore（如果这是 task/team 的子 agent tool-end）
  if (updated.taskType) {
    storeEventBus.emit('agent:tool-end-completed', { agentId: event.agentId, toolName: event.toolName });
  }

  return { agentMap: next };
}

function applyTextDelta(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'TEXT_DELTA' },
): Partial<AgentStateMachineStore> {
  const agent = { ...next[event.agentId] };

  agent.status = 'writing';
  agent.currentResponse = (agent.currentResponse ?? '') + event.text;
  Object.assign(agent, updateMoment(agent, 'writing'));

  next[event.agentId] = agent;
  return { agentMap: next };
}

function applySubAgentEnd(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'SUBAGENT_END' },
): Partial<AgentStateMachineStore> {
  const agent = next[event.agentId];
  if (!agent) return s;

  if (isTerminal(agent.status)) return s;

  const newStatus: AgentStatus = event.success ? 'reporting' : 'failed';
  const updated = { ...agent, status: newStatus };
  Object.assign(updated, updateMoment(updated, newStatus));

  next[event.agentId] = updated;

  // 通知 EventBus：agent 进入终态
  storeEventBus.emit('agent:terminal', {
    agentId: event.agentId,
    from: agent.status,
    to: newStatus,
  });

  return { agentMap: next };
}

function applyAutoSummarize(
  _s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'AUTO_SUMMARIZE_START' },
): Partial<AgentStateMachineStore> {
  const agent = next[event.agentId];
  if (!agent) return _s;

  if (agent.status === 'success' || agent.status === 'failed') {
    const updated = { ...agent, status: 'cleared' as AgentStatus };
    next[event.agentId] = updated;
  }

  return { agentMap: next };
}

function applyTaskFailed(
  s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'TASK_FAILED' },
): Partial<AgentStateMachineStore> {
  const agent = next[event.agentId];
  if (!agent) return s;

  if (isTerminal(agent.status)) return s;

  const updated = { ...agent, status: 'failed' as AgentStatus };
  Object.assign(updated, updateMoment(updated, 'failed', event.error ?? '执行失败', 'error'));

  next[event.agentId] = updated;

  storeEventBus.emit('agent:terminal', { agentId: event.agentId, from: agent.status, to: 'failed' });

  return { agentMap: next };
}

function applyCleanup(
  _s: AgentStateMachineStore,
  next: Record<string, AgentState>,
  event: AgentEvent & { type: 'CLEANUP' },
): Partial<AgentStateMachineStore> {
  const agent = next[event.agentId];
  if (!agent) return _s;

  const updated = { ...agent, status: 'cleared' as AgentStatus, currentTools: [], currentThought: undefined };
  next[event.agentId] = updated;

  return { agentMap: next };
}

function applyCleanupCompleted(
  _s: AgentStateMachineStore,
  next: Record<string, AgentState>,
): Partial<AgentStateMachineStore> {
  for (const [id, agent] of Object.entries(next)) {
    if (agent.status === 'success' || agent.status === 'failed' || agent.status === 'cancelled') {
      next[id] = { ...agent, status: 'cleared' };
    }
  }
  return { agentMap: next };
}
