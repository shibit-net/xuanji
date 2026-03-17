// ============================================================
// Xuanji Desktop - 活跃 Agent Store
// ============================================================
// 职责：
// - 管理当前正在工作的 Agent 状态（实时快照）
// - 支持主 Agent 和 SubAgent 的层级结构
// - 不保存历史，只保存当前状态
// ============================================================

import { create } from 'zustand';

// ========== Agent 状态类型 ==========

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'responding' | 'done';

export interface ToolExecution {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'success' | 'error';
  duration?: number;
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;

  // 当前思考内容
  currentThought?: string;

  // 当前执行的工具
  currentTools: ToolExecution[];

  // 当前回复内容
  currentResponse?: string;

  // 子 Agent
  subAgents: AgentState[];

  // 统计
  stats: {
    tokenUsage: {
      input: number;
      output: number;
      cached: number;
    };
    cost: number;
    toolCount: number;
  };
}

// ========== Store 接口 ==========

interface ActiveAgentStore {
  // ========== 状态 ==========
  mainAgent: AgentState | null;

  // ========== Agent 管理 ==========
  startMainAgent: (name: string) => void;
  finishMainAgent: () => void;
  resetAll: () => void;

  // ========== 状态更新 ==========
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  setAgentThought: (agentId: string, thought: string) => void;
  addAgentTool: (agentId: string, tool: ToolExecution) => void;
  updateAgentTool: (agentId: string, toolId: string, updates: Partial<ToolExecution>) => void;
  setAgentResponse: (agentId: string, response: string) => void;

  // ========== SubAgent 管理 ==========
  addSubAgent: (parentId: string, subAgent: AgentState) => void;
  removeSubAgent: (parentId: string, subAgentId: string) => void;

  // ========== 统计更新 ==========
  updateAgentStats: (agentId: string, stats: Partial<AgentState['stats']>) => void;
}

// ========== 辅助函数：递归查找和更新 Agent ==========

function findAgent(agent: AgentState | null, agentId: string): AgentState | null {
  if (!agent) return null;
  if (agent.id === agentId) return agent;

  for (const sub of agent.subAgents) {
    const found = findAgent(sub, agentId);
    if (found) return found;
  }

  return null;
}

function updateAgentInTree(agent: AgentState | null, agentId: string, updater: (agent: AgentState) => AgentState): AgentState | null {
  if (!agent) return null;

  if (agent.id === agentId) {
    return updater(agent);
  }

  return {
    ...agent,
    subAgents: agent.subAgents.map(sub => updateAgentInTree(sub, agentId, updater) || sub),
  };
}

// ========== Store 实现 ==========

export const useActiveAgentStore = create<ActiveAgentStore>((set, get) => ({
  mainAgent: null,

  // ========== Agent 管理 ==========

  startMainAgent: (name: string) => {
    const agent: AgentState = {
      id: `agent-${Date.now()}`,
      name,
      status: 'thinking',
      currentTools: [],
      subAgents: [],
      stats: {
        tokenUsage: { input: 0, output: 0, cached: 0 },
        cost: 0,
        toolCount: 0,
      },
    };

    set({ mainAgent: agent });
  },

  finishMainAgent: () => {
    const { mainAgent } = get();
    if (!mainAgent) return;

    set({
      mainAgent: {
        ...mainAgent,
        status: 'done',
        // 清除临时状态，只保留最终回复和统计
        currentThought: undefined,
        currentTools: [],
      },
    });
  },

  resetAll: () => {
    set({ mainAgent: null });
  },

  // ========== 状态更新 ==========

  setAgentStatus: (agentId: string, status: AgentStatus) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      status,
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  setAgentThought: (agentId: string, thought: string) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      currentThought: thought,
      status: 'thinking',
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  addAgentTool: (agentId: string, tool: ToolExecution) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => {
      // 🔥 防御性检查：避免重复添加相同 ID 的工具
      const exists = agent.currentTools.some(t => t.id === tool.id);
      if (exists) {
        console.warn('[activeAgentStore] 工具已存在，跳过添加:', tool.id, tool.name);
        return agent; // 不修改，返回原 agent
      }

      return {
        ...agent,
        currentTools: [...agent.currentTools, tool],
        status: 'executing',
        stats: {
          ...agent.stats,
          toolCount: agent.stats.toolCount + 1,
        },
      };
    });

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  updateAgentTool: (agentId: string, toolId: string, updates: Partial<ToolExecution>) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => {
      const toolIndex = agent.currentTools.findIndex(t => t.id === toolId);
      if (toolIndex === -1) return agent;

      // 如果工具完成（success 或 error），从 currentTools 中移除
      // 只保留正在运行的工具
      if (updates.status === 'success' || updates.status === 'error') {
        const updatedTools = agent.currentTools.filter(t => t.id !== toolId);
        return {
          ...agent,
          currentTools: updatedTools,
          // 如果没有正在执行的工具了，状态回到 idle
          status: updatedTools.length === 0 ? 'idle' : agent.status,
        };
      }

      // 如果工具还在执行，只更新状态
      const updatedTools = [...agent.currentTools];
      updatedTools[toolIndex] = { ...updatedTools[toolIndex], ...updates };

      return {
        ...agent,
        currentTools: updatedTools,
      };
    });

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  setAgentResponse: (agentId: string, response: string) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      currentResponse: response,
      status: 'responding',
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  // ========== SubAgent 管理 ==========

  addSubAgent: (parentId: string, subAgent: AgentState) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, parentId, (agent) => ({
      ...agent,
      subAgents: [...agent.subAgents, subAgent],
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  removeSubAgent: (parentId: string, subAgentId: string) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, parentId, (agent) => ({
      ...agent,
      subAgents: agent.subAgents.filter(sub => sub.id !== subAgentId),
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  // ========== 统计更新 ==========

  updateAgentStats: (agentId: string, stats: Partial<AgentState['stats']>) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      stats: {
        ...agent.stats,
        ...stats,
        tokenUsage: {
          ...agent.stats.tokenUsage,
          ...(stats.tokenUsage || {}),
        },
      },
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },
}));
