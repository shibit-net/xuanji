// ============================================================
// ExecutionStore - Agent TODO 状态管理
// ============================================================
// 职责：管理 TODO 列表和进度
// 数据来源：messageStore 从 tool 回调中解析 TODO_PROGRESS 并写入
// ============================================================

import { create } from 'zustand';

// ========== TODO 项 ==========
export interface TodoItem {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  activeForm?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ========== Store 接口 ==========
interface ExecutionStore {
  todos: TodoItem[];

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
  replaceTodos: (todos: TodoItem[]) => void;

  reset: () => void;
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  todos: [],

  addTodo: (data) => {
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

  reset: () => {
    set({ todos: [] });
  },

  replaceTodos: (todos) => {
    set({ todos });
  },
}));
