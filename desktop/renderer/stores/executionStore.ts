// ============================================================
// ExecutionStore - Agent 执行状态 Store
// ============================================================
// 职责：
// - 管理 Agent 执行树（team/sub agent 层级）
// - 管理工具调用状态
// - 管理 TODO 列表和进度
// ============================================================

import { create } from 'zustand';

// ========== Agent 执行节点 ==========
export interface AgentExecutionNode {
  id: string;
  name: string;
  type: 'main' | 'team' | 'sub-agent';
  status: 'idle' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  children: AgentExecutionNode[];
  currentTask?: string;
  depth: number;
}

// ========== 工具调用记录 ==========
export interface ToolExecution {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  // 扩展：工具分类（用于分组展示）
  category?: 'file' | 'bash' | 'memory' | 'session' | 'permission' | 'agent' | 'other';
}

// ========== TODO 项 ==========
export interface TodoItem {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  activeForm?: string; // "正在做什么"
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ========== 权限交互记录 ==========
export interface PermissionInteraction {
  id: string;
  type: 'permission' | 'plan-review' | 'ask-user';
  status: 'pending' | 'approved' | 'rejected';
  requestTime: number;
  respondTime?: number;
  data: any; // 原始请求数据
  response?: any; // 用户响应
}

// ========== 系统状态 ==========
export interface SystemStatus {
  tokenUsage: {
    input: number;
    output: number;
    cached: number;
  };
  cost: number;
  currentIteration: number;
}

// ========== Store 接口 ==========
interface ExecutionStore {
  // ========== Agent 执行树 ==========
  rootAgent: AgentExecutionNode | null;
  currentAgentPath: string[]; // 当前执行路径 [root, team, sub-agent]

  // ========== 工具调用 ==========
  toolExecutions: ToolExecution[];
  activeTools: Set<string>; // 正在执行的工具 ID

  // ========== TODO 列表 ==========
  todos: TodoItem[];

  // ========== 权限交互 ==========
  permissionInteractions: PermissionInteraction[];
  pendingPermissions: PermissionInteraction[];

  // ========== 系统状态 ==========
  systemStatus: SystemStatus;

  // ========== Agent 操作 ==========
  setRootAgent: (name: string) => void;
  startSubAgent: (data: { subAgentId: string; task: string; depth: number; role: string }) => void;
  endSubAgent: (data: { subAgentId: string; result?: string }) => void;
  updateAgentStatus: (agentId: string, status: AgentExecutionNode['status']) => void;

  // ========== 工具调用操作 ==========
  addToolExecution: (data: {
    id: string;
    name: string;
    agentId?: string;
    input?: Record<string, unknown>;
  }) => void;
  updateToolExecution: (data: {
    id: string;
    result?: string;
    isError?: boolean;
    status?: ToolExecution['status'];
  }) => void;

  // ========== TODO 操作 ==========
  addTodo: (data: {
    id: string;
    subject: string;
    description: string;
    activeForm?: string;
  }) => void;
  updateTodo: (data: {
    id: string;
    status?: TodoItem['status'];
    activeForm?: string;
  }) => void;

  // ========== 权限交互操作 ==========
  addPermissionRequest: (data: {
    id: string;
    type: 'permission' | 'plan-review' | 'ask-user';
    data: any;
  }) => void;
  respondPermission: (data: {
    id: string;
    approved: boolean;
    response?: any;
  }) => void;

  // ========== 系统状态操作 ==========
  updateTokenUsage: (usage: Partial<SystemStatus['tokenUsage']>) => void;
  updateCost: (cost: number) => void;
  incrementIteration: () => void;

  // ========== 重置 ==========
  reset: () => void;
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  // ========== 初始状态 ==========
  rootAgent: null,
  currentAgentPath: [],
  toolExecutions: [],
  activeTools: new Set(),
  todos: [],
  permissionInteractions: [],
  pendingPermissions: [],
  systemStatus: {
    tokenUsage: { input: 0, output: 0, cached: 0 },
    cost: 0,
    currentIteration: 0,
  },

  // ========== Agent 操作 ==========
  setRootAgent: (name) => {
    const rootNode: AgentExecutionNode = {
      id: 'root',
      name,
      type: 'main',
      status: 'running',
      startTime: Date.now(),
      children: [],
      depth: 0,
    };

    set({
      rootAgent: rootNode,
      currentAgentPath: ['root'],
    });
  },

