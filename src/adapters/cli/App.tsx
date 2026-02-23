// ============================================================
// M1 终端 UI — App 根组件
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import type { AgentState, TokenUsage, UITheme, UILanguage } from '@/core/types';
import type { AgentCallbacks } from '@/core/agent/AgentLoop';
import { t, setLanguage, getLanguage } from '@/core/i18n';
import { createDebouncedUpdate } from './utils/Debounce';
import { renderMarkdownSimple } from './MarkdownRenderer';
import { parseSlashCommand } from './SlashCommands';
import { InputHandler } from './InputHandler';
import { Spinner } from './Spinner';
import { CollapsibleToolResult } from './CollapsibleToolResult';
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
  const [activeTools, setActiveTools] = useState<Map<string, { name: string; input: Record<string, unknown> }>>(new Map());
  const [expandedToolIndices, setExpandedToolIndices] = useState<Set<number>>(new Set());
  const msgIdRef = useRef(0);
  const toolInfoRef = useRef<Map<string, {
    startTime: number;
    input: Record<string, unknown>;
    startTokenUsage: TokenUsage;
  }>>(new Map());

  // 使用 ref 追踪最新的流式文本和工具结果，避免闭包问题
  const streamTextRef = useRef('');
  const toolResultsRef = useRef<ToolResultDisplay[]>([]);
  // 保存 debounce updater 引用，用于 Ctrl+C 时清理
  const streamTextUpdaterRef = useRef<ReturnType<typeof createDebouncedUpdate<string>> | null>(null);
  // 追踪当前 usage，避免闭包问题
  const usageRef = useRef<TokenUsage>({ input: 0, output: 0 });

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

        // 初始化语言：优先使用保存的语言，否则使用英文作为默认
        const language = config.ui.language || 'en';
        setLanguage(language);

        // 如果配置中没有语言设置，则保存英文为默认值
        if (!config.ui.language) {
          await configManager.save({
            ui: { ...config.ui, language: 'en' }
          });
        }

        await logSystem.info('System', t('cli.started'));
      } catch (error) {
        // 配置加载失败，使用默认值（英文）
        setLanguage('en');
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
        // 取消所有 pending 的 debounce 更新
        if (streamTextUpdaterRef.current) {
          streamTextUpdaterRef.current.cancel();
        }
        // 停止 Agent 执行
        agentLoop.stop();
        // 清理状态
        setStatus('idle');
        // 注意：不清空 streamText，让已生成的文本继续显示
        // 只清空 ref 中的累积值
        streamTextRef.current = '';
        setActiveTools(new Map());
        toolInfoRef.current.clear();
        // 显示中断提示
        const id = ++msgIdRef.current;
        setMessages((prev) => [...prev, {
          id,
          role: 'system',
          content: `⏸️  ${t('chat.session_interrupted')}`,
          timestamp: Date.now(),
        }]);
      } else {
        exit();
      }
    }

    // 数字快捷键 1-9 用于展开/折叠工具结果
    if (mode === 'chat' && /^[1-9]$/.test(input)) {
      const toolIndex = parseInt(input, 10) - 1;
      if (toolIndex < toolResults.length) {
        setExpandedToolIndices((prev) => {
          const next = new Set(prev);
          if (next.has(toolIndex)) {
            next.delete(toolIndex);
          } else {
            next.add(toolIndex);
          }
          return next;
        });
      }
    }
  });

  // 注册 AgentLoop 回调
  useEffect(() => {
    // 创建 debounced 更新器，1000ms 的间隔大幅减少 re-render 频率
    const streamTextUpdater = createDebouncedUpdate<string>(
      (text) => setStreamText(text),
      1000
    );
    // 保存到 ref 以便 Ctrl+C 时使用
    streamTextUpdaterRef.current = streamTextUpdater;

    // 创建 debounced 更新器，token 使用也采用 1000ms 间隔
    const usageUpdater = createDebouncedUpdate<TokenUsage>(
      (usage) => setUsage(usage),
      1000
    );

    agentLoop.on({
      onText: (text: string) => {
        streamTextRef.current += text;
        // 只累积到 ref，不更新状态显示
        // 执行期间显示 loading 动画，完成后一次性显示完整内容
      },
      onThinking: (_thinking: string) => {
        // 直接设置状态，不经过 debounce
        setStatus('thinking');
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        setStatus('tool');
        // 记录该工具的开始时间、input 和当前 token 使用
        const currentState = agentLoop.getState();
        toolInfoRef.current.set(id, {
          startTime: Date.now(),
          input,
          startTokenUsage: { ...currentState.tokenUsage },
        });
        // 将工具添加到 activeTools state，用于显示进行中的工具
        setActiveTools((prev) => new Map(prev).set(id, { name, input }));
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        // 查找该工具的信息
        const toolInfo = toolInfoRef.current.get(id);
        const startTime = toolInfo?.startTime ?? Date.now();
        const input = toolInfo?.input ?? {};
        const startTokenUsage = toolInfo?.startTokenUsage;
        const duration = Date.now() - startTime;

        // 计算该工具消耗的 token（当前 - 开始时）
        let toolTokenUsage: TokenUsage | undefined;
        if (startTokenUsage) {
          const currentUsage = usageRef.current;
          toolTokenUsage = {
            input: currentUsage.input - startTokenUsage.input,
            output: currentUsage.output - startTokenUsage.output,
            cacheRead: (currentUsage.cacheRead ?? 0) - (startTokenUsage.cacheRead ?? 0),
            cacheWrite: (currentUsage.cacheWrite ?? 0) - (startTokenUsage.cacheWrite ?? 0),
          };
        }

        // 删除该工具的信息
        toolInfoRef.current.delete(id);

        // 从 activeTools 中移除该工具
        setActiveTools((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });

        // 使用 ref 而不是状态闭包来保存工具结果
        const newToolResult: ToolResultDisplay = {
          name,
          input,
          result,
          isError,
          duration,
          tokenUsage: toolTokenUsage,
        };
        toolResultsRef.current.push(newToolResult);

        setToolResults((prev) => [...prev, newToolResult]);
      },
      onUsage: (u: TokenUsage) => {
        usageRef.current = {
          input: usageRef.current.input + u.input,
          output: usageRef.current.output + u.output,
        };
        // 使用 debounced 更新避免频繁 re-render
        usageUpdater.update(usageRef.current);
      },
      onError: (err: Error) => {
        // 刷新所有 pending 的流式文本和 usage
        streamTextUpdater.flush();
        usageUpdater.flush();

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
        // 注意：不清空 streamText，让它继续显示
        // 只清空 ref 中的累积值
        streamTextRef.current = '';
        // 注意：不清空 toolResults，让工具结果继续显示
        setActiveTools(new Map());
        toolInfoRef.current.clear();
      },
      onEnd: (state: AgentState) => {
        // 刷新所有 pending 的流式文本和 usage
        streamTextUpdater.flush();
        usageUpdater.flush();

        // 使用 ref 中的值而不是状态闭包中的旧值
        const text = streamTextRef.current;
        const tools = toolResultsRef.current;

        // 构建消息数组：先添加工具调用，再添加 assistant 文本回复
        const newMessages: ChatMessage[] = [];

        // 1. 添加工具调用记录
        tools.forEach((tool) => {
          const id = ++msgIdRef.current;
          newMessages.push({
            id,
            role: 'tool',
            content: tool.result,
            toolName: tool.name,
            toolInput: tool.input,
            toolIsError: tool.isError,
            toolDuration: tool.duration,
            toolTokenUsage: tool.tokenUsage,
            timestamp: Date.now(),
          });
        });

        // 2. 添加 assistant 文本回复（如果有）
        if (text) {
          const id = ++msgIdRef.current;
          newMessages.push({
            id,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
          });
        }

        // 批量添加到历史消息
        if (newMessages.length > 0) {
          setMessages((prev) => [...prev, ...newMessages]);
        }

        // 清空临时状态
        streamTextRef.current = '';
        toolResultsRef.current = [];
        setStreamText('');
        setToolResults([]);
        setStatus('idle');
        setCost(state.cost);
        setActiveTools(new Map());
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

  // 语言切换
  const cycleLanguage = useCallback(async () => {
    const currentLang = getLanguage();
    const nextLang: UILanguage = currentLang === 'zh' ? 'en' : 'zh';

    // 立即切换语言
    setLanguage(nextLang);

    try {
      // 保存到配置
      const currentConfig = configManager.getConfig();
      await configManager.save({ ui: { ...currentConfig.ui, language: nextLang } });
    } catch (err) {
      // 保存失败，但内存中已切换成功
      await logSystem.error('Config', `Failed to save language: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 获取语言标签
    const langLabels: Record<UILanguage, string> = {
      zh: t('ui.lang_zh'),
      en: t('ui.lang_en'),
    };

    // 显示切换成功的消息
    addSystemMessage(t('ui.language_changed', { lang: langLabels[nextLang] }));
    await logSystem.info('Config', `Language switched to ${nextLang}`);
  }, [configManager, addSystemMessage, logSystem]);

  // 提交用户输入
  const handleSubmit = useCallback(async (input: string) => {
    // 斜杠命令
    const cmd = parseSlashCommand(input);
    if (cmd) {
      switch (cmd.name) {
        case '/exit':
        case '/quit':
          await logSystem.info('System', t('cli.exit'));
          exit();
          return;

        case '/clear':
          setMessages([]);
          setToolResults([]);
          toolResultsRef.current = [];
          setExpandedToolIndices(new Set());
          return;

        case '/reset':
          agentLoop.reset();
          setMessages([]);
          setToolResults([]);
          toolResultsRef.current = [];
          setUsage({ input: 0, output: 0 });
          setCost(0);
          setExpandedToolIndices(new Set());
          addSystemMessage(t('chat.session_reset'));
          await logSystem.info('Chat', t('chat.session_reset'));
          return;

        case '/cost': {
          const state = agentLoop.getState();
          addSystemMessage(`${t('chat.token_label')}: ${state.tokenUsage.input + state.tokenUsage.output}`);
          return;
        }

        case '/help':
          addSystemMessage([
            t('help.title'),
            t('help.help'),
            t('help.clear'),
            t('help.reset'),
            t('help.cost'),
            t('help.settings'),
            t('help.logs'),
            t('help.bots'),
            t('help.lang'),
            t('help.exit'),
            '',
            t('help.shortcuts_title'),
            t('help.shortcut_ctrlc'),
            t('help.shortcut_shift_enter'),
          ].join('\n'));
          return;

        case '/settings':
          setMode('settings');
          await logSystem.info('System', t('settings.enter'));
          return;

        case '/logs':
          setMode('logs');
          return;

        case '/bots':
          setMode('bots');
          await logSystem.info('System', t('bots.enter'));
          return;

        case '/lang':
          await cycleLanguage();
          return;

        default:
          addSystemMessage(t('chat.unknown_command', { name: cmd.name }));
          return;
      }
    }

    // 添加用户消息
    const uid = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id: uid, role: 'user', content: input, timestamp: Date.now() }]);

    // 记录日志
    const preview = input.slice(0, 100) + (input.length > 100 ? '...' : '');
    await logSystem.info('Chat', t('chat.user_log', { preview }));

    // 调用 Agent
    setStatus('thinking');
    setStreamText('');
    setToolResults([]);
    toolResultsRef.current = [];
    setExpandedToolIndices(new Set());
    try {
      await agentLoop.run(input);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addSystemMessage(`❌ ${errMsg}`);
      setStatus('idle');
      await logSystem.error('Chat', errMsg);
    }
  }, [agentLoop, exit, addSystemMessage, cycleLanguage, logSystem]);

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
        <Text bold color={theme.primary}>{t('cli.title')}</Text>
        <Text color={theme.dim}>  {t('cli.help_hint')}</Text>
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
            {msg.role === 'tool' && msg.toolName && (
              <CollapsibleToolResult
                name={msg.toolName}
                input={msg.toolInput ?? {}}
                result={msg.content}
                isError={msg.toolIsError ?? false}
                duration={msg.toolDuration ?? 0}
                tokenUsage={msg.toolTokenUsage}
                index={0}
                expanded={false}
                onToggleExpand={() => {}}
              />
            )}
            {msg.role === 'assistant' && (
              <Box marginLeft={2} flexDirection="column">
                {renderMarkdownSimple(msg.content).map((line, i) => (
                  <Box key={i}>
                    <Text>{line}</Text>
                  </Box>
                ))}
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

      {/* 已完成的工具调用结果（仅在对话进行中显示） */}
      {status !== 'idle' && toolResults.map((tool, i) => (
        <CollapsibleToolResult
          key={`tool-${i}`}
          name={tool.name}
          input={tool.input}
          result={tool.result}
          isError={tool.isError}
          duration={tool.duration}
          tokenUsage={tool.tokenUsage}
          index={i}
          expanded={expandedToolIndices.has(i)}
          onToggleExpand={() => {
            setExpandedToolIndices((prev) => {
              const next = new Set(prev);
              if (next.has(i)) {
                next.delete(i);
              } else {
                next.add(i);
              }
              return next;
            });
          }}
        />
      ))}

      {/* 当前执行的工具 */}
      {Array.from(activeTools.entries()).map(([id, tool]) => (
        <Box key={id} marginLeft={2}>
          <Spinner label={t('cli.tool_executing', { name: tool.name })} />
        </Box>
      ))}

      {/* 思考中（没有工具在执行时显示）*/}
      {status === 'thinking' && activeTools.size === 0 && (
        <Spinner label={t('cli.thinking')} />
      )}

      {/* 流式文本处理状态 - 使用静态文本，避免 Spinner 动画导致频繁重新渲染 */}
      {streamTextRef.current && status !== 'idle' && (
        <Box marginLeft={2} marginTop={1}>
          <Text color="cyan">⏳ 处理中...</Text>
        </Box>
      )}

      {/* 输入框 */}
      <InputHandler onSubmit={handleSubmit} isActive={status === 'idle'} />

      {/* 状态栏 - 显示实时 token 消耗（通过 debounce 避免闪烁） */}
      {(usage.input > 0 || usage.output > 0) && (
        <StatusBar model={model} usage={usage} cost={cost} />
      )}
    </Box>
  );
}
