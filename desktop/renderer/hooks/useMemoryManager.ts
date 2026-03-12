// ============================================================
// useMemoryManager - 记忆管理 Hook
// ============================================================

import { useState, useEffect } from 'react';
import type { MemoryEntry } from '../global';

export function useMemoryManager() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const result = await window.electron.memoryStats();
      if (result.success) {
        setStats(result.stats);
      }
    } catch (err) {
      console.error('Load memory stats error:', err);
    }
  };

  const retrieve = async (query: string, options?: any) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.memoryRetrieve({ query, options });
      if (result.success && result.entries) {
        setEntries(result.entries);
      } else {
        setError(result.error || '检索记忆失败');
        setEntries([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '检索记忆失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const clearEntries = () => {
    setEntries([]);
  };

  useEffect(() => {
    loadStats();
  }, []);

  return {
    entries,
    stats,
    loading,
    error,
    retrieve,
    loadStats,
    clearEntries,
  };
}