  startSubAgent: (data) => {
    const { rootAgent, currentAgentPath } = get();
    if (!rootAgent) return;

    const newNode: AgentExecutionNode = {
      id: data.subAgentId,
      name: data.role || 'Sub Agent',
      type: data.role === 'orchestrator' || data.role === 'team_manager' ? 'team' : 'sub-agent',
      status: 'running',
      startTime: Date.now(),
      children: [],
      currentTask: data.task,
      depth: data.depth,
    };

    // 深拷贝并插入新节点
    const newRoot = JSON.parse(JSON.stringify(rootAgent)) as AgentExecutionNode;
    const parentPath = currentAgentPath.slice(0, -1);
    let parent = newRoot;

    for (const id of parentPath.slice(1)) {
      const child = parent.children.find((c) => c.id === id);
      if (child) parent = child;
    }

    parent.children.push(newNode);

    set({
      rootAgent: newRoot,
      currentAgentPath: [...parentPath, parent.id, newNode.id],
    });
  },

  endSubAgent: (data) => {
    const { rootAgent } = get();
    if (!rootAgent) return;

    const newRoot = JSON.parse(JSON.stringify(rootAgent)) as AgentExecutionNode;
    const findAndUpdate = (node: AgentExecutionNode): boolean => {
      if (node.id === data.subAgentId) {
        node.status = data.result ? 'completed' : 'failed';
        node.endTime = Date.now();
        return true;
      }
      for (const child of node.children) {
        if (findAndUpdate(child)) return true;
      }
      return false;
    };

    findAndUpdate(newRoot);
    set({ rootAgent: newRoot });
  },

  updateAgentStatus: (agentId, status) => {
    const { rootAgent } = get();
    if (!rootAgent) return;

    const newRoot = JSON.parse(JSON.stringify(rootAgent)) as AgentExecutionNode;
    const findAndUpdate = (node: AgentExecutionNode): boolean => {
      if (node.id === agentId) {
        node.status = status;
        if (status === 'completed' || status === 'failed') {
          node.endTime = Date.now();
        }
        return true;
      }
      for (const child of node.children) {
        if (findAndUpdate(child)) return true;
      }
      return false;
    };

    findAndUpdate(newRoot);
    set({ rootAgent: newRoot });
  },

  // ========== 工具调用操作 ==========
  addToolExecution: (data) => {
    const { currentAgentPath, rootAgent } = get();
    const currentAgentId = currentAgentPath[currentAgentPath.length - 1] || 'root';

    // 查找当前 Agent 名称
    let agentName = 'Main Agent';
    if (rootAgent) {
      const findNode = (node: AgentExecutionNode, id: string): AgentExecutionNode | null => {
        if (node.id === id) return node;
        for (const child of node.children) {
          const found = findNode(child, id);
          if (found) return found;
        }
        return null;
      };
      const currentNode = findNode(rootAgent, currentAgentId);
      if (currentNode) agentName = currentNode.name;
    }

    // 推断工具分类
    const category = inferToolCategory(data.name);

    const execution: ToolExecution = {
      id: data.id,
      name: data.name,
      agentId: data.agentId || currentAgentId,
      agentName,
      status: 'running',
      startTime: Date.now(),
      input: data.input,
      category,
    };

    set((state) => ({
      toolExecutions: [...state.toolExecutions, execution],
      activeTools: new Set([...state.activeTools, data.id]),
    }));
  },

  updateToolExecution: (data) => {
    set((state) => {
      const updated = state.toolExecutions.map((tool) => {
        if (tool.id === data.id) {
          const endTime = data.status === 'success' || data.status === 'error'
            ? Date.now()
            : tool.endTime;

          return {
            ...tool,
            status: data.status ?? tool.status,
            result: data.result ?? tool.result,
            isError: data.isError ?? tool.isError,
            endTime,
            duration: endTime ? endTime - tool.startTime : undefined,
          };
        }
        return tool;
      });

      const activeTools = new Set(state.activeTools);
      if (data.status === 'success' || data.status === 'error') {
        activeTools.delete(data.id);
      }

      return {
        toolExecutions: updated,
        activeTools,
      };
    });
  },

