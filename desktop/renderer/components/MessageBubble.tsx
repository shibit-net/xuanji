// ============================================================
// MessageBubble - 消息气泡组件
// ============================================================

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import type { Message } from '../stores/chatStore';
import { useMessageStore } from '../stores/messageStore';
import type { SubAgentReference } from '../stores/chatStore';
import { useRuntimeStore } from '../stores/runtimeStore';
import { useAuthStore } from '../stores/authStore';
import { useActiveAgentStore } from '../stores/activeAgentStore';
import MilkdownEditor from './MilkdownEditor';
import { Avatar } from './Avatar';
import { isFilePath, toNativePath } from '../utils/pathUtils';

// 主 agent 头像
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';

function getAgentDisplay(agentId: string | undefined): { name: string } {
  if (!agentId || agentId === 'xuanji') return { name: 'Xuanji' };
  // 从 activeAgentStore 查找子 agent
  const agent = useActiveAgentStore.getState().mainAgent;
  if (!agent) return { name: agentId };
  const find = (a: typeof agent): { name: string } | null => {
    if (a.id === agentId) return { name: a.name };
    for (const sub of a.subAgents) {
      const r = find(sub);
      if (r) return r;
    }
    return null;
  };
  return find(agent) || { name: agentId };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTokens(tokens: { input: number; output: number }): string {
  const total = tokens.input + tokens.output;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${total} tokens`;
}

function normalizeMarkdownHeadings(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/([^\n#])(#{2,6})\s/g, '$1\n\n$2 ');
    })
    .join('');
}

/** 确保 markdown 表格后有空行，防止 remark-gfm 将后续文本误解析为表格行 */
function normalizeTableBreaks(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/^(\s*\|[^\n]*)\n(?!\s*$)(?!\s*\|)/gm, '$1\n\n');
    })
    .join('');
}

/** 移除 markdown 中的原始 HTML 标签（<details>/<summary> 等），代码块内保留 */
function stripRawHtml(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/<\/?details>/gi, '')
        .replace(/<summary>(.*?)<\/summary>/gi, '**$1**\n')
        .replace(/<\/?summary>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(div|span|section|article)[^>]*>/gi, '');
    })
    .join('');
}

/** 流式输出统计数据 */
function StreamingStats({ timestamp }: { timestamp: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - timestamp);
  const currentTokens = useRuntimeStore((s) => s.currentCallTokens);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - timestamp), 1000);
    return () => clearInterval(timer);
  }, [timestamp]);

  const totalTokens = (currentTokens?.input || 0) + (currentTokens?.output || 0);

  return (
    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border-primary/50 text-xs text-text-tertiary">
      <span className="flex items-center gap-1">⏱ {formatDuration(elapsed)}</span>
      {totalTokens > 0 && <span className="flex items-center gap-1">🎯 {formatTokens({ input: currentTokens.input, output: currentTokens.output })}</span>}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  streamingText?: string;
}

const MessageBubble = React.memo(function MessageBubble({ message, isStreaming = false, streamingText }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isToolSummary = message.toolSummary === true;
  const containerRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const userName = user?.nickname || user?.email?.split('@')[0] || 'You';
  const agentInfo = useMemo(() => !isUser && !isToolSummary ? getAgentDisplay(message.agentId) : null, [message.agentId, isUser, isToolSummary]);

  const displayContent = isStreaming && streamingText !== undefined ? streamingText : message.content;

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = typeof displayContent === 'string' ? displayContent : '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayContent]);

  const processedContent = useMemo(() => {
    if (typeof displayContent !== 'string') return '';
    // 先去除原始 HTML 标签，再规范化标题，最后确保表格后有空行
    return normalizeTableBreaks(normalizeMarkdownHeadings(stripRawHtml(displayContent)));
  }, [displayContent]);

  // 将 Milkdown 渲染出的自定义节点（subagent-ref / citation-ref span）替换为可交互组件
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isUser || isSystem) return;

    const roots: Array<ReturnType<typeof createRoot>> = [];

    function enhance() {
      roots.forEach((r) => r.unmount());
      roots.length = 0;

      // 按文档顺序精确匹配：第 n 次出现的 name 取 citationOutputs[name] 的第 n 项
      const nameCounts: Record<string, number> = {};

      // 处理子 Agent 块引用
      container!.querySelectorAll('span[data-type="subagent-ref"]').forEach((el) => {
        const span = el as HTMLSpanElement;
        const name = span.dataset.name || '';
        const index = nameCounts[name] || 0;
        nameCounts[name] = index + 1;

        const state = useMessageStore.getState();
        const list = state.citationOutputs[name];
        const citation = list && list.length > index ? list[index] : (list && list.length > 0 ? list[list.length - 1] : null);

        const anchor = document.createElement('span');
        anchor.style.cssText = 'display:inline-block;vertical-align:middle;';
        span.replaceWith(anchor);
        const root = createRoot(anchor);
        root.render(<SubAgentBlock name={name} citation={citation} />);
        roots.push(root);
      });

      // 处理引用语法（同名引用同理按顺序匹配）
      const citationCounts: Record<string, number> = {};
      container!.querySelectorAll('span[data-type="citation-ref"]').forEach((el) => {
        const span = el as HTMLSpanElement;
        const name = span.dataset.name || '';
        const quote = span.dataset.quote || '';
        const index = citationCounts[name] || 0;
        citationCounts[name] = index + 1;

        const state = useMessageStore.getState();
        const list = state.citationOutputs[name];
        const citation = list && list.length > index ? list[index] : (list && list.length > 0 ? list[list.length - 1] : null);

        const anchor = document.createElement('span');
        anchor.style.cssText = 'display:inline;';
        span.replaceWith(anchor);
        const root = createRoot(anchor);
        root.render(<CitationChip name={name} quote={quote} citation={citation} />);
        roots.push(root);
      });

      // 处理 diff 代码块着色（查找所有代码块，根据内容判断是否为 diff）
      container!.querySelectorAll('pre code').forEach((el) => {
        const code = el as HTMLElement;
        if (code.dataset.diffEnhanced) return;
        const html = code.innerHTML;
        // 检查是否包含 diff 格式的行（+/-/@@ 开头）
        const textLines = html.replace(/<[^>]*>/g, '').trim().split('\n').filter(Boolean);
        const isDiff = textLines.some(l => l.trim().match(/^[+-]/) || l.trim().match(/^@@/));
        if (!isDiff) return;
        code.dataset.diffEnhanced = 'true';
        const codeLines = html.split(/\n|<br\s*\/?>/gi).filter(Boolean);
        const enhanced = codeLines.map((line) => {
          const text = line.replace(/<[^>]*>/g, '').trim();
          const lineStyle = (() => {
            if (text.startsWith('+')) return 'color:#4ade80;background:rgba(74,222,128,0.08);';
            if (text.startsWith('-')) return 'color:#f87171;background:rgba(248,113,113,0.08);';
            if (text.startsWith('@@')) return 'color:#94a3b8;';
            return '';
          })();
          return `<span style="display:block;${lineStyle}padding:0 4px;border-radius:2px;">${line}</span>`;
        }).join('\n');
        code.innerHTML = enhanced;
      });

      // 处理 toolSummary 消息中的文件路径 code 元素 — 标记为可点击，CSS 负责样式
      // 事件委托在 MessageBubble 外层由点击事件处理
      container!.querySelectorAll('code').forEach((el) => {
        const code = el as HTMLElement;
        if (code.dataset.fileLinked || code.closest('pre')) return;
        const text = code.textContent?.trim() || '';
        if (!isFilePath(text)) return;
        const displayPath = toNativePath(text);
        code.dataset.fileLinked = text;
        code.className = 'tool-summary-filepath';
        const iconSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style="flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        code.innerHTML = `${iconSvg} ${displayPath}`;
      });
    }

    // 多级重试，确保 Milkdown 渲染完成后一定能替换引用标签
    // Milkdown 的 ProseMirror 创建是异步的，可能比 React effect 慢
    const retryDelays = [200, 600, 1500, 4000];
    const timers: ReturnType<typeof setTimeout>[] = [];

    function scheduleRetry(delay: number) {
      const timer = setTimeout(() => {
        // 检查容器中是否有引用 span，有才执行 enhance（避免空跑）
        const hasSpans = container!.querySelector('span[data-type="subagent-ref"], span[data-type="citation-ref"]');
        if (hasSpans) {
          enhance();
        }
      }, delay);
      timers.push(timer);
    }

    retryDelays.forEach(scheduleRetry);

    // MutationObserver：Milkdown 异步渲染完成后自动触发
    let observerRaf = 0;
    const observer = new MutationObserver(() => {
      // 用 rAF 防抖，避免 ProseMirror 连续更新时高频触发
      cancelAnimationFrame(observerRaf);
      observerRaf = requestAnimationFrame(() => {
        enhance();
      });
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(observerRaf);
      observer.disconnect();
      roots.forEach((r) => r.unmount());
    };
  }, [processedContent, isUser, isSystem]);

  if (isSystem) {
    return (
      <div className={`flex justify-center my-4${isStreaming ? '' : ' animate-fadeIn'}`}>
        <div className="max-w-[80%] bg-bg-tertiary/30 border border-border-primary rounded-lg p-3 text-sm text-text-secondary text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}${isStreaming ? '' : ' animate-fadeIn'}`}>
      <div
        className={`message-bubble max-w-[80%] min-w-0 ${
          isUser
            ? 'bg-primary text-white'
            : isToolSummary
              ? 'bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm text-text-primary'
              : 'bg-white/[0.06] text-text-primary'
        } rounded-xl p-4 shadow-lg overflow-y-auto max-h-[60vh]`}
        onClick={(e) => {
          // 事件委托：处理文件路径 code 点击
          const target = e.target as HTMLElement;
          const filePathEl = target.closest('[data-file-linked]');
          if (filePathEl) {
            const path = filePathEl.getAttribute('data-file-linked');
            if (path) {
              e.preventDefault();
              e.stopPropagation();
              window.electron.openFile(path);
              return;
            }
          }
          // 事件委托：处理普通链接点击（用系统浏览器打开）
          const linkEl = target.closest('a');
          if (linkEl && linkEl.href && !linkEl.dataset.fileLinked) {
            const href = linkEl.getAttribute('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
              e.preventDefault();
              e.stopPropagation();
              // 通过 Electron IPC 调用 shell.openExternal 打开系统默认浏览器
              window.electron.openUrl(href);
            }
          }
        }}
      >
        {/* 消息头部 */}
        <div className="flex items-center gap-2 mb-2">
          {isUser ? (
            user?.avatar ? (
              <img src={user.avatar} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
            ) : (
              <Avatar seed={user?.email || user?.nickname || 'user'} size={20} className="w-5 h-5 rounded-full" />
            )
          ) : isToolSummary ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 flex-shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          ) : (
            <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
              {message.agentId === 'xuanji' || !message.agentId ? (
                <img src={agentAvatar} alt="Xuanji" className="w-full h-full object-cover" />
              ) : (
                <Avatar seed={agentInfo?.name || message.agentId} size={20} className="w-full h-full rounded-full" />
              )}
            </div>
          )}
          <span className={`text-sm font-semibold ${isToolSummary ? 'text-white/50' : ''}`}>
            {isUser
              ? userName
              : isToolSummary
              ? '文件变更'
              : (agentInfo?.name || 'Xuanji')}
          </span>
          {message.timestamp && (
            <span className="text-xs opacity-60 ml-auto">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {/* 复制按钮 — 非流式消息显示 */}
          {!isStreaming && typeof displayContent === 'string' && displayContent.length > 0 && (
            <button
              onClick={handleCopy}
              className="ml-1 p-1 rounded-md hover:bg-white/10 transition-colors flex-shrink-0"
              title="复制消息"
            >
              {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} className="text-white/40 hover:text-white/70" />}
            </button>
          )}
        </div>

        {!isUser && message.statusHint && (
          <div className="mb-2 text-xs text-text-secondary animate-pulse">{message.statusHint}</div>
        )}

        {/* 消息内容 — 流式时纯文本渲染，完成后 Milkdown 渲染 */}
        <div ref={containerRef} className="max-w-none text-text-primary milkdown-message-content">
          {typeof displayContent === 'string' ? (
            isStreaming ? (
              <div className="text-sm whitespace-pre-wrap">{displayContent}</div>
            ) : (
              <MilkdownEditor value={processedContent} mode="preview" />
            )
          ) : (
            <div className="text-sm">[复杂内容]</div>
          )}
        </div>

        {/* 耗时 & Token */}
        {!isUser && !isSystem && (message.duration || message.tokensUsed) && (
          <div className={`flex items-center gap-3 mt-2 pt-2 border-t text-xs ${
            isToolSummary
              ? 'border-white/[0.06] text-white/30'
              : 'border-border-primary/50 text-text-tertiary'
          }`}>
            {message.duration && <span>⏱ {formatDuration(message.duration)}</span>}
            {message.tokensUsed && <span>{formatTokens(message.tokensUsed)}</span>}
          </div>
        )}

        {!isUser && !isSystem && isStreaming && message.timestamp && (
          <StreamingStats timestamp={message.timestamp} />
        )}
      </div>
    </div>
  );
});

