// ============================================================
// MonitorPanel - 等分列监控面板（替换 RightPanel）
// ============================================================

import React, { useState, useMemo } from 'react';
import { Activity, FileText, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '../stores/sessionStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useIntentRoutingStore } from '../stores/IntentRoutingStore';
import { usePlatformStore } from '../stores/platformStore';
import { t } from '@/core/i18n';
import ExecutionFlowV2 from './ExecutionFlowV2';
import PlatformSessionPanel from './PlatformSessionPanel';

type TabId = 'monitor' | 'logs' | 'remote';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'monitor', label: '运行监控', icon: <Activity size={14} /> },
  { id: 'logs', label: '日志', icon: <FileText size={14} /> },
  { id: 'remote', label: '远端会话', icon: <Radio size={14} /> },
];

export default function MonitorPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('monitor');

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="flex-shrink-0 flex items-center border-b border-border px-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 py-2 px-3 text-xs transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'monitor' && <MonitorTab />}
        {activeTab === 'logs' && <LogsTab />}
        {activeTab === 'remote' && <RemoteTab />}
      </div>
    </div>
  );
}

// ─── 路由方法配置 ──────────────────────────

const METHOD_CONFIG: Record<string, { label: string; color: string }> = {
  llm: { label: 'LLM', color: 'text-blue-400' },
  embedding: { label: '向量匹配', color: 'text-yellow-400' },
  default: { label: '默认', color: 'text-muted-foreground' },
};

// ─── 运行监控标签 ──────────────────────────

