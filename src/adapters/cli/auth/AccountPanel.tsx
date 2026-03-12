// ============================================================
// 用户账号面板（交互式按键操作）
// ============================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from '../Theme';
import type { AuthManager } from '@/auth';
import type { UserInfo } from '@/auth/types';

export interface AccountPanelProps {
  authManager: AuthManager;
  onClose: () => void;
  onLogout: () => void;
  onSwitchAccount: () => void;
}

export function AccountPanel({ authManager, onClose, onLogout, onSwitchAccount }: AccountPanelProps) {
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
          setError('未登录');
        }
        return;
      }

      try {
        const info = await authManager.getCurrentUser();
        if (!cancelled) {
          setUser(info);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authManager]);

  useInput((ch, key) => {
    if (loading) return;

    // Esc / Q 关闭面板
    if (key.escape || ch === 'q' || ch === 'Q') {
      onClose();
      return;
    }

    // O 登出
    if (ch === 'o' || ch === 'O') {
      onLogout();
      return;
    }

    // S 切换账号
    if (ch === 's' || ch === 'S') {
      onSwitchAccount();
      return;
    }
  });

  if (loading) {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text color={theme.primary}>⠋ 获取账号信息...</Text>
      </Box>
    );
  }

  // 未登录
  if (!user || error) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={1}
        marginTop={1}
      >
        <Text color="yellow" bold>账号</Text>
        <Box marginTop={1}>
          <Text color="gray">{error || '未登录'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>S 登录 · Esc 关闭</Text>
        </Box>
      </Box>
    );
  }

  const maskedApiKey = user.apiKey
    ? `${user.apiKey.slice(0, 10)}····${user.apiKey.slice(-4)}`
    : '未配置';

  const balanceYuan = (user.balance / 100).toFixed(2);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.primary}
      paddingX={1}
      marginTop={1}
    >
      {/* 标题 */}
      <Box justifyContent="space-between">
        <Text color={theme.primary} bold>账号信息</Text>
        <Text color="green" bold>● 已登录</Text>
      </Box>

      {/* 用户信息 */}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="gray">{'  用户名  '}</Text>
          <Text bold>{user.username}</Text>
        </Box>
        <Box>
          <Text color="gray">{'  邮  箱  '}</Text>
          <Text>{user.email}</Text>
        </Box>
        <Box>
          <Text color="gray">{'  角  色  '}</Text>
          <Text>{user.role}</Text>
        </Box>
        <Box>
          <Text color="gray">{'  余  额  '}</Text>
          <Text color={Number(balanceYuan) > 0 ? 'green' : 'red'}>¥{balanceYuan}</Text>
        </Box>
        <Box>
          <Text color="gray">{'  API Key  '}</Text>
          <Text dimColor>{maskedApiKey}</Text>
        </Box>
      </Box>

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          S 切换账号 · O 退出登录 · Esc 关闭
        </Text>
      </Box>
    </Box>
  );
}
