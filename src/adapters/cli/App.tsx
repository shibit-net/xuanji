// ============================================================
// M1 终端 UI — App 根组件
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import type { AgentState, TokenUsage, UITheme } from '@/core/types';
import type { AgentCallbacks } from '@/core/agent/AgentLoop';
import { parseSlashCommand } from './SlashCommands';
import { InputHandler } from './InputHandler';
import { Spinner } from './Spinner';
import { ToolDisplay } from './ToolDisplay';
import { StatusBar } from './StatusBar';
import { SettingsMode } from './settings/SettingsMode';
import { LogsMode } from './LogsMode';
import { BotsMode } from './BotsMode';
import { ConfigManager } from './utils/ConfigManager';
import { LogSystem } from './utils/LogSystem';
import { BotManager } from './utils/BotManager';
import { getTheme } from './Theme';
import type { ChatMessage, ToolResultDisplay, CurrentToolState, AppMode } from './types';

// ============================================================
// App 组件属性
// ============================================================

export interface AppProps {
  agentLoop: {
    run: (input: string) => Promise<void>;
    stop: () => void;
    reset: () => void;
    getState: () => AgentState;
    on: (callbacks: AgentCallbacks) => void;
  };
  model: string;
}

// ============================================================
// App 主组件
// ============================================================