  // ========== TODO 操作 ==========
  addTodo: (data) => {
    // 🔥 防御性检查：避免重复添加相同 ID 的任务
    const exists = get().todos.some(t => t.id === data.id);
    if (exists) {
      console.warn('[executionStore] TODO 已存在，跳过添加:', data.id, data.subject);
      return;
    }

    const todo: TodoItem = {
      id: data.id,
      subject: data.subject,
      description: data.description,
      activeForm: data.activeForm,
      status: 'pending',
      createdAt: Date.now(),
    };

    set((state) => ({
      todos: [...state.todos, todo],
    }));
  },

  updateTodo: (data) => {
    const currentTodos = get().todos;

    set((state) => ({
      todos: state.todos.map((todo) => {
        if (todo.id === data.id) {
          const updated = { ...todo };

          if (data.status) {
            updated.status = data.status;

            if (data.status === 'in_progress' && !todo.startedAt) {
              updated.startedAt = Date.now();
            } else if ((data.status === 'completed' || data.status === 'failed') && !todo.completedAt) {
              updated.completedAt = Date.now();
            }
          }

          if (data.activeForm !== undefined) {
            updated.activeForm = data.activeForm;
          }

          return updated;
        }
        return todo;
      }),
    }));

  },

  // ========== 权限交互操作 ==========
  addPermissionRequest: (data) => {
    const interaction: PermissionInteraction = {
      id: data.id,
      type: data.type,
      status: 'pending',
      requestTime: Date.now(),
      data: data.data,
    };

    set((state) => ({
      permissionInteractions: [...state.permissionInteractions, interaction],
      pendingPermissions: [...state.pendingPermissions, interaction],
    }));
  },

  respondPermission: (data) => {
    set((state) => ({
      permissionInteractions: state.permissionInteractions.map((p) =>
        p.id === data.id
          ? {
              ...p,
              status: data.approved ? 'approved' : 'rejected',
              respondTime: Date.now(),
              response: data.response,
            }
          : p
      ),
      pendingPermissions: state.pendingPermissions.filter((p) => p.id !== data.id),
    }));
  },

  // ========== 系统状态操作 ==========
  updateTokenUsage: (usage) => {
    set((state) => ({
      systemStatus: {
        ...state.systemStatus,
        tokenUsage: {
          ...state.systemStatus.tokenUsage,
          ...usage,
        },
      },
    }));
  },

  updateCost: (cost) => {
    set((state) => ({
      systemStatus: {
        ...state.systemStatus,
        cost: state.systemStatus.cost + cost,
      },
    }));
  },

  incrementIteration: () => {
    set((state) => ({
      systemStatus: {
        ...state.systemStatus,
        currentIteration: state.systemStatus.currentIteration + 1,
      },
    }));
  },

  // ========== 重置 ==========
  reset: () => {
    set({
      rootAgent: null,
      currentAgentPath: [],
      toolExecutions: [],
      activeTools: new Set(),
      todos: [],
      permissionInteractions: [],
      pendingPermissions: [],
      systemStatus: {
        tokenUsage: { input: 0, output: 0, cached: 0 },
        cost: 0,
        currentIteration: 0,
      },
    });
  },
}));

// ========== 工具分类推断 ==========
function inferToolCategory(toolName: string): ToolExecution['category'] {
  // 文件操作
  if (/^(Read|Write|Edit|MultiEdit|Glob|Grep|LS|NotebookEdit)$/i.test(toolName)) {
    return 'file';
  }

  // Bash命令
  if (/^(Bash|TaskOutput)$/i.test(toolName)) {
    return 'bash';
  }

  // 记忆管理
  if (/^(MemoryStore|MemorySearch)$/i.test(toolName)) {
    return 'memory';
  }

  // 会话管理
  if (/^(ExitPlanMode|EnterPlanMode|Worktree)$/i.test(toolName)) {
    return 'session';
  }

  // 权限交互
  if (/^(AskUser|PlanReview)$/i.test(toolName)) {
    return 'permission';
  }

  // Agent管理
  if (/^(QuickTeam|Orchestrate|Pipeline|Delegate|MatchAgent|ListAgents|TodoList|TodoUpdate|TodoStorage)$/i.test(toolName)) {
    return 'agent';
  }

  // 其他
  return 'other';
}
