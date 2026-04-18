// ============================================================
// InputArea - 输入区组件（含意图分析功能）
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Send, StopCircle, Archive, Brain } from 'lucide-react';
import { useChatStore, Message } from '../stores/chatStore';
import { useToast } from './Toast';
import IntentDialog from './IntentDialog';
import { intentAnalyzer, IntentAnalysis, UserIntent } from '../services/messageIntentAnalyzer';

export default function InputArea() {
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // 意图分析相关状态
  const [showIntentDialog, setShowIntentDialog] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');
  const [analysisResult, setAnalysisResult] = useState<IntentAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const sendMessage = useChatStore((state) => state.sendMessage);
  const addMessage = useChatStore((state) => state.addMessage);
  const status = useChatStore((state) => state.status);
  const messages = useChatStore((state) => state.messages);
  const toast = useToast();

  const isRunning = status === 'thinking' || status === 'executing';

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    if (!isRunning) {
      sendMessage(input.trim());
      setInput('');
      return;
    }

    setPendingMessage(input.trim());
    setIsAnalyzing(true);

    try {
      const result = await intentAnalyzer.analyze(input.trim(), messages);
      setAnalysisResult(result);

      if (result.confidence >= 0.85) {
        executeIntent(result.type, input.trim());
      } else {
        setShowIntentDialog(true);
      }
    } catch (error) {
      console.error('分析意图失败:', error);
      setAnalysisResult(null);
      setShowIntentDialog(true);
    } finally {
      setIsAnalyzing(false);
      setInput('');
    }
  };

  const executeIntent = async (intent: UserIntent, content: string) => {
    switch (intent) {
      case 'interrupt_replace':
        await interruptAndRestart(content);
        break;
      case 'supplement':
        await appendAsSupplment(content);
        break;
      case 'new_task':
        await queueMessage(content);
        break;
      case 'unknown':
        setShowIntentDialog(true);
        break;
    }
    setShowIntentDialog(false);
  };

  const interruptAndRestart = async (content: string) => {
    try {
      await (window as any).electron.agentInterrupt({
        mode: 'abandon',
        reason: 'user_replace'
      });
      await new Promise(r => setTimeout(r, 300));
      sendMessage(content);
      toast.success('已中断并重新开始');
    } catch (error) {
      toast.error('中断失败，请重试');
    }
  };

  const appendAsSupplment = async (content: string) => {
    const supplMsg: Message = {
      id: `supplement-${Date.now()}`,
      role: 'system',
      content: `补充说明：${content}`,
      timestamp: Date.now()
    };
    addMessage(supplMsg);

    try {
      await (window as any).electron.agentSendSupplment?.(content);
      toast.success('补充说明已发送');
    } catch (error) {
      toast.error('发送补充说明失败');
    }
  };

  const queueMessage = async (content: string) => {
    const queuedMsg: Message = {
      id: `queued-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now()
    };
    addMessage(queuedMsg);
    toast.info('已加入队列，将在当前任务完成后执行');
  };

  const handleInterrupt = () => {
    window.electron.agentInterrupt();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
      textareaRef.current?.blur();
    }
  };

  const handleCompact = async () => {
    if (isCompacting || isRunning) return;

    setIsCompacting(true);
    try {
      const result = await window.electron.compact({});
      if (result.success) {
        toast.success('消息压缩完成');
      } else {
        toast.error(`压缩失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      toast.error(`压缩失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCompacting(false);
    }
  };

  const handleMemoryFlush = async () => {
    if (isFlushing || isRunning) return;

    setIsFlushing(true);
    try {
      const result = await window.electron.manualMemoryFlush();
      if (result.success) {
        toast.success('记忆提取完成');
      } else {
        toast.error(`记忆提取失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      toast.error(`记忆提取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <div className="flex-shrink-0 border-t border-bg-tertiary bg-bg-secondary">
      <div className="flex items-center gap-2 px-4 pt-3">
        <button
          onClick={handleCompact}
          disabled={isCompacting || isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="压缩历史消息，减少 token 使用"
        >
          <Archive size={14} />
          <span>{isCompacting ? '压缩中...' : '压缩消息'}</span>
        </button>
        <button
          onClick={handleMemoryFlush}
          disabled={isFlushing || isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="提取对话中的记忆，保存到长期记忆库"
        >
          <Brain size={14} />
          <span>{isFlushing ? '提取中...' : '提取记忆'}</span>
        </button>
      </div>

      <div className="flex items-end gap-2 p-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={isRunning ? '输入补充内容，AI 会分析你的意图...' : '输入你的问题... (支持 Markdown)'}
          className="flex-1 bg-bg-primary border border-bg-tertiary rounded-lg px-4 py-2 resize-none focus:outline-none focus:border-primary transition-colors"
          rows={1}
          style={{ maxHeight: '150px' }}
        />
        
        {isAnalyzing && (
          <div className="px-2 text-sm text-text-secondary">
            🤔 分析中...
          </div>
        )}
        
        {isRunning && !input.trim() && !isAnalyzing ? (
          <button
            onClick={handleInterrupt}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
          >
            <StopCircle size={16} />
            <span>停止</span>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isAnalyzing}
            className={`px-4 py-2 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isRunning && input.trim() && !isAnalyzing
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            <Send size={16} />
            <span>{isRunning && input.trim() ? '发送' : '发送'}</span>
          </button>
        )}
      </div>

      <div className="px-4 pb-2 text-xs text-text-secondary">
        Enter 发送 · Shift+Enter 换行 · Esc 清空
        {isRunning && <span className="ml-2 text-yellow-500">· AI 会智能判断你的意图</span>}
      </div>

      {showIntentDialog && (
        <IntentDialog
          pendingMessage={pendingMessage}
          analysisResult={analysisResult}
          onSelect={executeIntent}
          onCancel={() => {
            setShowIntentDialog(false);
            setInput(pendingMessage);
          }}
        />
      )}
    </div>
  );
}
