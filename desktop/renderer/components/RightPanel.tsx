// ============================================================
// RightPanel - 右侧面板组件
// ============================================================

import React, { useState, useMemo } from 'react';
import { Wrench, FileText, Activity, Loader2, Brain, Hash, ArrowRight, Zap, AlertTriangle, CheckCircle2, XCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMessageStore } from '../stores/messageStore';
import { useSessionStore } from '../stores/sessionStore';
import { useIntentRoutingStore } from '../stores/IntentRoutingStore';
import type { StageResult } from '../stores/IntentRoutingStore';
import ExecutionFlowV2 from './ExecutionFlowV2';

// 灰色版头像（workspace 水印背景）
import watermarkAvatar from '../assets/logos/acfee7f9a0868cf754cd2ab65cd6cfa6.png';

interface RightPanelProps {
  onToggle: () => void;
  width: number;
  onResize: (width: number) => void;
  className?: string;
}

type TabId = 'workspace' | 'tools' | 'logs';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'workspace', label: '监控', icon: <Activity size={16} /> },
  { id: 'tools', label: '工具', icon: <Wrench size={16} /> },
  { id: 'logs', label: '日志', icon: <FileText size={16} /> },
];

export default function RightPanel({ onToggle: _onToggle, width, onResize, className }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('workspace');
  const [isResizing, setIsResizing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(width);

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(width);
    e.preventDefault();
  };

  // 处理拖拽中和拖拽结束
  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(280, Math.min(600, startWidth + delta));
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, startX, startWidth, onResize]);

  return (
    <div className={`bg-card flex flex-col border-l border-border relative ${className || ''}`} style={{ minWidth: '280px', maxWidth: '600px' }}>
      {/* 灰色头像水印 */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-0 overflow-hidden">
        <div className="w-[260px] h-[260px]">
          <img
            src={watermarkAvatar}
            alt=""
            className="w-full h-full object-contain opacity-[0.06]"
          />
        </div>
      </div>
      {/* 拖拽手柄 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary transition-colors z-10"
        onMouseDown={handleMouseDown}
        style={{ userSelect: 'none' }}
      />

      {/* 标签页 */}
      <div className="flex-shrink-0 flex items-center border-b border-border">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-sm whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-background text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:bg-bg-secondary border-b-2 border-transparent'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

// 路由方法标签配置
const METHOD_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  llm: { label: 'AI 意图分析', color: 'text-blue-400', icon: <Zap size={10} /> },
  embedding: { label: '向量匹配', color: 'text-yellow-400', icon: <Search size={10} /> },
  default: { label: '默认路由', color: 'text-white/40', icon: <AlertTriangle size={10} /> },
};

// 路由阶段展示组件（L1/L2 路径，不展示 L3 兜底）
function RoutingChain({ stages }: { stages: StageResult[] }) {
  // 只展示 L1/L2，兜底 L3 不显示
  const displayLevels = ['L1', 'L2'];
  const stageMap = new Map(stages.map(s => [s.level, s]));

  const visible = displayLevels.filter((l) => stageMap.has(l));
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1 text-[10px]">
      {visible.map((level, i) => {
        const stage = stageMap.get(level)!;
        const label = level === 'L1' ? 'LLM' : '向量';

        let Icon = Loader2;
        let color = 'text-white/20';
        if (stage.status === 'success') { Icon = CheckCircle2; color = 'text-green-400'; }
        else if (stage.status === 'skipped') { Icon = XCircle; color = 'text-red-400/60'; }
        else if (stage.status === 'running') { Icon = Loader2; color = 'text-blue-400 animate-spin'; }

        return (
          <React.Fragment key={level}>
            {i > 0 && <ArrowRight size={8} className="text-white/15 flex-shrink-0" />}
            <span className="flex items-center gap-0.5" title={`${level}: ${stage.summary}`}>
              <span className="text-white/30">{label}</span>
              <Icon size={10} className={color} />
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Workspace 监控标签
function WorkspaceTab() {
  const routeStatus = useIntentRoutingStore((s) => s.status);
  const routeResult = useIntentRoutingStore((s) => s.result);
  const stages = useIntentRoutingStore((s) => s.stages);
  const promptLayers = useIntentRoutingStore((s) => s.promptLayers);
  const totalComponents = useIntentRoutingStore((s) => s.totalComponents);
  const estimatedTokens = useIntentRoutingStore((s) => s.estimatedTokens);

  // scene 可能是逗号分隔的多个值
  const scenes = routeResult?.scene
    ? routeResult.scene.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const methodInfo = routeResult ? METHOD_CONFIG[routeResult.method] ?? METHOD_CONFIG.default : null;
  const isDegraded = routeResult?.method === 'default' && stages.some(s => s.status === 'skipped');
  const runningL1 = stages.find(s => s.level === 'L1' && s.status === 'running' && s.method === 'llm');

  return (
    <div className="h-full w-full flex flex-col bg-transparent">
      {/* 意图路由分析面板 */}
      {routeStatus !== 'idle' && (
        <div className="flex-shrink-0 mx-3 mt-3 px-3 py-2 rounded-lg bg-transparent">
          {/* 头部：标题 + 状态 + 路由路径（同行） */}
          <div className="flex items-center gap-2">
            <Brain size={13} className="text-blue-400 flex-shrink-0" />
            <span className="text-[11px] font-semibold">意图分析</span>
            {routeStatus !== 'analyzing' && (
              <span className="text-[10px] text-green-400">完成</span>
            )}
            {stages.length > 0 && (
              <span className="ml-1">
                <RoutingChain stages={stages} />
              </span>
            )}
          </div>

          {routeStatus === 'analyzing' ? (
            <div className="mt-1">
              <p className="text-[10px] text-white/30">
                {stages.length > 0
                  ? `${stages[stages.length - 1].summary}...`
                  : '正在分析意图，匹配最佳 Agent...'}
              </p>
              {runningL1?.modelName && (
                <p className="text-[10px] text-blue-400/70 mt-0.5">
                  模型: {runningL1.modelName}
                </p>
              )}
            </div>
          ) : routeResult ? (
            <div className="mt-1.5 space-y-0.5 text-[10px]">
              {/* 核心一行：Agent + 路由方式 + 降级 + 置信度 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Hash size={9} className="text-white/40 flex-shrink-0" />
                <span className="text-blue-400 font-medium">{routeResult.agentId}</span>
                {methodInfo && (
                  <span className={`flex items-center gap-0.5 ${methodInfo.color}`}>
                    {methodInfo.icon}
                    <span className="text-white/35">{methodInfo.label}</span>
                  </span>
                )}
                {isDegraded && (
                  <span className="text-amber-400/70 flex items-center gap-0.5" title="L1/L2 失败，降级到默认路由">
                    <AlertTriangle size={9} />
                    降级
                  </span>
                )}
                {routeResult.confidence > 0 && (
                  <span className="text-white/20 ml-auto">
                    {(routeResult.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {/* 第二行：场景 + 复杂度 + 模型 */}
              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                {scenes.length > 0 && (
                  <span className="flex items-center gap-0.5">
                    {scenes.map((s, i) => (
                      <span key={`${s}-${i}`}>
                        {i > 0 && <span className="text-white/15">,</span>}
                        <span className="text-purple-400/80">{s}</span>
                      </span>
                    ))}
                  </span>
                )}
                {scenes.length > 0 && <span className="text-white/15">·</span>}
                {routeResult.complexity === 'complex' ? (
                  <span className="text-amber-400/80">复杂</span>
                ) : (
                  <span className="text-emerald-400/80">简单</span>
                )}
                {routeResult.method === 'llm' && routeResult.modelName && (
                  <>
                    <span className="text-white/15">·</span>
                    <span className="text-white/30">{routeResult.modelName}</span>
                  </>
                )}
              </div>
              {/* 已加载的 Prompt 组件分层展示 */}
              {promptLayers.length > 0 && (
                <details className="mt-1">
                  <summary className="text-white/25 cursor-pointer hover:text-white/40 select-none">
                    Prompt 组件 ({totalComponents}) · ~{estimatedTokens} tokens
                  </summary>
                  <div className="mt-1 max-h-48 overflow-y-auto space-y-1.5">
                    {promptLayers.map((layer) => {
                      const layerColors: Record<number, string> = { 0: 'text-blue-400/70', 1: 'text-purple-400/70', 2: 'text-amber-400/70', 3: 'text-emerald-400/70' };
                      const layerLabels: Record<number, string> = { 0: 'L0·基础', 1: 'L1·能力', 2: 'L2·行为', 3: 'L3·上下文' };
                      return (
                        <div key={layer.layer} className="pl-2 border-l border-white/10">
                          <span className={layerColors[layer.layer] || 'text-white/40'}>
                            {layerLabels[layer.layer] || `L${layer.layer}`}
                          </span>
                          <div className="ml-3 mt-0.5 space-y-0.5">
                            {layer.components.map((c) => (
                              <div key={c.id} className="text-[10px] text-white/30 truncate" title={c.id}>
                                {c.name}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          ) : null}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ExecutionFlowV2 />
      </div>
    </div>
  );
}

// Checkpoint 标签
// 工具调用标签（从 chatStore 的流式事件实时统计）
function ToolsTab() {
  const messages = useMessageStore((state) => state.messages);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  // 从消息的 toolCalls 中实时统计工具使用，并保留完整的调用信息
  const { toolStats, allCalls } = useMemo(() => {
    const counts: Record<string, { total: number; success: number; error: number }> = {};
    const calls: Array<{
      id: string;
      name: string;
      status: string;
      timestamp: number;
      input?: any;
      output?: any;
      error?: string;
    }> = [];

    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (!counts[tc.name]) {
            counts[tc.name] = { total: 0, success: 0, error: 0 };
          }
          counts[tc.name].total++;
          if (tc.status === 'success') counts[tc.name].success++;
          if (tc.status === 'error') counts[tc.name].error++;

          calls.push({
            id: tc.id,
            name: tc.name,
            status: tc.status,
            timestamp: msg.timestamp || 0,
            input: tc.input,
            output: tc.output,
            error: tc.error,
          });
        }
      }
    }

    // 按调用次数排序
    const sorted = Object.entries(counts)
      .sort(([, a], [, b]) => b.total - a.total);

    return {
      toolStats: sorted,
      allCalls: calls.reverse(), // 最新的在前
    };
  }, [messages]);

  const toolIcons: Record<string, string> = {
    read_file: '📖', write_file: '📝', edit_file: '✏️', multi_edit: '📋',
    bash: '💻', glob: '🔎', grep: '🔍', ls: '📂',
    web_fetch: '🌐', plan_review: '📋', ask_user: '❓',
    todo_create: '✅', todo_list: '📋', todo_update: '🔄',
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const toggleExpand = (callId: string) => {
    setExpandedCall(expandedCall === callId ? null : callId);
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">🛠️ 工具调用统计</div>

        {toolStats.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            暂无工具调用记录
          </div>
        ) : (
          <>
            <div className="space-y-2 text-sm">
              {toolStats.map(([name, stat]) => (
                <div key={name} className="flex justify-between items-center p-2 bg-background rounded">
                  <span>{toolIcons[name] || '🔧'} {name}</span>
                  <div className="flex items-center gap-2">
                    {stat.error > 0 && (
                      <span className="text-xs text-red-500">{stat.error} 错误</span>
                    )}
                    <span className="text-text-secondary">{stat.total} 次</span>
                  </div>
                </div>
              ))}
            </div>

            {allCalls.length > 0 && (
              <>
                <div className="text-sm font-semibold mt-4 mb-2">⏱️ 调用历史</div>
                <div className="space-y-2">
                  {allCalls.slice(0, 20).map((call) => {
                    const isExpanded = expandedCall === call.id;
                    const statusIcon = call.status === 'success' ? '✓' : call.status === 'error' ? '✗' : '…';
                    const statusColor = call.status === 'success' ? 'text-green-500' : call.status === 'error' ? 'text-red-500' : 'text-yellow-500';

                    return (
                      <div key={call.id} className="bg-background rounded overflow-hidden">
                        <Button
                          onClick={() => toggleExpand(call.id)}
                          variant="ghost"
                          className="w-full p-2 text-left h-auto justify-start"
                        >
                          <div className="flex items-center justify-between text-xs w-full">
                            <div className="flex items-center gap-2">
                              <span className={statusColor}>{statusIcon}</span>
                              <span>{toolIcons[call.name] || '🔧'}</span>
                              <span className="font-medium">{call.name}</span>
                            </div>
                            <span className="text-text-secondary">{formatTime(call.timestamp)}</span>
                          </div>
                        </Button>

                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-2 text-xs">
                            {call.input && (
                              <div>
                                <div className="text-text-secondary mb-1">输入参数:</div>
                                <pre className="bg-bg-secondary p-2 rounded overflow-x-auto text-xs">
                                  {JSON.stringify(call.input, null, 2)}
                                </pre>
                              </div>
                            )}

                            {call.status === 'success' && call.output && (
                              <div>
                                <div className="text-text-secondary mb-1">输出结果:</div>
                                <pre className="bg-bg-secondary p-2 rounded overflow-x-auto text-xs max-h-40 overflow-y-auto">
                                  {typeof call.output === 'string' ? call.output : JSON.stringify(call.output, null, 2)}
                                </pre>
                              </div>
                            )}

                            {call.status === 'error' && call.error && (
                              <div>
                                <div className="text-red-500 mb-1">错误信息:</div>
                                <pre className="bg-red-500/10 text-red-500 p-2 rounded overflow-x-auto text-xs">
                                  {call.error}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 记忆库标签
// 日志流标签（从 chatStore 读取真实日志）
function LogsTab() {
  const logs = useSessionStore((state) => state.logs);
  const clearLogs = useSessionStore((state) => state.clearLogs);
  const [filter, setFilter] = useState<string | null>(null);

  const filteredLogs = filter
    ? logs.filter((log) => log.level === filter)
    : logs;

  const levelColors: Record<string, string> = {
    error: 'text-red-500',
    warn: 'text-yellow-500',
    info: 'text-green-500',
    debug: 'text-primary',
    tool: 'text-blue-400',
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="text-sm font-semibold">📋 日志流</div>

      <div className="flex gap-2 text-xs flex-shrink-0">
        {[
          { value: null, label: '全部' },
          { value: 'error', label: '错误' },
          { value: 'warn', label: '警告' },
          { value: 'info', label: '信息' },
          { value: 'tool', label: '工具' },
        ].map((item) => (
          <Button
            key={item.label}
            onClick={() => setFilter(item.value)}
            variant={filter === item.value ? 'default' : 'ghost'}
            size="sm"
          >
            {item.label}
          </Button>
        ))}
      </div>

      {filteredLogs.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无日志记录
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 text-xs font-mono">
          {filteredLogs.slice().reverse().map((log, idx) => (
            <div key={idx} className="p-2 bg-background rounded">
              <span className="text-text-secondary">{formatTime(log.timestamp)}</span>{' '}
              <span className={levelColors[log.level] || 'text-text-secondary'}>
                {log.level.toUpperCase()}
              </span>{' '}
              <span>{log.message}</span>
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="flex gap-2 flex-shrink-0">
          <Button
            onClick={clearLogs}
            variant="ghost"
            size="sm"
          >
            清空
          </Button>
        </div>
      )}
    </div>
  );
}
