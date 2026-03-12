// ============================================================
// MessageBubble - 消息气泡组件
// ============================================================

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Bot, Loader2 } from 'lucide-react';
import type { Message } from '../stores/chatStore';

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isThinking = message.role === 'assistant' && message.thinking;

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

        {/* 思考状态 */}
        {isThinking && (
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
            <Loader2 size={14} className="animate-spin" />
            <span>正在思考...</span>
          </div>
        )}

        {/* 消息内容 */}
        <div className="prose prose-invert max-w-none">
          {typeof message.content === 'string' ? (
            <ReactMarkdown
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
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

        {/* 工具调用 */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.toolCalls.map((tool, index) => (
              <div
                key={index}
                className="bg-bg-primary/50 rounded p-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  {tool.status === 'pending' ? (
                    <Loader2 size={14} className="animate-spin text-yellow-500" />
                  ) : tool.status === 'success' ? (
                    <span className="text-green-500">✓</span>
                  ) : (
                    <span className="text-red-500">✗</span>
                  )}
                  <span className="font-mono">{tool.name}</span>
                  <span className="text-xs text-text-secondary ml-auto">
                    {tool.status === 'pending'
                      ? '执行中...'
                      : tool.duration
                        ? `${tool.duration}ms`
                        : tool.status === 'success' ? '完成' : '失败'
                    }
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
