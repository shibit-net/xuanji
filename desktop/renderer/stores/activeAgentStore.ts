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

export type AgentStatus = 'idle' | 'pending' | 'thinking' | 'executing' | 'responding' | 'success' | 'failed' | 'done';

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

  // 🔧 当前任务描述（团队成员专用）
  currentTask?: string;

  // 当前执行的工具
  currentTools: ToolExecution[];

  // 当前回复内容
  currentResponse?: string;

  // 子 Agent
  subAgents: AgentState[];

  // Agent 类型标识
  agentType?: 'builtin' | 'preset' | 'custom' | 'temporary';

  // 场景类型
  scene?: string;

  // 执行模式：ACP 隔离进程 / 主进程内联
  executionMode?: 'acp' | 'in-process';

  // 🔧 输出模式：是否直接输出到用户对话框
  streamToUser?: boolean;

  // Multi-Agent 扩展字段
  multiAgent?: {
    type: 'orchestrate' | 'pipeline' | 'quick_team' | 'agent_team' | 'delegate';
    strategy?: string;
    teamName?: string;
    parentId?: string;
    /** 稳定的成员标识符（用于布局引擎位置缓存键） */
    memberId?: string;
    stepIndex?: number;
    totalSteps?: number;
    subagentType?: string;
    // Debate 策略专用
    currentRound?: number;
    maxRounds?: number;
    /** 辩论角色：正方/反方/裁判 */
    debateRole?: 'affirmative' | 'negative' | 'judge';
    /** 团队目标/辩论主题 */
    goal?: string;
  };

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
  /** 当前正在执行的 Agent ID（主 Agent 或某个 SubAgent） */
  currentActiveAgentId: string | null;

  // ========== Agent 管理 ==========
  startMainAgent: (name: string, agentId?: string) => void;
  finishMainAgent: () => void;
  resetAll: () => void;
  setCurrentActiveAgent: (agentId: string | null) => void;

  // ========== 状态更新 ==========
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  findAgentById: (agentId: string) => AgentState | null;
  setAgentThought: (agentId: string, thought: string) => void;
  getAgentThought: (agentId: string) => string | undefined;
  setAgentTask: (agentId: string, task: string) => void; // 🔧 新增：设置任务
  addAgentTool: (agentId: string, tool: ToolExecution) => void;
  updateAgentTool: (agentId: string, toolId: string, updates: Partial<ToolExecution>) => void;
  setAgentResponse: (agentId: string, response: string) => void;

  // ========== SubAgent 管理 ==========
  addSubAgent: (parentId: string, subAgent: AgentState, insertIndex?: number) => void;
  removeSubAgent: (parentId: string, subAgentId: string) => void;
  /** 原子替换：删除旧节点 + 插入新节点，单次 set() 调用消除渲染间隙 */
  replaceSubAgent: (parentId: string, staleSubAgentId: string | null, newSubAgent: AgentState, insertIndex?: number) => void;
  /** 直接设置 mainAgent（用于直接操作树后的更新） */
  setMainAgent: (agent: AgentState | null) => void;
  /** 按 ID 递归查找并更新子 Agent */
  updateSubAgent: (subAgentId: string, updates: Partial<AgentState>) => void;
  /** 更新 Agent 的 agentType */
  updateAgentType: (agentId: string, agentType: string) => void;

  // ========== 统计更新 ==========
  updateAgentStats: (agentId: string, stats: Partial<AgentState['stats']>) => void;

  // ========== Multi-Agent 信息更新 ==========
  updateAgentMultiAgent: (agentId: string, updates: Partial<AgentState['multiAgent']>) => void;
}

// ========== 辅助函数：递归查找和更新 Agent ==========
// 返回 null 表示「未找到目标」或「无任何变更」，调用方应跳过 set()
function updateAgentInTree(agent: AgentState | null, agentId: string, updater: (agent: AgentState) => AgentState): AgentState | null {
  if (!agent) return null;

  if (agent.id === agentId) {
    const updated = updater(agent);
    // 如果 updater 返回了同一个引用，说明没有实际变更，返回 null 阻止向上传播
    if (updated === agent) return null;
    return updated;
  }

  let changed = false;
  const newSubAgents = agent.subAgents.map(sub => {
    const result = updateAgentInTree(sub, agentId, updater);
    if (result === null) return sub; // 该分支无变更，保留原引用
    changed = true;
    return result;
  });

  if (!changed) return null; // 所有子分支均无变更，返回 null 阻止 set()
  return { ...agent, subAgents: newSubAgents };
}

