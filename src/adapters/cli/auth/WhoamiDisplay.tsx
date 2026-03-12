// ============================================================
// /whoami 命令 — 显示当前用户信息
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getTheme } from '../Theme';
import type { AuthManager } from '@/auth';
import type { UserInfo } from '@/auth/types';

export interface WhoamiDisplayProps {
  authManager: AuthManager;
  onComplete: () => void;
}

export function WhoamiDisplay({ authManager, onComplete }: WhoamiDisplayProps) {
  const theme = getTheme();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!authManager.isAuthenticated()) {
        if (!cancelled) {
          setLoading(false);
          setError('未登录。使用 /login 登录 Shibit 账号。');
          onComplete();
        }
        return;
      }

      try {
        const info = await authManager.getCurrentUser();
        if (!cancelled) {
          setUser(info);
          setLoading(false);
          onComplete();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
          onComplete();
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authManager, onComplete]);

  if (loading) {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text color={theme.primary}>获取用户信息...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text color="yellow">{error}</Text>
      </Box>
    );
  }

  if (!user) {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text color="yellow">未登录。使用 /login 登录 Shibit 账号。</Text>
      </Box>
    );
  }

  const maskedApiKey = user.apiKey
    ? `${user.apiKey.slice(0, 10)}****${user.apiKey.slice(-4)}`
    : '未配置';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.primary}
      paddingX={1}
      marginTop={1}
    >
      <Text color={theme.primary} bold>用户信息</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>  用户名:  {user.username}</Text>
        <Text>  邮箱:    {user.email}</Text>
        <Text>  角色:    {user.role}</Text>
        <Text>  余额:    ¥{(user.balance / 100).toFixed(2)}</Text>
        <Text>  API Key: {maskedApiKey}</Text>
      </Box>
    </Box>
  );
}
