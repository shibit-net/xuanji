// ============================================================
// useCheckpointManager - Checkpoint 管理 Hook
// ============================================================

import { useState, useEffect } from 'react';
import type { CheckpointItem } from '../global';

export function useCheckpointManager() {
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCheckpoints = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.checkpointList();
      if (result.success && result.checkpoints) {
        setCheckpoints(result.checkpoints);
      } else {
        setError(result.error || '加载 checkpoint 列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 checkpoint 列表失败');
    } finally {
      setLoading(false);
    }
  };

  const createCheckpoint = async (label?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.checkpointCreate({ label });
      if (result.success) {
        await loadCheckpoints();
        return result.checkpointId;
      } else {
        setError(result.error || '创建 checkpoint 失败');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建 checkpoint 失败');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const rewindToCheckpoint = async (checkpointId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.checkpointRewind({ checkpointId });
      if (result.success) {
        await loadCheckpoints();
        return result.messageCount;
      } else {
        setError(result.error || '回滚到 checkpoint 失败');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '回滚到 checkpoint 失败');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCheckpoints();
  }, []);

  return {
    checkpoints,
    loading,
    error,
    loadCheckpoints,
    createCheckpoint,
    rewindToCheckpoint,
  };
}
