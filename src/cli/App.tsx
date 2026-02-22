// ============================================================
// M1 终端 UI — App 根组件
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import type { AgentState, TokenUsage } from '@/types';
import type { AgentCallbacks } from '@/agent/AgentLoop';
import { parseSlashCommand } from './SlashCommands';
import { InputHandler } from './InputHandler';
import { Spinner } from './Spinner';
import { ToolDisplay } from './ToolDisplay';
import { StatusBar } from './StatusBar';
import type { ChatMessage, ToolResultDisplay, CurrentToolState } from './types';

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
  const [status, setStatus] = useState<'idle' | 'thinking' | 'tool'>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamText, setStreamText] = useState('');
  const [currentTool, setCurrentTool] = useState<CurrentToolState | null>(null);
  const [toolResults, setToolResults] = useState<ToolResultDisplay[]>([]);
  const [usage, setUsage] = useState<TokenUsage>({ input: 0, output: 0 });
  const [cost, setCost] = useState(0);
  const msgIdRef = useRef(0);
  const toolStartTimeRef = useRef(0);

  // Ctrl+C 处理
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status !== 'idle') {
        agentLoop.stop();
        setStatus('idle');
        setStreamText('');
        setCurrentTool(null);
      } else {
        exit();
      }
    }
  });

  // 注册 AgentLoop 回调
  useEffect(() => {
    agentLoop.on({
      onText: (text: string) => {
        setStreamText((prev) => prev + text);
      },
      onThinking: (_thinking: string) => {
        setStatus('thinking');
      },
      onToolStart: (name: string, input: Record<string, unknown>) => {
        setStatus('tool');
        setCurrentTool({ name, input });
        toolStartTimeRef.current = Date.now();
      },
      onToolEnd: (name: string, result: string, isError: boolean) => {
        const duration = Date.now() - toolStartTimeRef.current;
        setToolResults((prev) => [...prev, {
          name,
          input: currentTool?.input ?? {},
          result,
          isError,
          duration,
        }]);
        setCurrentTool(null);
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
      },
      onEnd: (state: AgentState) => {
        // 把流式文本和工具结果合并为一条 assistant 消息
        const text = streamText;
        const tools = toolResults;
        if (text || tools.length > 0) {
          const id = ++msgIdRef.current;
          setMessages((prev) => [...prev, {
            id,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
          }]);
        }
        setStreamText('');
        setToolResults([]);
        setCurrentTool(null);
        setStatus('idle');
        setCost(state.cost);
      },
    });
  }, []);

  // 提交用户输入
  const handleSubmit = useCallback(async (input: string) => {
    // 斜杠命令
    const cmd = parseSlashCommand(input);
    if (cmd) {
      switch (cmd.name) {
        case '/exit':
        case '/quit':
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
          const id = ++msgIdRef.current;
          setMessages([{ id, role: 'system', content: '会话已重置', timestamp: Date.now() }]);
          return;
        case '/cost': {
          const state = agentLoop.getState();
          const cid = ++msgIdRef.current;
          const costStr = state.cost < 0.01 ? `$${state.cost.toFixed(4)}` : `$${state.cost.toFixed(2)}`;
          setMessages((prev) => [...prev, {
            id: cid,
            role: 'system',
            content: `Token: ${state.tokenUsage.input + state.tokenUsage.output} | 费用: ${costStr}`,
            timestamp: Date.now(),
          }]);
          return;
        }
        case '/help': {
          const hid = ++msgIdRef.current;
          setMessages((prev) => [...prev, {
            id: hid,
            role: 'system',
            content: '/help — 帮助  /clear — 清屏  /reset — 重置  /cost — 费用  /exit — 退出  Ctrl+C — 中断/退出',
            timestamp: Date.now(),
          }]);
          return;
        }
      }
    }

    // 添加用户消息
    const uid = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id: uid, role: 'user', content: input, timestamp: Date.now() }]);

    // 调用 Agent
    setStatus('thinking');
    setStreamText('');
    setToolResults([]);
    await agentLoop.run(input);
  }, [agentLoop, exit]);

  return (
    <Box flexDirection="column">
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text bold color="#7C8CF5">✦ 璇玑</Text>
        <Text color="gray"> v0.0.1</Text>
        <Text color="gray">  输入问题开始对话 | /help 查看帮助 | Ctrl+C 退出</Text>
      </Box>

      {/* 历史消息 (Static 保证滚出屏幕的不重绘) */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={msg.role === 'assistant' ? 1 : 0}>
            {msg.role === 'user' && (
              <Box>
                <Text color="#7C8CF5" bold>❯ </Text>
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
                <Text color="gray" italic>{msg.content}</Text>
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

      {/* 当前工具执行 */}
      {currentTool && (
        <Box flexDirection="column" marginLeft={2}>
          <Box>
            <Spinner label={`${currentTool.name}...`} />
          </Box>
        </Box>
      )}

      {/* 流式文本输出 */}
      {streamText && status !== 'idle' && (
        <Box marginLeft={2}>
          <Text>{streamText}</Text>
          <Text color="gray">▌</Text>
        </Box>
      )}

      {/* 思考中 */}
      {status === 'thinking' && !streamText && !currentTool && (
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
