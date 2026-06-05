// ============================================================
// MainPage - 主聊天页面（两列等分布局）
// ============================================================
// 聊天区 (50%) | 监控面板 (50%)
// ============================================================

import React from 'react';
import ChatArea from '../components/ChatArea';
import RemoteChatArea from '../components/RemoteChatArea';
import MonitorPanel from '../components/MonitorPanel';
import InputArea from '../components/InputArea';
import TodoPanel from '../components/TodoPanel';
import Aurora from '@/components/Aurora';
import { Loader2 } from 'lucide-react';
import { useConversationStore } from '../stores/ConversationStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useSessionStore } from '../stores/sessionStore';
import { usePlatformStore } from '../stores/platformStore';
import { registerEventAdapter } from '../services/EventAdapter';
import { t } from '@/i18n';

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function MainPage() {
  React.useEffect(() => { registerEventAdapter(); }, []);

  // 检测暗色模式（html 上的 .dark class）
  const [isDark, setIsDark] = React.useState(
    () => document.documentElement.classList.contains('dark'),
  );
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Aurora 极光色阶：浅色/深色模式使用 xuanji 主蓝色 hsl(211, ...)
  const auroraColors = React.useMemo<string[]>(
    () =>
      isDark
        ? ['#0044cc', '#0077ff', '#3399ff'] // dark: hsl(211, 100%, 50%)
        : ['#1a5fa9', '#2b7fc2', '#4a9ed9'], // light: hsl(211, 65%, 50%)
    [isDark],
  );

  const currentIteration = useConversationStore((s) => s.iteration);
  const sessionStatus = useSessionStore((s) => s.initStatus);

  // 用 primitive selector 避免整个 agentMap 变化时重渲染
  const tokenKey = useAgentStateMachine((s) => {
    let input = 0, output = 0, cached = 0;
    for (const a of Object.values(s.agentMap)) {
      input += a.stats.tokenUsage.input || 0;
      output += a.stats.tokenUsage.output || 0;
      cached += a.stats.tokenUsage.cached || 0;
    }
    return `${input}|${output}|${cached}`;
  });
  const totalTokens = React.useMemo(() => {
    const [input, output, cached] = tokenKey.split('|').map(Number);
    return { input, output, cached };
  }, [tokenKey]);

  const activeSessionId = usePlatformStore((s) => s.activeSessionId);
  const remoteSessions = usePlatformStore((s) => s.sessions);
  const remoteSessionKey = activeSessionId
    ? remoteSessions.find((s) => s.id === activeSessionId)?.sessionKey
    : undefined;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Aurora 极光背景 — 仅在状态栏高度，弱化渲染 */}
      <div
        className="absolute top-0 left-0 right-0 z-0 pointer-events-none opacity-50"
        style={{ height: '36px' }}
      >
        <Aurora colorStops={auroraColors} amplitude={0.3} blend={0.15} />
      </div>

      {/* 左侧：聊天区 */}
      <div className="relative z-10 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden border-r border-border">
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-border bg-muted/30">
          {sessionStatus !== 'ready' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              {sessionStatus === 'initializing' ? (
                <>
                  <Loader2 size={12} className="animate-spin text-blue-400" />
                  <span className="text-blue-400">{t('mainpage.initializing')}</span>
                </>
              ) : sessionStatus === 'failed' ? (
                <>
                  <span className="text-red-400">{t('mainpage.session_unavailable')}</span>
                  <button
                    onClick={() => useSessionStore.getState().retry()}
                    className="text-blue-400 hover:underline"
                  >
                    {t('mainpage.retry')}
                  </button>
                </>
              ) : null}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span>{t('mainpage.iterations', { n: currentIteration })}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-amber-400/80" title="输入 token（含缓存写入）">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              {t('mainpage.token_input', { n: formatToken(totalTokens.input) })}
            </span>
            <span className="flex items-center gap-1 text-green-400/80" title="输出 token">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              {t('mainpage.token_output', { n: formatToken(totalTokens.output) })}
            </span>
            {totalTokens.input + totalTokens.output > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground font-medium" title="累计 token">
                {t('mainpage.token_total', { n: formatToken(totalTokens.input + totalTokens.output) })}
              </span>
            )}
          </div>
        </div>
        {activeSessionId ? <RemoteChatArea /> : <ChatArea />}
        <TodoPanel />
        <InputArea
          conversationType={activeSessionId ? 'remote' : 'local'}
          sessionKey={remoteSessionKey}
        />
      </div>

      {/* 右侧：监控面板 */}
      <div className="relative z-10 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <MonitorPanel />
      </div>
    </div>
  );
}
