// ============================================================
// MessageBubble - 消息气泡组件
// ============================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { User, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import type { Message } from '../stores/chatStore';
import { useChatStore } from '../stores/chatStore';
import { useRuntimeStore } from '../stores/runtimeStore';
import MilkdownEditor from './MilkdownEditor';

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

  const displayContent = isStreaming && streamingText !== undefined ? streamingText : message.content;

  const processedContent = useMemo(() => {
    if (typeof displayContent !== 'string') return '';
    // 只做标题规范化，📎 语法由 Milkdown 的 $remark 插件 + 自定义节点处理
    return normalizeMarkdownHeadings(displayContent);
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

        const state = useChatStore.getState();
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

        const state = useChatStore.getState();
        const list = state.citationOutputs[name];
        const citation = list && list.length > index ? list[index] : (list && list.length > 0 ? list[list.length - 1] : null);

        const anchor = document.createElement('span');
        anchor.style.cssText = 'display:inline;';
        span.replaceWith(anchor);
        const root = createRoot(anchor);
        root.render(<CitationChip name={name} quote={quote} citation={citation} />);
        roots.push(root);
      });
    }

    const timer = setTimeout(enhance, 300);

    // 流式输出时监听 DOM 变化，持续注入交互组件
    const observer = new MutationObserver(() => {
      enhance();
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
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
              ? 'bg-bg-tertiary/50 border border-border-primary text-text-primary'
              : 'bg-bg-secondary text-text-primary'
        } rounded-lg p-4 shadow-lg overflow-hidden`}
      >
        {/* 消息头部 */}
        <div className="flex items-center gap-2 mb-2">
          {isUser ? <User size={16} /> : <Bot size={16} className="text-primary" />}
          <span className="text-sm font-semibold">{isUser ? 'You' : 'Assistant'}</span>
          {message.timestamp && (
            <span className="text-xs opacity-60 ml-auto">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {!isUser && message.statusHint && (
          <div className="mb-2 text-xs text-text-secondary animate-pulse">{message.statusHint}</div>
        )}

        {/* 消息内容 — Milkdown 渲染 */}
        <div ref={containerRef} className="max-w-none text-text-primary milkdown-message-content">
          {typeof displayContent === 'string' ? (
            <MilkdownEditor value={processedContent} mode="preview" />
          ) : (
            <div className="text-sm">[复杂内容]</div>
          )}
        </div>

        {/* 耗时 & Token */}
        {!isUser && !isSystem && (message.duration || message.tokensUsed) && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border-primary/50 text-xs text-text-tertiary">
            {message.duration && <span className="flex items-center gap-1">⏱ {formatDuration(message.duration)}</span>}
            {message.tokensUsed && <span className="flex items-center gap-1">🎯 {formatTokens(message.tokensUsed)}</span>}
          </div>
        )}

        {!isUser && !isSystem && isStreaming && message.timestamp && (
          <StreamingStats timestamp={message.timestamp} />
        )}
      </div>
    </div>
  );
});

/** 子 Agent 块引用 — 可展开/收起 */
function SubAgentBlock({ name, citation }: { name: string; citation: SubAgentReference | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-flex flex-col my-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border border-primary/20 text-sm"
      >
        📎 <strong className="underline decoration-dotted">{name}</strong>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && citation && (
        <div className="mt-1 ml-2 border border-primary/20 rounded-lg bg-bg-tertiary/10 p-3 max-h-60 overflow-y-auto">
          <div className="text-xs text-text-primary whitespace-pre-wrap font-mono">{citation.originalOutput}</div>
          <div className="mt-1 text-xs text-text-tertiary">
            {(citation.duration / 1000).toFixed(1)}s · {citation.tokensUsed.input + citation.tokensUsed.output} tokens
          </div>
        </div>
      )}
    </span>
  );
}

/** 引用语法 📎 [Name]："quote" — 可点击查看完整输出 */
function CitationChip({ name, quote, citation }: { name: string; quote: string; citation: SubAgentReference | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-flex items-baseline gap-1 text-sm">
      {citation ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border border-primary/20"
        >
          📎 <strong className="underline decoration-dotted">{name}</strong>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary/50 text-text-secondary cursor-default">
          📎 <strong>{name}</strong>
        </span>
      )}
      <span className="text-text-secondary">：{quote}</span>
      {expanded && citation && (
        <span className="block w-full mt-1 ml-2 border border-primary/20 rounded-lg bg-bg-tertiary/10 p-3 max-h-60 overflow-y-auto">
          <span className="text-xs text-text-primary whitespace-pre-wrap font-mono">{citation.originalOutput}</span>
          <span className="block mt-1 text-xs text-text-tertiary">
            {(citation.duration / 1000).toFixed(1)}s · {citation.tokensUsed.input + citation.tokensUsed.output} tokens
          </span>
        </span>
      )}
    </span>
  );
}

export default MessageBubble;
