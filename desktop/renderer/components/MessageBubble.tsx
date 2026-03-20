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

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isThinking = message.role === 'assistant' && message.thinking;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
      <div
        className={`max-w-[80%] ${
          isUser
            ? 'bg-primary text-white'
            : 'bg-bg-secondary text-text-primary'
        } rounded-lg p-4 shadow-lg`}
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
        <div className="prose prose-invert max-w-none">
          {typeof message.content === 'string' ? (
            <ReactMarkdown
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeString = String(children).replace(/\n$/, '');
                  const codeId = `code-${message.id}-${codeString.slice(0, 20)}`;

                  return !inline && match ? (
                    <div className="relative group">
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        {...props}
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
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
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

        {/* 工具调用已移至状态栏展示，消息气泡中不再重复显示 */}
      </div>
    </div>
  );
}
