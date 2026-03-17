// ============================================================
// Xuanji Desktop - 记忆视图组件
// ============================================================
// 职责：
// - 展示当前会话的记忆条目
// - 显示记忆类型、内容、标签
// - 显示记忆创建时间和相关性评分
// - 支持查看详细内容
// - 数据来源：historyStore.memoryEntries
// ============================================================

import React, { useState } from 'react';
import { Database, Tag, Clock, Star, ChevronDown, ChevronRight } from 'lucide-react';
import { useHistoryStore } from '../stores';

export default function MemoryView() {
  const memoryEntries = useHistoryStore((state) => state.memoryEntries);
  const [expandedMemory, setExpandedMemory] = useState<number | null>(null);

  if (memoryEntries.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">💾 记忆库</div>
        <div className="p-3 bg-bg-primary rounded-lg text-sm text-text-secondary text-center">
          暂无记忆条目
        </div>
      </div>
    );
  }

  const toggleExpand = (index: number) => {
    setExpandedMemory(expandedMemory === index ? null : index);
  };

  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      conversation: '对话',
      decision: '决策',
      fact: '事实',
      preference: '偏好',
      code: '代码',
      task: '任务',
    };
    return typeMap[type] || type;
  };

  const getTypeColor = (type: string) => {
    const colorMap: Record<string, string> = {
      conversation: 'text-blue-500',
      decision: 'text-purple-500',
      fact: 'text-green-500',
      preference: 'text-yellow-500',
      code: 'text-pink-500',
      task: 'text-orange-500',
    };
    return colorMap[type] || 'text-text-secondary';
  };

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">💾 记忆库</div>
        <div className="text-xs text-text-secondary">{memoryEntries.length} 条记录</div>
      </div>

      {/* 记忆列表 */}
      <div className="space-y-2">
        {memoryEntries.map((memory, index) => {
          const isExpanded = expandedMemory === index;

          return (
            <div
              key={index}
              className="bg-bg-primary rounded-lg overflow-hidden border border-bg-tertiary"
            >
              {/* 记忆头部 */}
              <button
                onClick={() => toggleExpand(index)}
                className="w-full flex items-center gap-2 p-3 hover:bg-bg-secondary transition-colors"
              >
                {/* 展开图标 */}
                {isExpanded ? (
                  <ChevronDown size={14} className="text-text-secondary flex-shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-text-secondary flex-shrink-0" />
                )}

                {/* 类型图标 */}
                <Database size={14} className={`${getTypeColor(memory.type)} flex-shrink-0`} />

                {/* 内容预览 */}
                <div className="flex-1 text-left">
                  <div className="text-sm text-text-primary truncate">{memory.content}</div>
                </div>

                {/* 类型标签 */}
                <span
                  className={`text-xs px-2 py-0.5 rounded bg-bg-secondary ${getTypeColor(memory.type)} flex-shrink-0`}
                >
                  {getTypeLabel(memory.type)}
                </span>

                {/* 评分（如果有） */}
                {memory.score !== undefined && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <Star size={12} className="text-yellow-500" />
                    <span className="text-xs text-text-secondary">
                      {(memory.score * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </button>

              {/* 记忆详情 */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-bg-tertiary">
                  {/* 完整内容 */}
                  <div className="pt-2">
                    <div className="text-xs text-text-secondary mb-1">内容</div>
                    <div className="text-sm text-text-primary leading-relaxed break-words">
                      {memory.content}
                    </div>
                  </div>

                  {/* 标签 */}
                  {memory.tags && memory.tags.length > 0 && (
                    <div>
                      <div className="text-xs text-text-secondary mb-1 flex items-center gap-1">
                        <Tag size={12} />
                        标签
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {memory.tags.map((tag, tagIndex) => (
                          <span
                            key={tagIndex}
                            className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 时间 */}
                  {memory.createdAt && (
                    <div className="flex items-center gap-1 text-xs text-text-secondary">
                      <Clock size={12} />
                      <span>{new Date(memory.createdAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
