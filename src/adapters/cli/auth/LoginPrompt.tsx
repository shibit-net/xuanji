// ============================================================
// 交互式登录界面（优化版）
// ============================================================

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from '../Theme';
import type { AuthManager } from '@/auth';
import type { UserInfo } from '@/auth/types';

export interface LoginPromptProps {
  authManager: AuthManager;
  /** 预填邮箱 */
  initialEmail?: string;
  /** 登录完成回调 */
  onComplete: (result: { success: boolean; user?: UserInfo; error?: string }) => void;
}

type Stage = 'email' | 'password' | 'loading' | 'done';

export function LoginPrompt({ authManager, initialEmail, onComplete }: LoginPromptProps) {
  const theme = getTheme();
  const [stage, setStage] = useState<Stage>(initialEmail ? 'password' : 'email');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [cursorPos, setCursorPos] = useState(initialEmail ? 0 : 0);
  const [error, setError] = useState('');
  const [successUser, setSuccessUser] = useState<UserInfo | null>(null);

  const handleSubmit = useCallback(async (emailVal: string, passwordVal: string) => {
    setStage('loading');
    setError('');
    try {
      const user = await authManager.login(emailVal, passwordVal);
      setSuccessUser(user);
      setStage('done');
      // 短暂显示成功后回调
      setTimeout(() => onComplete({ success: true, user }), 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStage('password');
      setPassword('');
      setCursorPos(0);
    }
  }, [authManager, onComplete]);

  useInput((ch, key) => {
    if (stage === 'loading' || stage === 'done') return;

    const isEmailStage = stage === 'email';
    const currentValue = isEmailStage ? email : password;
    const setValue = isEmailStage ? setEmail : setPassword;

    // Esc 取消
    if (key.escape) {
      onComplete({ success: false, error: '取消登录' });
      return;
    }

    // 密码阶段：Ctrl+← 回到邮箱阶段
    if (stage === 'password' && key.backspace && password.length === 0) {
      setStage('email');
      setCursorPos(email.length);
      setError('');
      return;
    }

    // Enter 确认
    if (key.return) {
      if (isEmailStage) {
        const trimmed = email.trim();
        if (!trimmed) return;
        // 简单邮箱格式校验
        if (!trimmed.includes('@')) {
          setError('请输入有效的邮箱地址');
          return;
        }
        setError('');
        setStage('password');
        setCursorPos(0);
      } else {
        if (!password) return;
        handleSubmit(email.trim(), password);
      }
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setValue(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(p => p - 1);
      }
      return;
    }

    // 光标移动
    if (key.leftArrow) { setCursorPos(p => Math.max(0, p - 1)); return; }
    if (key.rightArrow) { setCursorPos(p => Math.min(currentValue.length, p + 1)); return; }

    // 字符输入
    if (ch && !key.ctrl && !key.meta) {
      setValue(prev => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos(p => p + ch.length);
    }
  });

  // ── 登录成功 ──
  if (stage === 'done' && successUser) {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Box>
          <Text color="green" bold>✓ 登录成功</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">  欢迎回来，</Text>
          <Text bold>{successUser.username}</Text>
        </Box>
      </Box>
    );
  }

  // ── 加载中 ──
  if (stage === 'loading') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.primary}
        paddingX={1}
        marginTop={1}
      >
        <Text color={theme.primary} bold>Shibit 账号登录</Text>
        <Box marginTop={1}>
          <Text color="yellow">⠋ 登录中...</Text>
        </Box>
      </Box>
    );
  }

  // ── 输入界面 ──
  const isEmailStage = stage === 'email';
  const currentValue = isEmailStage ? email : password;
  const displayValue = isEmailStage ? currentValue : '●'.repeat(currentValue.length);
  const before = displayValue.slice(0, cursorPos);
  const cursor = displayValue[cursorPos] ?? ' ';
  const after = displayValue.slice(cursorPos + 1);

  // 步骤指示
  const stepLabel = isEmailStage ? '1/2' : '2/2';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.primary}
      paddingX={1}
      marginTop={1}
    >
      {/* 标题 + 步骤 */}
      <Box justifyContent="space-between">
        <Text color={theme.primary} bold>Shibit 账号登录</Text>
        <Text color="gray" dimColor>步骤 {stepLabel}</Text>
      </Box>

      {/* 步骤条 */}
      <Box marginTop={1}>
        <Text color={isEmailStage ? theme.primary : 'green'} bold>
          {isEmailStage ? '● ' : '✓ '}
        </Text>
        <Text color={isEmailStage ? 'white' : 'green'}>邮箱</Text>
        <Text color="gray" dimColor> ─── </Text>
        <Text color={!isEmailStage ? theme.primary : 'gray'} bold>
          {!isEmailStage ? '● ' : '○ '}
        </Text>
        <Text color={!isEmailStage ? 'white' : 'gray'}>密码</Text>
      </Box>

      {/* 错误提示 */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      {/* 密码阶段显示已输入的邮箱 */}
      {stage === 'password' && (
        <Box marginTop={1}>
          <Text color="gray">邮箱: </Text>
          <Text color="green">{email}</Text>
        </Box>
      )}

      {/* 当前输入字段 */}
      <Box marginTop={1}>
        <Text color={theme.primary}>❯ </Text>
        <Text color="gray">{isEmailStage ? '邮箱' : '密码'}: </Text>
        <Text>{before}</Text>
        <Text backgroundColor={theme.primary} color="black">{cursor}</Text>
        <Text>{after}</Text>
      </Box>

      {/* 操作提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {isEmailStage
            ? 'Enter 下一步 · Esc 取消'
            : 'Enter 登录 · Backspace 回到邮箱 · Esc 取消'}
        </Text>
      </Box>
    </Box>
  );
}
