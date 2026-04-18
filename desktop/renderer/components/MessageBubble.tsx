// ============================================================
// MessageBubble - 消息气泡组件
// ============================================================

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Bot, Loader2, Copy, Check } from 'lucide-react';
import type { Message } from '../stores/chatStore';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble = React.memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isThinking = message.role === 'assistant' && message.thinking;
  const isToolSummary = message.toolSummary === true;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // System 消息特殊样式
  if (isSystem) {
    return (
      <div className="flex justify-center my-4 animate-fadeIn">
        <div className="max-w-[80%] bg-bg-tertiary/30 border border-border-primary rounded-lg p-3 text-sm text-text-secondary text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
      <div
        className={`max-w-[80%] min-w-0 ${
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

        {/* 状态提示（回忆中 / 思考中 / 编写中...） */}
        {(message.statusHint || isThinking) && (
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
            <Loader2 size={14} className="animate-spin" />
            <span>{message.statusHint || '思考中...'}</span>
          </div>
        )}

        {/* 消息内容 */}
        <div className="max-w-none text-text-primary">
          {typeof message.content === 'string' ? (
            <ReactMarkdown
              components={{
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
              {message.content}
            </ReactMarkdown>
          ) : (
            <div className="text-sm">
              {/* 工具调用等复杂内容后续实现 */}
              [复杂内容]
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
