// ============================================================
// Xuanji Desktop - 工具监控组件
// ============================================================
// 职责：
// - 展示当前流式消息中的工具调用
// - 显示工具调用状态（运行中/成功/失败）
// - 显示工具执行时间
// - 支持查看工具输入和输出
// - 数据来源：runtimeStore.messageStream.toolCalls
// ============================================================

import React, { useState } from 'react';
import { Wrench, CheckCircle, XCircle, Loader, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { useRuntimeStore } from '../stores';

export default function ToolMonitor() {
  const toolCalls = useRuntimeStore((state) => state.messageStream?.toolCalls || []);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  if (toolCalls.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">🛠️ 工具监控</div>
        <div className="p-3 bg-bg-primary rounded-lg text-sm text-text-secondary text-center">
          暂无工具调用
        </div>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedTool(expandedTool === id ? null : id);
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">🛠️ 工具监控</div>
        <div className="text-xs text-text-secondary">{toolCalls.length} 次调用</div>
      </div>

      {/* 工具列表 */}
      <div className="space-y-2">
        {toolCalls.map((tool, index) => {
          const isExpanded = expandedTool === tool.id;
          const isRunning = tool.status === 'running';
          const isSuccess = tool.status === 'success';
          const isError = tool.status === 'error';

          return (
            <div
              key={tool.id}
              className="bg-bg-primary rounded-lg overflow-hidden border border-bg-tertiary"
            >
              {/* 工具头部 */}
              <button
                onClick={() => toggleExpand(tool.id)}
                className="w-full flex items-center gap-2 p-3 hover:bg-bg-secondary transition-colors"
              >
                {/* 展开图标 */}
                {isExpanded ? (
                  <ChevronDown size={14} className="text-text-secondary flex-shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-text-secondary flex-shrink-0" />
                )}

                {/* 序号 */}
                <span className="text-xs text-text-tertiary w-4 flex-shrink-0">#{index + 1}</span>

                {/* 工具名称 */}
                <Wrench size={14} className="text-primary flex-shrink-0" />
                <span className="text-sm font-mono font-medium flex-1 text-left truncate">
                  {tool.name}
                </span>

                {/* 状态图标 */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isRunning && (
                    <>
                      <Loader size={12} className="text-blue-500 animate-spin" />
                      <span className="text-xs text-blue-500">运行中</span>
                    </>
                  )}
                  {isSuccess && (
                    <>
                      <CheckCircle size={12} className="text-green-500" />
                      <span className="text-xs text-green-500">成功</span>
                    </>
                  )}
                  {isError && (
                    <>
                      <XCircle size={12} className="text-error" />
                      <span className="text-xs text-error">失败</span>
                    </>
                  )}
                  {tool.duration && (
                    <span className="text-xs text-text-secondary ml-1">
                      {formatDuration(tool.duration)}
                    </span>
                  )}
                </div>
              </button>

              {/* 工具详情 */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-bg-tertiary">
                  {/* 时间信息 */}
                  <div className="flex items-center gap-4 pt-2 text-xs text-text-secondary">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      <span>开始: {new Date(tool.startTime).toLocaleTimeString()}</span>
                    </div>
                    {tool.endTime && (
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        <span>结束: {new Date(tool.endTime).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>

                  {/* 输入参数 */}
                  <div>
                    <div className="text-xs text-text-secondary mb-1">输入参数</div>
                    <div className="bg-bg-secondary rounded p-2 overflow-x-auto">
                      <pre className="text-xs font-mono text-text-primary">
                        {JSON.stringify(tool.input, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* 输出结果 */}
                  {tool.output && (
                    <div>
                      <div className="text-xs text-text-secondary mb-1">输出结果</div>
                      <div className="bg-bg-secondary rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                        <pre className="text-xs font-mono text-text-primary whitespace-pre-wrap break-words">
                          {tool.output}
                        </pre>
                      </div>
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
