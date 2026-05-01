// ============================================================
// MessageBubble - 消息气泡组件
// ============================================================

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Bot, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { Message, SubAgentReference } from '../stores/chatStore';
import { useChatStore } from '../stores/chatStore';
import { useRuntimeStore } from '../stores/runtimeStore';
import { remarkSubAgentReference } from '../utils/remarkSubAgentReference';

// 耗时格式化：ms → 可读字符串
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// Token 用量格式化
function formatTokens(tokens: { input: number; output: number }): string {
  const total = tokens.input + tokens.output;
  if (total >= 1000) {
    return `${(total / 1000).toFixed(1)}k tokens`;
  }
  return `${total} tokens`;
}

/**
 * 规范化 markdown 行内标题
 * LLM 输出 "文本：## 标题" 时 ## 不在行首，不会被解析为标题。
 * 在 ReactMarkdown 解析前插入换行，确保 ##~###### 在行首。
 * 跳过代码块内的内容。
 */
function normalizeMarkdownHeadings(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // 代码块，跳过
      return part.replace(/([^\n#])(#{2,6})\s/g, '$1\n\n$2 ');
    })
    .join('');
}

/** 流式输出时实时展示耗时和 Token */
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
      <span className="flex items-center gap-1">
        ⏱ {formatDuration(elapsed)}
      </span>
      {totalTokens > 0 && (
        <span className="flex items-center gap-1">
          🎯 {formatTokens({ input: currentTokens.input, output: currentTokens.output })}
        </span>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  /** 是否正在流式输出中，用于跳过入场动画和启用性能优化 */
  isStreaming?: boolean;
  /** 流式输出时的实时文本（避免从 messages 数组读取，减少渲染开销） */
  streamingText?: string;
}

const MessageBubble = React.memo(function MessageBubble({ message, isStreaming = false, streamingText }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isToolSummary = message.toolSummary === true;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [expandedReferences, setExpandedReferences] = useState<Set<string>>(new Set());
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());

  const handleCopyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const toggleReference = (agentName: string) => {
    setExpandedReferences((prev) => {
      const next = new Set(prev);
      if (next.has(agentName)) {
        next.delete(agentName);
      } else {
        next.add(agentName);
      }
      return next;
    });
  };

  // 流式输出时使用实时文本，避免从 messages 数组读取导致不必要的重渲染
  const displayContent = isStreaming && streamingText !== undefined ? streamingText : message.content;

  const toggleCitation = (agentName: string) => {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(agentName)) {
        next.delete(agentName);
      } else {
        next.add(agentName);
      }
      return next;
    });
  };

  // 从 chatStore 查找 📎 引用输出
  const getCitationOutput = (agentName: string): SubAgentReference | null => {
    return useChatStore.getState().getCitationOutput(agentName);
  };

  // 从 message.subAgentReferences 中查找对应的引用
  const getSubAgentReference = (agentName: string) => {
    return message.subAgentReferences?.find((ref) => ref.agentName === agentName);
  };

  // System 消息特殊样式
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
          {isUser ? (
            <User size={16} />
          ) : (
            <Bot size={16} className="text-primary" />
          )}
          <span className="text-sm font-semibold">
            {isUser ? 'You' : 'Assistant'}
          </span>
          {message.timestamp && (
            <span className="text-xs opacity-60 ml-auto">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>

        {/* 状态提示（statusHint） */}
        {!isUser && message.statusHint && (
          <div className="mb-2 text-xs text-text-secondary animate-pulse">
            {message.statusHint}
          </div>
        )}

        {/* 消息内容 */}
        <div className="max-w-none text-text-primary">
          {typeof displayContent === 'string' ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkSubAgentReference]}
              components={{
                // 🆕 自定义渲染引用（📎 [Name]："quote"）
                'citation-reference': ({ agentName, quotedText }: any) => {
                  const citation = getCitationOutput(agentName);
                  const isExpanded = expandedCitations.has(agentName);

                  if (!citation) {
                    return (
                      <span className="inline-flex items-center gap-1 text-sm text-text-secondary">
                        <span className="citation-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary/50 text-text-secondary cursor-default">
                          📎 <span className="font-medium">{agentName}</span>
                        </span>
                        <span className="citation-quote text-text-tertiary">：{quotedText}</span>
                      </span>
                    );
                  }

                  return (
                    <span className="inline-flex flex-col">
                      <span className="inline-flex items-center gap-1 text-sm">
                        <button
                          onClick={() => toggleCitation(agentName)}
                          className="citation-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border border-primary/20"
                          title={`查看 ${agentName} 的完整输出`}
                        >
                          📎 <span className="font-medium underline decoration-dotted">{agentName}</span>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                        <span className="citation-quote text-text-secondary">：{quotedText}</span>
                      </span>
                      {isExpanded && (
                        <div className="mt-2 ml-2 border border-primary/20 rounded-lg overflow-hidden bg-bg-tertiary/10">
                          <div className="flex items-center justify-between p-2 bg-bg-tertiary/20 border-b border-border-primary">
                            <div className="flex items-center gap-2 text-xs text-text-secondary">
                              <Bot size={12} className="text-primary" />
                              <span className="font-medium text-text-primary">{citation.agentName}</span>
                              <span>{(citation.duration / 1000).toFixed(1)}s</span>
                              <span>{formatTokens(citation.tokensUsed)}</span>
                            </div>
                          </div>
                          <div className="p-3 text-sm text-text-primary max-h-80 overflow-y-auto whitespace-pre-wrap">
                            {citation.originalOutput}
                          </div>
                        </div>
                      )}
                    </span>
                  );
                },
                // 🔧 自定义渲染子 agent 引用
                'sub-agent-reference': ({ agentName }: any) => {
                  const reference = getSubAgentReference(agentName);
                  const isExpanded = expandedReferences.has(agentName);

                  if (!reference) {
                    // 如果找不到引用数据，显示一个占位符
                    return (
                      <div className="my-3 p-3 bg-bg-tertiary/30 border border-border-primary rounded-lg text-sm text-text-secondary">
                        <span className="opacity-60">引用：{agentName}</span>
                      </div>
                    );
                  }

                  return (
                    <div className="my-3 border border-border-primary rounded-lg overflow-hidden bg-bg-tertiary/20">
                      {/* 引用头部 - 可点击展开/收起 */}
                      <button
                        onClick={() => toggleReference(agentName)}
                        className="w-full flex items-center justify-between p-3 hover:bg-bg-tertiary/30 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Bot size={14} className="text-primary" />
                          <span className="text-sm font-medium text-text-primary">
                            {reference.agentName}
                          </span>
                          <span className="text-xs text-text-secondary">
                            {(reference.duration / 1000).toFixed(1)}s
                          </span>
                          <span className="text-xs text-text-tertiary">
                            {reference.tokensUsed.input + reference.tokensUsed.output} tokens
                          </span>
                        </div>
                        {isExpanded ? (
                          <ChevronUp size={16} className="text-text-secondary" />
                        ) : (
                          <ChevronDown size={16} className="text-text-secondary" />
                        )}
                      </button>

                      {/* 引用内容 - 展开时显示 */}
                      {isExpanded && (
                        <div className="border-t border-border-primary p-4 bg-bg-secondary/50">
                          <div className="text-sm text-text-primary whitespace-pre-wrap font-mono">
                            {reference.originalOutput}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                },
                code({ node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeString = String(children).replace(/\n$/, '');
                  const codeId = `code-${message.id}-${codeString.slice(0, 20)}`;
                  const isBlock = Boolean(match);

                  return isBlock ? (
                    <div className="relative group my-4">
                      <SyntaxHighlighter
                        style={vscDarkPlus as { [key: string]: React.CSSProperties }}
                        language={match![1]}
                        PreTag="div"
                        customStyle={{
                          margin: 0,
                          borderRadius: '0.375rem',
                          fontSize: '0.875rem',
                        }}
                      >
                        {codeString}
                      </SyntaxHighlighter>
                      <button
                        onClick={() => handleCopyCode(codeString, codeId)}
                        className="absolute top-2 right-2 p-1.5 bg-bg-tertiary/80 hover:bg-bg-tertiary rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="复制代码"
                      >
                        {copiedCode === codeId ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} className="text-text-secondary" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <code className="bg-bg-tertiary text-primary px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                      {children}
                    </code>
                  );
                },
                // 标题 - 使用更明显的样式区分
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold mt-6 mb-3 text-text-primary border-b border-border-primary pb-2">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-bold mt-5 mb-2 text-text-primary">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-semibold mt-4 mb-2 text-text-primary">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-base font-semibold mt-3 mb-1 text-text-primary">
                    {children}
                  </h4>
                ),
                h5: ({ children }) => (
                  <h5 className="text-sm font-semibold mt-2 mb-1 text-text-primary">
                    {children}
                  </h5>
                ),
                h6: ({ children }) => (
                  <h6 className="text-sm font-semibold mt-2 mb-1 text-text-secondary">
                    {children}
                  </h6>
                ),
                // 段落
                p: ({ children }) => (
                  <p className="my-3 leading-relaxed text-text-primary">
                    {children}
                  </p>
                ),
                // 列表
                ul: ({ children }) => (
                  <ul className="list-disc list-outside ml-6 my-3 space-y-1 text-text-primary">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-outside ml-6 my-3 space-y-1 text-text-primary">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="my-1 leading-relaxed">
                    {children}
                  </li>
                ),
                // 引用块
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-primary bg-bg-tertiary/30 pl-4 py-2 my-3 italic text-text-secondary">
                    {children}
                  </blockquote>
                ),
                // 链接
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-primary hover:text-primary/80 underline decoration-primary/50 hover:decoration-primary transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                // 粗体和斜体
                strong: ({ children }) => (
                  <strong className="font-bold text-text-primary">
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-text-primary">
                    {children}
                  </em>
                ),
                // 分隔线
                hr: () => (
                  <hr className="my-6 border-t border-border-primary" />
                ),
                // 表格
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-border-primary">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-bg-tertiary">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-border-primary">
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-bg-tertiary/50 transition-colors">
                    {children}
                  </tr>
                ),
                th: ({ children }) => (
                  <th className="border border-border-primary px-4 py-2 text-left font-semibold text-text-primary">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border-primary px-4 py-2 text-text-primary">
                    {children}
                  </td>
                ),
                // details/summary（折叠块）
                details: ({ children }) => (
                  <details className="my-3 border border-border-primary rounded-lg p-3 bg-bg-secondary/50">
                    {children}
                  </details>
                ),
                summary: ({ children }) => (
                  <summary className="cursor-pointer font-semibold text-primary hover:text-primary/80 transition-colors select-none">
                    {children}
                  </summary>
                ),
                // 删除线
                del: ({ children }) => (
                  <del className="line-through text-text-secondary">
                    {children}
                  </del>
                ),
                // 任务列表
                input: ({ type, checked, ...props }) => {
                  if (type === 'checkbox') {
                    return (
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled
                        className="mr-2 align-middle"
                        {...props}
                      />
                    );
                  }
                  return <input type={type} {...props} />;
                },
              }}
            >
              {normalizeMarkdownHeadings(displayContent)}
            </ReactMarkdown>
          ) : (
            <div className="text-sm">
              {/* 工具调用等复杂内容后续实现 */}
              [复杂内容]
            </div>
          )}
        </div>

        {/* 耗时 & Token 统计（仅 assistant 消息完成后展示） */}
        {!isUser && !isSystem && (message.duration || message.tokensUsed) && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border-primary/50 text-xs text-text-tertiary">
            {message.duration && (
              <span className="flex items-center gap-1">
                ⏱ {formatDuration(message.duration)}
              </span>
            )}
            {message.tokensUsed && (
              <span className="flex items-center gap-1">
                🎯 {formatTokens(message.tokensUsed)}
              </span>
            )}
          </div>
        )}

        {/* 流式过程中展示实时耗时和 Token */}
        {!isUser && !isSystem && isStreaming && message.timestamp && (
          <StreamingStats timestamp={message.timestamp} />
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
