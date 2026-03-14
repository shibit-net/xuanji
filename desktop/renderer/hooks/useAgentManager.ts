// ============================================================
// useAgentManager - Agent 管理 Hook
// ============================================================

import { useState, useEffect } from 'react';

export interface UseAgentManagerReturn {
  agents: any[];
  loading: boolean;
  error: string | null;
  createAgent: (config: any) => Promise<{ success: boolean; error?: string }>;
  updateAgent: (agentId: string, config: any) => Promise<{ success: boolean; error?: string }>;
  deleteAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  reload: () => Promise<void>;
}

/**
 * Agent 管理 Hook
 *
 * 封装 Agent CRUD 操作
 */
export function useAgentManager(): UseAgentManagerReturn {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载 Agent 列表
  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.agentList();
      if (result.success) {
        setAgents(result.agents || []);
      } else {
        setError(result.error || '加载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 创建 Agent
  const createAgent = async (config: any) => {
    try {
      const result = await window.electron.agentCreate({ config });
      if (result.success) {
        await loadAgents(); // 重新加载列表
      }
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // 更新 Agent
  const updateAgent = async (agentId: string, config: any) => {
    try {
      const result = await window.electron.agentUpdate({ agentId, config });
      if (result.success) {
        await loadAgents(); // 重新加载列表
      }
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // 删除 Agent
  const deleteAgent = async (agentId: string) => {
    try {
      const result = await window.electron.agentDelete({ agentId });
      if (result.success) {
        await loadAgents(); // 重新加载列表
      }
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // 初始化时加载 Agent 列表
  useEffect(() => {
    loadAgents();
  }, []);

  return {
    agents,
    loading,
    error,
    createAgent,
    updateAgent,
    deleteAgent,
    reload: loadAgents,
  };
}
