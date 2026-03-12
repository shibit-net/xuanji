// ============================================================
// AskUserDialog - 用户提问对话框
// ============================================================

import React, { useState } from 'react';
import { HelpCircle, X, Send } from 'lucide-react';
import type { AskUserRequestData } from '../global';

interface AskUserDialogProps {
  request: AskUserRequestData;
  onClose: () => void;
}

export default function AskUserDialog({ request, onClose }: AskUserDialogProps) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');

  const handleRespond = async (answerText: string) => {
    if (!answerText.trim()) return;

    setLoading(true);
    try {
      await window.electron.askUserRespond({
        id: request.id,
        result: { answer: answerText },
      });
      onClose();
    } catch (err) {
      console.error('Ask user respond error:', err);
      setLoading(false);
    }
  };

  const handleOptionClick = (option: string) => {
    handleRespond(option);
  };

  const handleSubmit = () => {
    handleRespond(answer);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-bg-tertiary rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
          <div className="flex items-center gap-3">
            <HelpCircle size={24} className="text-primary" />
            <div>
              <h2 className="text-lg font-semibold">需要您的输入</h2>
              <span className="text-sm text-text-secondary">Agent 正在等待您的回答</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-tertiary rounded transition-colors"
            disabled={loading}
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 space-y-4">
          {/* 问题 */}
          <div>
            <div className="text-sm font-semibold mb-2">问题</div>
            <div className="text-sm text-text-secondary bg-bg-primary p-3 rounded border border-bg-tertiary">
              {request.question}
            </div>
          </div>

          {/* 预设选项 */}
          {request.options && request.options.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2">快速选择</div>
              <div className="grid grid-cols-2 gap-2">
                {request.options.map((option, index) => (
                  <button
                    key={index}
                    onClick={() => handleOptionClick(option)}
                    disabled={loading}
                    className="px-4 py-2 text-sm bg-bg-tertiary hover:bg-primary hover:text-white rounded transition-colors disabled:opacity-50 text-left"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 自定义输入 */}
          <div>
            <div className="text-sm font-semibold mb-2">
              {request.options && request.options.length > 0 ? '或自定义回答' : '您的回答'}
            </div>
            <div className="flex gap-2">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入您的回答..."
                className="flex-1 bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary"
                rows={3}
                disabled={loading}
              />
            </div>
            <div className="text-xs text-text-secondary mt-1">
              Enter 提交 · Shift+Enter 换行
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-bg-tertiary">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm bg-bg-tertiary hover:bg-bg-primary rounded transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !answer.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white hover:bg-primary/90 rounded transition-colors disabled:opacity-50"
          >
            <Send size={16} />
            <span>提交</span>
          </button>
        </div>
      </div>
    </div>
  );
}
