// ============================================================
// useSessionManager - 会话管理 Hook
// ============================================================

import { useState, useEffect } from 'react';
import type { SessionListItem } from '../global';

export function useSessionManager() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.sessionList();
      if (result.success && result.sessions) {
        setSessions(result.sessions);
      } else {
        setError(result.error || '加载会话列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话列表失败');
    } finally {
      setLoading(false);
    }
  };

  const saveSession = async (name?: string, historyMessages?: Array<{ role: string; content: string; timestamp: number }>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.sessionSave({ name, options: { historyMessages } });
      if (result.success) {
        await loadSessions();
        return result.sessionId;
      } else {
        setError(result.error || '保存会话失败');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存会话失败');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const resumeSession = async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.sessionResume({ sessionId });
      if (result.success) {
        return {
          sessionId: result.sessionId,
          historyMessages: result.historyMessages || [],
          usage: result.usage,
          messageCount: result.messageCount || 0,
        };
      } else {
        setError(result.error || '恢复会话失败');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复会话失败');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.sessionDelete({ sessionId });
      if (result.success) {
        await loadSessions();
        return true;
      } else {
        setError(result.error || '删除会话失败');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  return {
    sessions,
    loading,
    error,
    loadSessions,
    saveSession,
    resumeSession,
    deleteSession,
  };
}
