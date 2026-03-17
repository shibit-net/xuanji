// ============================================================
// AgentPanel - 右侧 Agent 拟人化面板
// 展示当前执行任务的 Agent 及其行为
// ============================================================

import React, { useState, useMemo, useEffect } from 'react';
import { X, Zap, Clock, CheckCircle, AlertCircle, Loader2, Brain, Users } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { motion, AnimatePresence } from 'framer-motion';

interface AgentPanelProps {
  onToggle: () => void;
}

// Agent 类型定义
interface AgentInfo {
  id: string;
  name: string;
  avatar: string;
  color: string;
  role: 'main' | 'worker' | 'planner';
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'done' | 'error';
  currentThought?: string;
  currentTool?: {
    name: string;
    status: 'running' | 'success' | 'error';
    duration?: number;
  };
}

export default function AgentPanel({ onToggle }: AgentPanelProps) {
  const messages = useChatStore((state) => state.messages);
  const [activeAgents, setActiveAgents] = useState<AgentInfo[]>([]);

  // 从消息流中推断 Agent 状态
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];

    // 检测当前活跃的 Agent
    const agents: AgentInfo[] = [];

    // 主 Agent 始终存在
    const mainAgent: AgentInfo = {
      id: 'main',
      name: '璇玑',
      avatar: '⭐',
      color: 'from-purple-500 to-pink-500',
      role: 'main',
      status: 'idle',
    };

    if (lastMsg) {
      if (lastMsg.role === 'assistant' && !lastMsg.content) {
        mainAgent.status = 'thinking';
        mainAgent.currentThought = '正在思考...';
      } else if (lastMsg.toolCalls) {
        const runningTools = lastMsg.toolCalls.filter(tc => !tc.status || tc.status === 'running');
        const successTools = lastMsg.toolCalls.filter(tc => tc.status === 'success');
        const errorTools = lastMsg.toolCalls.filter(tc => tc.status === 'error');

        if (runningTools.length > 0) {
          mainAgent.status = 'executing';
          mainAgent.currentThought = `正在使用 ${runningTools[0].name}`;
          mainAgent.currentTool = {
            name: runningTools[0].name,
            status: 'running',
          };
        } else if (errorTools.length > 0) {
          mainAgent.status = 'error';
          mainAgent.currentThought = '遇到了一些问题';
        } else if (successTools.length > 0) {
          mainAgent.status = 'done';
          mainAgent.currentThought = '任务完成！';
        }
      } else if (typeof lastMsg.content === 'string' && lastMsg.content) {
        mainAgent.status = 'done';
        mainAgent.currentThought = '回复完成';
      }
    }

    agents.push(mainAgent);

    // TODO: 从 SubAgent 系统检测 Worker Agents
    // 这里可以扩展检测多个 Worker Agents 的逻辑

    setActiveAgents(agents);
  }, [messages]);

  return (
    <div className="w-96 bg-bg-secondary flex flex-col border-l border-bg-tertiary">
      {/* 标题 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <div className="text-lg">🤖</div>
          <div className="font-semibold">Agent 工作台</div>
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-bg-tertiary rounded transition-colors"
          title="关闭面板"
        >
          <X size={16} className="text-text-secondary" />
        </button>
      </div>

      {/* Agent 卡片区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence mode="popLayout">
          {activeAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </AnimatePresence>

        {/* 工具调用历史 */}
        <ToolCallHistory />
      </div>

      {/* 底部统计 */}
      <AgentStats />
    </div>
  );
}

// Agent 卡片组件（拟人化展示）
function AgentCard({ agent }: { agent: AgentInfo }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-bg-primary rounded-xl p-4 shadow-lg"
    >
      {/* Agent 头像和信息 */}
      <div className="flex items-start gap-3 mb-3">
        {/* 拟人化头像 */}
        <div className={`relative w-14 h-14 rounded-full bg-gradient-to-br ${agent.color} flex items-center justify-center text-2xl shadow-lg`}>
          {agent.avatar}
          {/* 状态指示器 */}
          <div className="absolute -bottom-1 -right-1">
            <StatusIndicator status={agent.status} />
          </div>
        </div>

        {/* Agent 信息 */}
        <div className="flex-1">
          <div className="font-semibold text-lg">{agent.name}</div>
          <div className="text-sm text-text-secondary">
            {agent.role === 'main' && '主 Agent'}
            {agent.role === 'worker' && 'Worker Agent'}
            {agent.role === 'planner' && 'Planner Agent'}
          </div>
        </div>
      </div>

      {/* 思考气泡 */}
      {agent.currentThought && (
        <ThinkingBubble
          thought={agent.currentThought}
          status={agent.status}
        />
      )}

      {/* 当前工具调用 */}
      {agent.currentTool && (
        <CurrentToolCard tool={agent.currentTool} />
      )}
    </motion.div>
  );
}