function MonitorTab() {
  const routeStatus = useIntentRoutingStore((s) => s.status);
  const routeResult = useIntentRoutingStore((s) => s.result);
  const promptLayers = useIntentRoutingStore((s) => s.promptLayers);
  const totalComponents = useIntentRoutingStore((s) => s.totalComponents);
  const estimatedTokens = useIntentRoutingStore((s) => s.estimatedTokens);

  const scenes = routeResult?.scene
    ? routeResult.scene.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const methodInfo = routeResult ? METHOD_CONFIG[routeResult.method] ?? METHOD_CONFIG.default : null;

  return (
    <div className="h-full flex flex-col">
      {routeStatus !== 'idle' && (
        <div className="flex-shrink-0 mx-3 mt-3 p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold">意图分析</span>
            {routeStatus !== 'analyzing' && (
              <span className="text-[10px] text-green-400">已完成</span>
            )}
          </div>
          {routeResult && (
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-blue-400 font-medium">{routeResult.agentId}</span>
                {methodInfo && (
                  <span className={methodInfo.color}>
                    {t('rightpanel.method_label')}: {methodInfo.label}
                  </span>
                )}
                {routeResult.confidence > 0 && (
                  <span className="text-muted-foreground/50 ml-auto">
                    {(routeResult.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {scenes.length > 0 && (
                  <span className="text-purple-400/80">{scenes.join(', ')}</span>
                )}
                {scenes.length > 0 && <span className="text-muted-foreground/40">·</span>}
                <span className={routeResult.complexity === 'complex' ? 'text-amber-400/80' : 'text-emerald-400/80'}>
                  {routeResult.complexity === 'complex' ? '高复杂度' : '低复杂度'}
                </span>
                {routeResult.modelName && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-muted-foreground/70">{routeResult.modelName}</span>
                  </>
                )}
              </div>
              {promptLayers.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground select-none">
                    Prompt 组件 ({totalComponents} 层, ~{estimatedTokens}t)
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto space-y-1">
                    {promptLayers.map((layer) => (
                      <div key={layer.layer} className="pl-2 border-l border-border">
                        <span className="text-[10px] text-muted-foreground">L{layer.layer}</span>
                        <div className="ml-2 mt-0.5 space-y-0.5">
                          {layer.components.map((c) => (
                            <div key={c.id} className="text-[10px] text-muted-foreground/70 truncate">{c.name}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ExecutionFlowV2 />
      </div>
    </div>
  );
}

// ─── 日志标签 ──────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖', write_file: '📝', edit_file: '✏️', multi_edit: '📋',
  bash: '💻', glob: '🔎', grep: '🔍', ls: '📂',
  web_fetch: '🌐', plan_review: '📋', ask_user: '❓',
  todo_create: '✅', todo_list: '📋', todo_update: '🔄',
  memory_search: '🧠', memory_store: '💾', memory_stats: '📊', memory_graph: '🕸️',
};

type TimelineEntry =
  | { kind: 'log'; timestamp: number; level: string; message: string; id: string }
  | { kind: 'tool'; id: string; name: string; status: string; timestamp: number; input?: any; output?: any; error?: string };

function LogsTab() {
  const logs = useSessionStore((state) => state.logs);
  const clearLogs = useSessionStore((state) => state.clearLogs);
  const agentMap = useAgentStateMachine((state) => state.agentMap);
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  const toolCalls = useMemo(() => {
    return Object.values(agentMap)
      .flatMap(a => a.currentTools || [])
      .map(t => ({
        kind: 'tool' as const,
        id: t.id,
        name: t.name,
        status: t.status,
        timestamp: t.startTime || 0,
        input: t.input,
        output: t.output,
        error: t.status === 'error' ? t.output?.slice(0, 500) : undefined,
      }));
  }, [agentMap]);

  const timeline = useMemo(() => {
    const logEntries: TimelineEntry[] = logs.map((log, i) => ({
      kind: 'log',
      id: `log-${i}-${log.timestamp}`,
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
    }));
    return [...logEntries, ...toolCalls].sort((a, b) => b.timestamp - a.timestamp);
  }, [logs, toolCalls]);

  const filtered = useMemo(() => {
    if (!filter) return timeline;
    if (filter === 'tool') return timeline.filter(e => e.kind === 'tool');
    return timeline.filter(e => e.kind === 'log' && e.level === filter);
  }, [timeline, filter]);

  const levelColors: Record<string, string> = {
    error: 'text-red-500',
    warn: 'text-yellow-500',
    info: 'text-green-500',
    debug: 'text-primary',
    tool: 'text-blue-400',
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  return (
    <div className="h-full flex flex-col p-3 gap-3">
      <div className="text-xs font-semibold">日志流</div>

      <div className="inline-flex rounded-md bg-muted p-0.5 gap-0.5 self-start">
        {[
          { value: null, label: '全部' },
          { value: 'error', label: '错误' },
          { value: 'warn', label: '警告' },
          { value: 'info', label: '信息' },
          { value: 'tool', label: '工具' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => { setFilter(item.value); setExpandedCall(null); }}
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
              filter === item.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-8">
          暂无记录
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 text-xs">
          {filtered.map((entry) => {
            if (entry.kind === 'log') {
              return (
                <div key={entry.id} className="p-2 bg-background rounded font-mono">
                  <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>{' '}
                  <span className={levelColors[entry.level] || 'text-muted-foreground'}>
                    {entry.level.toUpperCase()}
                  </span>{' '}
                  <span>{entry.message}</span>
                </div>
              );
            }

            const call = entry;
            const isExpanded = expandedCall === call.id;
            const statusIcon = call.status === 'success' ? '✓' : call.status === 'error' ? '✗' : '…';
            const statusColor = call.status === 'success' ? 'text-green-500' : call.status === 'error' ? 'text-red-500' : 'text-yellow-500';

            return (
              <div key={call.id} className="bg-background rounded overflow-hidden">
                <button
                  onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                  className="w-full p-2 text-left flex items-center justify-between hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={statusColor}>{statusIcon}</span>
                    <span>{TOOL_ICONS[call.name] || '🔧'}</span>
                    <span className="font-medium">{call.name}</span>
                    {!isExpanded && call.status === 'success' && call.output && (
                      <span className="text-muted-foreground truncate max-w-[120px]">
                        {typeof call.output === 'string' ? call.output.slice(0, 60) : JSON.stringify(call.output).slice(0, 60)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                    <span>{formatTime(call.timestamp)}</span>
                    <span className="text-[10px]">{isExpanded ? '▴' : '▾'}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-2 space-y-2 text-xs border-t border-border/30 pt-2">
                    {call.input && (
                      <div>
                        <div className="text-muted-foreground mb-1">输入参数</div>
                        <pre className="bg-card p-2 rounded overflow-x-auto text-xs max-h-32 overflow-y-auto">
                          {JSON.stringify(call.input, null, 2)}
                        </pre>
                      </div>
                    )}
                    {call.status === 'success' && call.output && (
                      <div>
                        <div className="text-muted-foreground mb-1">输出结果</div>
                        <pre className="bg-card p-2 rounded overflow-x-auto text-xs max-h-48 overflow-y-auto">
                          {typeof call.output === 'string' ? call.output : JSON.stringify(call.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {call.status === 'error' && call.error && (
                      <div>
                        <div className="text-red-500 mb-1">错误信息</div>
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
      )}

      {timeline.length > 0 && (
        <div className="flex gap-2 flex-shrink-0">
          <Button onClick={clearLogs} variant="ghost" size="sm">
            清除日志
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── 远端会话标签 ──────────────────────────

function RemoteTab() {
  const { sessions, activeSessionId } = usePlatformStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  return <PlatformSessionPanel session={activeSession} />;
}