export function App({ agentLoop, model }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<AppMode>('chat');
  const [status, setStatus] = useState<'idle' | 'thinking' | 'tool'>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamText, setStreamText] = useState('');
  const [toolResults, setToolResults] = useState<ToolResultDisplay[]>([]);
  const [usage, setUsage] = useState<TokenUsage>({ input: 0, output: 0 });
  const [cost, setCost] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<UITheme>('auto');
  const msgIdRef = useRef(0);
  const toolInfoRef = useRef<Map<string, { startTime: number; input: Record<string, unknown> }>>(new Map());

  // 使用 ref 追踪最新的流式文本和工具结果，避免闭包问题
  const streamTextRef = useRef('');
  const toolResultsRef = useRef<ToolResultDisplay[]>([]);

  // 共享工具实例
  const configManager = useMemo(() => new ConfigManager(), []);
  const logSystem = useMemo(() => new LogSystem(), []);
  const botManager = useMemo(() => new BotManager(logSystem), [logSystem]);

  // 获取当前主题颜色
  const theme = useMemo(() => getTheme(currentTheme), [currentTheme]);

  // 初始化 ConfigManager
  useEffect(() => {
    const init = async () => {
      try {
        const config = await configManager.load();
        setCurrentTheme(config.ui.theme);
        await logSystem.info('System', '璇玑 CLI 已启动');
      } catch (error) {
        // 配置加载失败，使用默认值
      }
    };
    init();
  }, [configManager, logSystem]);

  // Ctrl+C 处理
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (mode !== 'chat') {
        setMode('chat');
        return;
      }
      if (status !== 'idle') {
        agentLoop.stop();
        setStatus('idle');
        setStreamText('');
        toolInfoRef.current.clear();
      } else {
        exit();
      }
    }
  });

  // 注册 AgentLoop 回调
  useEffect(() => {
    agentLoop.on({
      onText: (text: string) => {
        streamTextRef.current += text;
        setStreamText((prev) => prev + text);
      },
      onThinking: (_thinking: string) => {
        setStatus('thinking');
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        setStatus('tool');
        // 记录该工具的开始时间和 input
        toolInfoRef.current.set(id, {
          startTime: Date.now(),
          input,
        });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        // 查找该工具的信息
        const toolInfo = toolInfoRef.current.get(id);
        const startTime = toolInfo?.startTime ?? Date.now();
        const input = toolInfo?.input ?? {};
        const duration = Date.now() - startTime;

        // 删除该工具的信息
        toolInfoRef.current.delete(id);

        // 使用 ref 而不是状态闭包来保存工具结果
        const newToolResult = {
          name,
          input,
          result,
          isError,
          duration,
        };
        toolResultsRef.current.push(newToolResult);

        setToolResults((prev) => [...prev, newToolResult]);
        setStatus('thinking');
      },
      onUsage: (u: TokenUsage) => {
        setUsage((prev) => ({
          input: prev.input + u.input,
          output: prev.output + u.output,
        }));
      },
      onError: (err: Error) => {
        const id = ++msgIdRef.current;
        setMessages((prev) => [...prev, {
          id,
          role: 'system',
          content: `❌ ${err.message}`,
          timestamp: Date.now(),
        }]);
        logSystem.error('Chat', err.message);
        // 停止 loading 状态并清理
        setStatus('idle');
        setStreamText('');
        streamTextRef.current = '';
        setToolResults([]);
        toolResultsRef.current = [];
        toolInfoRef.current.clear();
      },
      onEnd: (state: AgentState) => {
        // 使用 ref 中的值而不是状态闭包中的旧值
        const text = streamTextRef.current;
        const tools = toolResultsRef.current;

        if (text || tools.length > 0) {
          const id = ++msgIdRef.current;
          setMessages((prev) => [...prev, {
            id,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
          }]);
        }

        // 清理状态
        setStreamText('');
        streamTextRef.current = '';
        setToolResults([]);
        toolResultsRef.current = [];
        setStatus('idle');
        setCost(state.cost);
        toolInfoRef.current.clear();
      },
    });
  }, []);

  // 添加系统消息
  const addSystemMessage = useCallback((content: string) => {
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, {
      id,
      role: 'system',
      content,
      timestamp: Date.now(),
    }]);
  }, []);

  // 主题切换
  const cycleTheme = useCallback(async () => {
    const themeOrder: UITheme[] = ['dark', 'light', 'auto'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
    setCurrentTheme(nextTheme);

    try {
      await configManager.save({ ui: { ...configManager.getConfig().ui, theme: nextTheme } });
    } catch {
      // 保存失败不影响内存中的切换
    }

    const themeLabels: Record<UITheme, string> = {
      dark: '深色',
      light: '浅色',
      auto: '自动',
    };
    addSystemMessage(`主题已切换为: ${themeLabels[nextTheme]}`);
    await logSystem.info('Config', `主题切换为 ${nextTheme}`);
  }, [currentTheme, configManager, addSystemMessage, logSystem]);

  // 提交用户输入
  const handleSubmit = useCallback(async (input: string) => {
    // 斜杠命令
    const cmd = parseSlashCommand(input);
    if (cmd) {
      switch (cmd.name) {
        case '/exit':
        case '/quit':
          await logSystem.info('System', '璇玑 CLI 退出');
          exit();
          return;

        case '/clear':
          setMessages([]);
          return;

        case '/reset':
          agentLoop.reset();
          setMessages([]);
          setUsage({ input: 0, output: 0 });
          setCost(0);
          addSystemMessage('会话已重置');
          await logSystem.info('Chat', '会话已重置');
          return;

        case '/cost': {
          const state = agentLoop.getState();
          const costStr = state.cost < 0.01 ? `$${state.cost.toFixed(4)}` : `$${state.cost.toFixed(2)}`;
          addSystemMessage(`Token: ${state.tokenUsage.input + state.tokenUsage.output} | 费用: ${costStr}`);
          return;
        }

        case '/help':
          addSystemMessage([
            '可用命令:',
            '  /help      — 显示帮助信息',
            '  /clear     — 清空对话历史',
            '  /reset     — 重置会话',
            '  /cost      — 显示费用',
            '  /settings  — 进入设置面板',
            '  /logs      — 查看运行日志',
            '  /bots      — 管理 IM 机器人',
            '  /theme     — 切换主题',
            '  /exit      — 退出璇玑',
            '',
            '快捷键:',
            '  Ctrl+C     — 中断运行 / 退出模式',
            '  Shift+Enter — 换行（多行输入）',
          ].join('\n'));
          return;

        case '/settings':
          setMode('settings');
          await logSystem.info('System', '进入设置模式');
          return;

        case '/logs':
          setMode('logs');
          return;

        case '/bots':
          setMode('bots');
          await logSystem.info('System', '进入机器人管理模式');
          return;

        case '/theme':
          await cycleTheme();
          return;

        default:
          addSystemMessage(`未知命令: ${cmd.name}，输入 /help 查看帮助`);
          return;
      }
    }

    // 添加用户消息
    const uid = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id: uid, role: 'user', content: input, timestamp: Date.now() }]);

    // 记录日志
    await logSystem.info('Chat', `用户: ${input.slice(0, 100)}${input.length > 100 ? '...' : ''}`);

    // 调用 Agent
    setStatus('thinking');
    setStreamText('');
    setToolResults([]);
    await agentLoop.run(input);
  }, [agentLoop, exit, addSystemMessage, cycleTheme, logSystem]);

  // 从设置/日志/机器人模式返回对话模式
  const handleModeExit = useCallback(() => {
    setMode('chat');
  }, []);

  // 渲染非对话模式
  if (mode === 'settings') {
    return (
      <Box flexDirection="column">
        <SettingsMode onExit={handleModeExit} configManager={configManager} />
      </Box>
    );
  }

  if (mode === 'logs') {
    return (
      <Box flexDirection="column">
        <LogsMode onExit={handleModeExit} logSystem={logSystem} />
      </Box>
    );
  }

  if (mode === 'bots') {
    return (
      <Box flexDirection="column">
        <BotsMode onExit={handleModeExit} botManager={botManager} />
      </Box>
    );
  }

  // 对话模式
  return (
    <Box flexDirection="column">
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>✦ 璇玑</Text>
        <Text color={theme.dim}> v0.0.1</Text>
        <Text color={theme.dim}>  输入问题开始对话 | /help 查看帮助 | Ctrl+C 退出</Text>
      </Box>

      {/* 历史消息 (Static 保证滚出屏幕的不重绘) */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={msg.role === 'assistant' ? 1 : 0}>
            {msg.role === 'user' && (
              <Box>
                <Text color={theme.primary} bold>❯ </Text>
                <Text bold>{msg.content}</Text>
              </Box>
            )}
            {msg.role === 'assistant' && (
              <Box marginLeft={2}>
                <Text>{msg.content}</Text>
              </Box>
            )}
            {msg.role === 'system' && (
              <Box>
                <Text color={theme.dim} italic>{msg.content}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* 已完成的工具调用 */}
      {toolResults.map((tool, i) => (
        <ToolDisplay
          key={`tool-${i}`}
          name={tool.name}
          input={tool.input}
          result={tool.result}
          isError={tool.isError}
          duration={tool.duration}
        />
      ))}

      {/* 当前执行的工具 */}
      {toolInfoRef.current.size > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Box>
            <Spinner label={`执行工具中... (${toolInfoRef.current.size})`} />
          </Box>
        </Box>
      )}

      {/* 流式文本输出 */}
      {streamText && status !== 'idle' && (
        <Box marginLeft={2}>
          <Text>{streamText}</Text>
          <Text color={theme.dim}>▌</Text>
        </Box>
      )}

      {/* 思考中 */}
      {status === 'thinking' && !streamText && toolInfoRef.current.size === 0 && (
        <Spinner label="思考中..." />
      )}

      {/* 输入框 */}
      <InputHandler onSubmit={handleSubmit} isActive={status === 'idle'} />

      {/* 状态栏 */}
      {(usage.input > 0 || usage.output > 0) && (
        <StatusBar model={model} usage={usage} cost={cost} />
      )}
    </Box>
  );
}