// 状态指示器
function StatusIndicator({ status }: { status: AgentInfo['status'] }) {
  const configs = {
    idle: { icon: '😌', color: 'bg-gray-400', animate: false },
    thinking: { icon: '💭', color: 'bg-blue-500', animate: true },
    executing: { icon: '⚙️', color: 'bg-green-500', animate: true },
    waiting: { icon: '⏸️', color: 'bg-yellow-500', animate: false },
    done: { icon: '✅', color: 'bg-green-600', animate: false },
    error: { icon: '❌', color: 'bg-red-500', animate: false },
  };

  const config = configs[status];

  return (
    <motion.div
      className={`w-6 h-6 rounded-full ${config.color} flex items-center justify-center text-xs shadow-md`}
      animate={config.animate ? { scale: [1, 1.2, 1] } : {}}
      transition={config.animate ? { repeat: Infinity, duration: 1.5 } : {}}
    >
      {config.icon}
    </motion.div>
  );
}

// 思考气泡
function ThinkingBubble({ thought, status }: { thought: string; status: AgentInfo['status'] }) {
  const isActive = status === 'thinking' || status === 'executing';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative p-3 rounded-lg mb-3 ${
        isActive
          ? 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30'
          : 'bg-bg-secondary'
      }`}
    >
      {/* 气泡尾巴 */}
      <div className="absolute -top-2 left-6 w-4 h-4 bg-inherit border-l border-t border-blue-500/30 transform rotate-45" />

      <div className="flex items-start gap-2">
        {isActive && (
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="text-lg"
          >
            💭
          </motion.div>
        )}
        <div className="flex-1 text-sm">
          {thought}
          {isActive && (
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              ...
            </motion.span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// 当前工具卡片
function CurrentToolCard({ tool }: { tool: AgentInfo['currentTool'] }) {
  if (!tool) return null;

  const toolIcons: Record<string, string> = {
    read_file: '📖',
    write_file: '📝',
    edit_file: '✏️',
    multi_edit: '📋',
    bash: '💻',
    glob: '🔎',
    grep: '🔍',
    web_fetch: '🌐',
  };

  const statusColors = {
    running: 'border-yellow-500/50 bg-yellow-500/5',
    success: 'border-green-500/50 bg-green-500/5',
    error: 'border-red-500/50 bg-red-500/5',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`p-3 rounded-lg border ${statusColors[tool.status]}`}
    >
      <div className="flex items-center gap-2">
        <div className="text-xl">{toolIcons[tool.name] || '🔧'}</div>
        <div className="flex-1">
          <div className="font-medium text-sm">{tool.name}</div>
          {tool.duration !== undefined && (
            <div className="text-xs text-text-secondary">{tool.duration}ms</div>
          )}
        </div>
        {tool.status === 'running' && (
          <Loader2 size={16} className="animate-spin text-yellow-500" />
        )}
        {tool.status === 'success' && (
          <CheckCircle size={16} className="text-green-500" />
        )}
        {tool.status === 'error' && (
          <AlertCircle size={16} className="text-red-500" />
        )}
      </div>
    </motion.div>
  );
}

// 工具调用历史
function ToolCallHistory() {
  const messages = useChatStore((state) => state.messages);

  const recentTools = useMemo(() => {
    const tools: Array<{
      name: string;
      status: string;
      timestamp: number;
    }> = [];

    for (const msg of messages.slice(-10)) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          tools.push({
            name: tc.name,
            status: tc.status || 'running',
            timestamp: msg.timestamp || 0,
          });
        }
      }
    }

    return tools.reverse().slice(0, 8);
  }, [messages]);

  const toolIcons: Record<string, string> = {
    read_file: '📖',
    write_file: '📝',
    edit_file: '✏️',
    multi_edit: '📋',
    bash: '💻',
    glob: '🔎',
    grep: '🔍',
    web_fetch: '🌐',
  };

  if (recentTools.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="text-sm font-semibold mb-3 text-text-secondary">⏱️ 工具调用记录</div>
      <div className="space-y-2">
        {recentTools.map((tool, idx) => {
          const time = new Date(tool.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-2 p-2 bg-bg-primary rounded-lg text-sm"
            >
              <div className="text-base">{toolIcons[tool.name] || '🔧'}</div>
              <div className="flex-1 truncate">{tool.name}</div>
              <div className="text-xs text-text-secondary">{time}</div>
              <div className="w-4">
                {tool.status === 'success' && <span className="text-green-500">✓</span>}
                {tool.status === 'error' && <span className="text-red-500">✗</span>}
                {tool.status === 'running' && <Loader2 size={12} className="animate-spin" />}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// Agent 统计面板
function AgentStats() {
  const messages = useChatStore((state) => state.messages);

  const stats = useMemo(() => {
    let totalTools = 0;
    let successTools = 0;
    let errorTools = 0;
    let thinkingTime = 0;

    for (const msg of messages) {
      if (msg.toolCalls) {
        totalTools += msg.toolCalls.length;
        successTools += msg.toolCalls.filter(tc => tc.status === 'success').length;
        errorTools += msg.toolCalls.filter(tc => tc.status === 'error').length;
      }
    }

    return { totalTools, successTools, errorTools, thinkingTime };
  }, [messages]);

  return (
    <div className="border-t border-bg-tertiary p-4 bg-bg-primary">
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        <div>
          <div className="text-2xl font-bold text-primary">{stats.totalTools}</div>
          <div className="text-text-secondary mt-1">工具调用</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-500">{stats.successTools}</div>
          <div className="text-text-secondary mt-1">成功</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-red-500">{stats.errorTools}</div>
          <div className="text-text-secondary mt-1">错误</div>
        </div>
      </div>
    </div>
  );
}
