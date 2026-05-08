// ============================================================
// AskUserDialog - 用户提问对话框（shadcn Dialog）
// 支持单选/多选 + 自定义输入
// ============================================================

import React, { useState } from 'react';
import { HelpCircle, Send, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AskUserRequestData } from '../global';

interface AskUserDialogProps {
  request: AskUserRequestData;
  onClose: () => void;
}

export default function AskUserDialog({ request, onClose }: AskUserDialogProps) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());

  // 兼容运行时数据结构：可能是 { questions: [...] } 或扁平结构
  const q = (request as any).questions?.[0] || (request as any);
  const questionText = q.question || '';
  const hasOptions = q.options && q.options.length > 0;
  const isMultiSelect = q.multiSelect && hasOptions;
  // options 可能是一个字符串数组或 {label, description} 数组
  const options: string[] = hasOptions
    ? q.options.map((o: any) => (typeof o === 'string' ? o : o.label))
    : [];

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
    if (isMultiSelect) {
      setSelectedOptions((prev) => {
        const next = new Set(prev);
        if (next.has(option)) next.delete(option);
        else next.add(option);
        return next;
      });
    } else {
      handleRespond(option);
    }
  };

  const handleMultiSelectSubmit = () => {
    if (selectedOptions.size === 0) return;
    handleRespond(Array.from(selectedOptions).join(', '));
  };

  const handleSubmit = () => handleRespond(answer);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <HelpCircle size={24} className="text-foreground" />
            <div>
              <span>需要您的输入</span>
              <DialogDescription className="mt-0.5">Agent 正在等待您的回答</DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold mb-2">问题</div>
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded border border-border">
              {questionText}
            </div>
          </div>

          {/* 预设选项 */}
          {hasOptions && (
            <div>
              <div className="text-sm font-semibold mb-2">
                {isMultiSelect ? '多选（选择后点击提交）' : '快速选择'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {options!.map((option, index) => {
                  const isSelected = selectedOptions.has(option);
                  return (
                    <button
                      key={index}
                      onClick={() => handleOptionClick(option)}
                      disabled={loading}
                      className={`px-4 py-2 text-sm rounded transition-colors disabled:opacity-50 text-left flex items-center gap-2 ${
                        isSelected
                          ? 'bg-foreground text-background'
                          : 'bg-muted hover:bg-foreground hover:text-background'
                      }`}
                    >
                      {isMultiSelect && (
                        <div className={`w-4 h-4 border rounded flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-background border-background' : 'border-muted-foreground'
                        }`}>
                          {isSelected && <Check size={12} className="text-foreground" />}
                        </div>
                      )}
                      <span className="flex-1">{option}</span>
                    </button>
                  );
                })}
              </div>
              {isMultiSelect && (
                <Button
                  onClick={handleMultiSelectSubmit}
                  disabled={loading || selectedOptions.size === 0}
                  className="w-full mt-2"
                >
                  <Send size={16} className="mr-2" />
                  提交选择 ({selectedOptions.size})
                </Button>
              )}
            </div>
          )}

          {/* 自定义输入 */}
          <div>
            <div className="text-sm font-semibold mb-2">
              {hasOptions ? '或自定义回答' : '您的回答'}
            </div>
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入您的回答..."
              rows={3}
              disabled={loading}
            />
            <div className="text-xs text-muted-foreground mt-1">Enter 提交 · Shift+Enter 换行</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !answer.trim()}
          >
            <Send size={16} className="mr-2" />
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