/** 子 Agent 块引用 — 可展开/收起（visionOS 玻璃拟态风格） */
function SubAgentBlock({ name, citation }: { name: string; citation: SubAgentReference | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-flex flex-col my-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg
                   bg-white/[0.06] hover:bg-white/[0.1]
                   border border-white/[0.1] hover:border-white/[0.15]
                   text-xs text-blue-400
                   transition-all duration-200 cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <span className="font-medium truncate max-w-[120px]">{name}</span>
        {expanded ? <ChevronUp size={11} className="text-white/40" /> : <ChevronDown size={11} className="text-white/40" />}
      </button>
      {expanded && citation && (
        <div className="mt-1.5 ml-1 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm p-3 max-h-60 overflow-y-auto">
          <div className="text-xs text-white/70 whitespace-pre-wrap font-mono leading-relaxed">{citation.originalOutput}</div>
          <div className="mt-2 pt-2 border-t border-white/[0.06] text-[10px] text-white/30 flex items-center gap-3">
            <span>⏱ {(citation.duration / 1000).toFixed(1)}s</span>
            <span>●</span>
            <span>{citation.tokensUsed.input + citation.tokensUsed.output} tokens</span>
          </div>
        </div>
      )}
    </span>
  );
}

/** 引用语法 —— 可点击查看完整输出（visionOS 玻璃拟态风格） */
function CitationChip({ name, quote, citation }: { name: string; quote: string; citation: SubAgentReference | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-flex flex-col my-0.5">
      <span className="inline-flex items-baseline gap-1 text-sm leading-relaxed">
        {citation ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg
                       bg-white/[0.06] hover:bg-white/[0.1]
                       border border-white/[0.1] hover:border-white/[0.15]
                       text-xs text-blue-400
                       transition-all duration-200 cursor-pointer"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span className="font-medium">{name}</span>
            {expanded ? <ChevronUp size={10} className="text-white/40" /> : <ChevronDown size={10} className="text-white/40" />}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/[0.04] text-white/40 text-xs cursor-default border border-white/[0.06]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>{name}</span>
          </span>
        )}
        <span className="text-white/50">：{quote}</span>
        {expanded && citation && (
          <span className="block w-full mt-1.5 ml-1 rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm p-3 max-h-60 overflow-y-auto">
            <span className="text-xs text-white/70 whitespace-pre-wrap font-mono leading-relaxed">{citation.originalOutput}</span>
            <span className="block mt-2 pt-2 border-t border-white/[0.06] text-[10px] text-white/30 flex items-center gap-3">
              ⏱ {(citation.duration / 1000).toFixed(1)}s&nbsp;●&nbsp;{citation.tokensUsed.input + citation.tokensUsed.output} tokens
            </span>
          </span>
        )}
      </span>
    </span>
  );
}

export default MessageBubble;
