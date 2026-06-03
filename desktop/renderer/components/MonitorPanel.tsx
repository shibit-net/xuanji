// ============================================================
// MonitorPanel - 等分列监控面板（替换 RightPanel）
// ============================================================

import React, { useState, useMemo, memo } from 'react';
import { Activity, FileText, Radio, Check, X, MoreHorizontal, ChevronUp, ChevronDown, Wrench, Search, Globe, Terminal, FolderOpen, FileQuestion, FilePenLine, ClipboardList, ListTodo, RotateCcw, Brain, Database, BarChart3, GitGraph, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '../stores/sessionStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useIntentRoutingStore } from '../stores/IntentRoutingStore';
import { usePlatformStore } from '../stores/platformStore';
import { useConfigStore } from '../stores/configStore';
import { t } from '@/core/i18n';
import ExecutionFlowV2 from './ExecutionFlowV2';
import PlatformSessionPanel from './PlatformSessionPanel';

function formatTimestamp(ts: number, language: string) {
  return new Date(ts).toLocaleTimeString(language === 'en' ? 'en-US' : 'zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

type TabId = 'monitor' | 'logs' | 'remote';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'monitor', label: t('rightpanel.tab.monitor'), icon: <Activity size={14} /> },
  { id: 'logs', label: t('rightpanel.tab.logs'), icon: <FileText size={14} /> },
  { id: 'remote', label: t('rightpanel.tab.remote'), icon: <Radio size={14} /> },
];

function MonitorPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('monitor');

  return (
    <div className="h-full flex flex-col">
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

const METHOD_CONFIG: Record<string, { labelKey: string; color: string }> = {
  llm: { labelKey: 'rightpanel.llm_label', color: 'text-blue-400' },
  embedding: { labelKey: 'rightpanel.vector_label', color: 'text-yellow-400' },
  default: { labelKey: 'rightpanel.method_default', color: 'text-muted-foreground' },
};

// ─── 运行监控标签 ──────────────────────────

function MonitorTab() {
  const routeStatus = useIntentRoutingStore((s) => s.status);
  const routeResult = useIntentRoutingStore((s) => s.result);
  const routeStages = useIntentRoutingStore((s) => s.stages);
  const promptLayers = useIntentRoutingStore((s) => s.promptLayers);
  const totalComponents = useIntentRoutingStore((s) => s.totalComponents);
  const estimatedTokens = useIntentRoutingStore((s) => s.estimatedTokens);

  const scenes = routeResult?.scene
    ? routeResult.scene.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const methodInfo = routeResult ? METHOD_CONFIG[routeResult.method] ?? METHOD_CONFIG.default : null;

  const isAnalyzing = routeStatus === 'analyzing';
  const isDone = routeStatus === 'done';

  const currentStage = routeStages.find((s) => s.status === 'running');
  const analyzingMethod = currentStage?.method ?? null;
  const analyzingLabel = analyzingMethod === 'llm'
    ? t('rightpanel.method_llm')
    : analyzingMethod === 'embedding'
      ? t('rightpanel.method_embedding')
      : analyzingMethod === 'default'
        ? t('rightpanel.method_default')
        : t('rightpanel.analyzing');
  const methodColor = analyzingMethod === 'llm'
    ? 'text-blue-400'
    : analyzingMethod === 'embedding'
      ? 'text-yellow-400'
      : 'text-muted-foreground';

  return (
    <div className="h-full flex flex-col">
      {routeStatus !== 'idle' && (
        <div className="flex-shrink-0 mx-3 mt-3 p-3 rounded-lg bg-muted">
          {/* 标题行 */}
          <div className="flex items-center gap-2 mb-2">
            {isAnalyzing && <Loader2 size={12} className={`animate-spin shrink-0 ${analyzingMethod ? methodColor : 'text-blue-400'}`} />}
            <span className="text-[11px] font-semibold text-foreground">{t('rightpanel.intent_analysis')}</span>
            {isAnalyzing && (
              <span className={`text-[10px] ${analyzingMethod ? methodColor : 'text-blue-400'}`}>{analyzingLabel}</span>
            )}
            {isDone && (
              <span className="text-[10px] text-emerald-400">{t('rightpanel.analysis_complete')}</span>
            )}
          </div>

          {/* 完成后的结果展示 */}
          {isDone && routeResult && (
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-blue-400 font-medium">{routeResult.agentId}</span>
                {methodInfo && (
                  <span className={methodInfo.color}>
                    {t('rightpanel.method_label')}: {t(methodInfo.labelKey)}
                  </span>
                )}
                {routeResult.confidence > 0 && (
                  <span className="text-muted-foreground ml-auto">
                    {(routeResult.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {scenes.length > 0 && (
                  <span className="text-purple-400">{scenes.join(', ')}</span>
                )}
                {scenes.length > 0 && <span className="text-muted-foreground/60">·</span>}
                <span className={routeResult.complexity === 'complex' ? 'text-amber-400' : 'text-emerald-400'}>
                  {routeResult.complexity === 'complex' ? t('rightpanel.complexity_complex') : t('rightpanel.complexity_simple')}
                </span>
                {routeResult.modelName && (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-foreground/70">{routeResult.modelName}</span>
                  </>
                )}
              </div>
              {promptLayers.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground/70 select-none">
                    {t('rightpanel.prompt_components', { count: totalComponents, tokens: estimatedTokens })}
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto space-y-1">
                    {promptLayers.map((layer) => (
                      <div key={layer.layer} className="pl-2">
                        <span className="text-[10px] text-muted-foreground">L{layer.layer}</span>
                        <div className="ml-2 mt-0.5 space-y-0.5">
                          {layer.components.map((c) => (
                            <div key={c.id} className="text-[10px] text-foreground/60 truncate">{c.name}</div>
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

function ToolIcon({ name }: { name: string }) {
  const cls = 'w-3 h-3';
  switch (name) {
    case 'read_file': return <FileText size={12} />;
    case 'write_file': return <FilePenLine size={12} />;
    case 'edit_file': return <FilePenLine size={12} />;
    case 'multi_edit': return <ClipboardList size={12} />;
    case 'bash': return <Terminal size={12} />;
    case 'glob': return <Search size={12} />;
    case 'grep': return <Search size={12} />;
    case 'ls': return <FolderOpen size={12} />;
    case 'web_fetch': return <Globe size={12} />;
    case 'plan_review': return <ClipboardList size={12} />;
    case 'ask_user': return <FileQuestion size={12} />;
    case 'todo_create': return <ListTodo size={12} />;
    case 'todo_list': return <ListTodo size={12} />;
    case 'todo_update': return <RotateCcw size={12} />;
    case 'memory_search': return <Brain size={12} />;
    case 'memory_store': return <Database size={12} />;
    case 'memory_stats': return <BarChart3 size={12} />;
    case 'memory_graph': return <GitGraph size={12} />;
    default: return <Wrench size={12} />;
  }
}

type TimelineEntry =
  | { kind: 'log'; timestamp: number; level: string; message: string; id: string }
  | { kind: 'tool'; id: string; name: string; status: string; timestamp: number; input?: any; output?: any; error?: string };

function LogsTab() {
  const logs = useSessionStore((state) => state.logs);
  const clearLogs = useSessionStore((state) => state.clearLogs);
  // 用 primitive selector 避免每次 agent 事件重渲染整个日志列表
  const toolsKey = useAgentStateMachine((s) => {
    const parts: string[] = [];
    for (const a of Object.values(s.agentMap)) {
      for (const t of a.currentTools || []) {
        parts.push(`${t.id}\x00${t.name}\x00${t.status}\x00${t.startTime || 0}\x00${t.output ? 1 : 0}\x00${t.status === 'error' ? (t.output || '').slice(0, 20) : ''}`);
      }
    }
    return parts.sort().join('\x01');
  });
  const language = useConfigStore((s) => s.settings.language);
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  // toolCalls 需要完整数据，回退到 getState() 快照读取，仅在 toolsKey 变化时重组
  const toolCalls = useMemo(() => {
    const agentMap = useAgentStateMachine.getState().agentMap;
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
  }, [toolsKey]);

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

  const formatTime = (ts: number) => formatTimestamp(ts, language);

  return (
    <div className="h-full flex flex-col p-3 gap-3">
      <div className="text-xs font-semibold">{t('rightpanel.log_stream')}</div>

      <div className="inline-flex rounded-md bg-muted p-0.5 gap-0.5 self-start">
        {[
          { value: null, label: t('rightpanel.filter_all') },
          { value: 'error', label: t('rightpanel.filter_error') },
          { value: 'warn', label: t('rightpanel.filter_warn') },
          { value: 'info', label: t('rightpanel.filter_info') },
          { value: 'tool', label: t('rightpanel.filter_tool') },
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
          {t('rightpanel.no_records')}
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
            const StatusIcon = call.status === 'success' ? Check : call.status === 'error' ? X : MoreHorizontal;
            const statusColor = call.status === 'success' ? 'text-green-500' : call.status === 'error' ? 'text-red-500' : 'text-yellow-500';

            return (
              <div key={call.id} className="bg-background rounded overflow-hidden">
                <button
                  onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                  className="w-full p-2 text-left flex items-center justify-between hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon size={12} className={statusColor} />
                    <ToolIcon name={call.name} />
                    <span className="font-medium">{call.name}</span>
                    {!isExpanded && call.status === 'success' && call.output && (
                      <span className="text-muted-foreground truncate max-w-[120px]">
                        {typeof call.output === 'string' ? call.output.slice(0, 60) : JSON.stringify(call.output).slice(0, 60)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                    <span>{formatTime(call.timestamp)}</span>
                    {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-2 space-y-2 text-xs pt-2">
                    {call.input && (
                      <div>
                        <div className="text-muted-foreground mb-1">{t('rightpanel.input_params')}</div>
                        <pre className="bg-card p-2 rounded overflow-x-auto text-xs max-h-32 overflow-y-auto">
                          {JSON.stringify(call.input, null, 2)}
                        </pre>
                      </div>
                    )}
                    {call.status === 'success' && call.output && (
                      <div>
                        <div className="text-muted-foreground mb-1">{t('rightpanel.output_result')}</div>
                        <pre className="bg-card p-2 rounded overflow-x-auto text-xs max-h-48 overflow-y-auto">
                          {typeof call.output === 'string' ? call.output : JSON.stringify(call.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {call.status === 'error' && call.error && (
                      <div>
                        <div className="text-red-500 mb-1">{t('rightpanel.error_info')}</div>
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
            {t('rightpanel.clear_logs')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── 远端会话标签 ──────────────────────────

function RemoteTab() {
  const sessions = usePlatformStore((s) => s.sessions);
  const activeSessionId = usePlatformStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  return <PlatformSessionPanel session={activeSession} />;
}

export default memo(MonitorPanel);