// ========== Store 实现 ==========

export const useActiveAgentStore = create<ActiveAgentStore>((set, get) => ({
  mainAgent: null,
  currentActiveAgentId: null,

  // ========== Agent 管理 ==========

  startMainAgent: (name: string, agentId?: string) => {
    const agent: AgentState = {
      id: agentId || 'xuanji', // 🔧 使用传入的 agentId，默认为 'xuanji'
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

    set({ mainAgent: agent, currentActiveAgentId: agent.id });
  },

  setCurrentActiveAgent: (agentId) => {
    set({ currentActiveAgentId: agentId });
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
      // 当 agent 完成/失败时，清空临时状态
      // 失败/辩论模式下保留 currentThought：失败原因在思考气泡中展示
      ...(status === 'done' || status === 'success' || status === 'failed' ? {
        currentThought: (status === 'failed' || agent.multiAgent?.strategy === 'debate')
          ? agent.currentThought
          : undefined,
        currentTools: [],
      } : {}),
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  findAgentById: (agentId: string) => {
    const { mainAgent } = get();
    const find = (agent: AgentState | null): AgentState | null => {
      if (!agent) return null;
      if (agent.id === agentId) return agent;
      if (agent.subAgents) {
        for (const sub of agent.subAgents) {
          const found = find(sub);
          if (found) return found;
        }
      }
      return null;
    };
    return find(mainAgent);
  },

  setAgentThought: (agentId: string, thought: string) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => {
      // 清空思考内容（汇报阶段）：始终允许，不回退状态
      if (!thought) {
        return { ...agent, currentThought: '' };
      }

      // 终态保护：agent 已结束时不再累加思考内容，也不再回退状态
      const finalStatuses: AgentStatus[] = ['done', 'success', 'failed'];
      if (finalStatuses.includes(agent.status)) return agent;

      return {
        ...agent,
        currentThought: thought,
        status: 'thinking',
      };
    });

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  getAgentThought: (agentId: string) => {
    const { mainAgent } = get();
    const findThought = (agent: AgentState | null): string | undefined => {
      if (!agent) return undefined;
      if (agent.id === agentId) return agent.currentThought;
      if (agent.subAgents) {
        for (const sub of agent.subAgents) {
          const found = findThought(sub);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };
    return findThought(mainAgent);
  },

  setAgentTask: (agentId: string, task: string) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      currentTask: task,
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },

  addAgentTool: (agentId: string, tool: ToolExecution) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => {
      // 终态保护：agent 已结束时拒绝添加工具，防止延迟事件覆盖最终状态
      const finalStatuses: AgentStatus[] = ['done', 'success', 'failed'];
      if (finalStatuses.includes(agent.status)) return agent;

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
      // 终态保护：agent 已结束时拒绝更新工具，防止延迟事件覆盖最终状态
      const finalStatuses: AgentStatus[] = ['done', 'success', 'failed'];
      if (finalStatuses.includes(agent.status)) return agent;

      const toolIndex = agent.currentTools.findIndex(t => t.id === toolId);
      if (toolIndex === -1) return agent;

      // 如果工具完成（success 或 error），从 currentTools 中移除
      // 只保留正在运行的工具
      if (updates.status === 'success' || updates.status === 'error') {
        const updatedTools = agent.currentTools.filter(t => t.id !== toolId);
        return {
          ...agent,
          currentTools: updatedTools,
          // 工具执行完后回到思考状态，而不是 idle（防止 isActiveOrHasActiveChild 过滤掉节点）
          status: updatedTools.length === 0 ? 'thinking' : agent.status,
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

  addSubAgent: (parentId: string, subAgent: AgentState, insertIndex?: number) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, parentId, (agent) => {

      // 🔧 检查是否已存在相同 ID 的子 agent
      const existingIndex = agent.subAgents.findIndex(sub => sub.id === subAgent.id);
      if (existingIndex !== -1) {
        return agent; // 不做修改
      }

      // 🔧 支持指定插入位置（替换旧节点时保持原位）
      const newSubAgents = [...agent.subAgents];
      if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= newSubAgents.length) {
        newSubAgents.splice(insertIndex, 0, subAgent);
      } else {
        newSubAgents.push(subAgent);
      }

      return {
        ...agent,
        subAgents: newSubAgents,
      };
    });

    if (updated) {
      set({ mainAgent: updated });
    } else {
      console.warn('[activeAgentStore] ⚠️ 未找到父 agent，无法添加子 agent. parentId:', parentId, 'mainAgent.id:', mainAgent?.id);
    }
  },

  removeSubAgent: (parentId: string, subAgentId: string) => {
    const { mainAgent } = get();

    // 🔴 写入磁盘日志文件 ~/.xuanji/logs/debug-remove-agent.log
    const stack = new Error().stack || '';
    window.electron?.debugLog(`removeSubAgent id=${subAgentId} parent=${parentId}\n${stack}`);

    const updated = updateAgentInTree(mainAgent, parentId, (agent) => {
      const filtered = agent.subAgents.filter(sub => sub.id !== subAgentId);
      return {
        ...agent,
        subAgents: filtered,
      };
    });

    if (updated) {
      set({ mainAgent: updated });
    } else {
      console.warn('[activeAgentStore] ⚠️ removeSubAgent 失败：未找到父 agent');
    }
  },

  /** 原子替换：删除旧节点 + 插入新节点，单次 set() 调用消除渲染间隙 */
  replaceSubAgent: (parentId: string, staleSubAgentId: string | null, newSubAgent: AgentState, insertIndex?: number) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, parentId, (agent) => {
      // 过滤掉旧的 subAgent（如果提供了 staleId）
      let filtered = agent.subAgents;
      if (staleSubAgentId) {
        const staleIdx = filtered.findIndex(sub => sub.id === staleSubAgentId);
        if (staleIdx !== -1) {
          filtered = [...filtered.slice(0, staleIdx), ...filtered.slice(staleIdx + 1)];
          // 保留原位：若未指定 insertIndex，使用旧节点位置
          if (insertIndex === undefined) {
            insertIndex = staleIdx;
          }
        }
      }

      // 避免重复添加
      if (filtered.find(sub => sub.id === newSubAgent.id)) {
        return { ...agent, subAgents: filtered };
      }

      // 在指定位置插入新节点
      const newSubAgents = insertIndex !== undefined && insertIndex >= 0
        ? [...filtered.slice(0, insertIndex), newSubAgent, ...filtered.slice(insertIndex)]
        : [...filtered, newSubAgent];

      return { ...agent, subAgents: newSubAgents };
    });

    if (updated) {
      set({ mainAgent: updated });
    } else {
      console.warn('[activeAgentStore] ⚠️ replaceSubAgent 失败：未找到父 agent');
    }
  },

  setMainAgent: (agent: AgentState | null) => {
    set({ mainAgent: agent });
  },

  updateSubAgent: (subAgentId: string, updates: Partial<AgentState>) => {
    const { mainAgent } = get();
    const updated = updateAgentInTree(mainAgent, subAgentId, (agent) => ({
      ...agent,
      ...updates,
    }));
    if (updated) {
      set({ mainAgent: updated });
    }
  },

  updateAgentType: (agentId: string, agentType: string) => {
    const { mainAgent } = get();
    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      agentType: agentType as AgentState['agentType'],
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

  // ========== Multi-Agent 信息更新 ==========

  updateAgentMultiAgent: (agentId: string, updates: Partial<AgentState['multiAgent']>) => {
    const { mainAgent } = get();

    const updated = updateAgentInTree(mainAgent, agentId, (agent) => ({
      ...agent,
      multiAgent: {
        ...agent.multiAgent,
        ...updates,
      } as AgentState['multiAgent'],
    }));

    if (updated) {
      set({ mainAgent: updated });
    }
  },
}));
