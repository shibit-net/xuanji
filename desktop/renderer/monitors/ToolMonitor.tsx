// ============================================================
// ToolMonitor - 工具调用监控组件（按调用顺序展示队列）
// ============================================================

import { useState } from 'react';
import { Wrench, CheckCircle, XCircle, Loader, ChevronDown, ChevronRight } from 'lucide-react';
import { useRuntimeStore } from '../stores';

/** 将 ANSI 颜色代码转换为 HTML */
function ansiToHtml(text: string): string {
  return text
    .replace(/\x1b\[32m/g, '<span style="color: #22c55e;">') // 绿色 (新增)
    .replace(/\x1b\[31m/g, '<span style="color: #ef4444;">') // 红色 (删除)
    .replace(/\x1b\[90m/g, '<span style="color: #6b7280;">') // 灰色 (省略提示)
    .replace(/\x1b\[1m/g, '<span style="font-weight: bold;">') // 粗体
    .replace(/\x1b\[0m/g, '</span>') // 重置
    .replace(/\x1b\[\d+m/g, ''); // 清除其他未处理的 ANSI 代码
}

/** 检测是否为 diff 输出 */
function isDiffOutput(text: string): boolean {
  return text.includes('变更预览:') || text.includes('统计:') || /^\s*\d+\s*│\s*[+\-\s]/.test(text);
}

/** 根据工具名生成可读的操作描述 */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read':
      return `读取 ${input.file_path || input.path || ''}`;
    case 'write':
      return `写入 ${input.file_path || input.path || ''}`;
    case 'edit':
    case 'multi_edit':
      return `编辑 ${input.file_path || input.path || ''}`;
    case 'bash':
      return `执行 ${String(input.command || '').slice(0, 60)}`;
    case 'glob':
      return `搜索文件 ${input.pattern || ''}`;
    case 'grep':
      return `搜索内容 ${input.pattern || ''}`;
    case 'web_search':
      return `搜索 ${input.query || ''}`;
    case 'web_fetch':
      return `获取 ${input.url || ''}`;
    case 'delegate':
      return `委派 ${input.subagent_type || 'agent'}`;
    case 'orchestrate':
    case 'agent_team':
      return `协作 ${(input as any).team_name || ''}`;
    default:
      if (name.startsWith('todo_')) return `任务管理`;
      return name;
  }
}

/** 工具图标 */
function toolIcon(name: string): string {
  if (name === 'read') return '📖';
  if (name === 'write') return '📝';
  if (name === 'edit' || name === 'multi_edit') return '✏️';
  if (name === 'bash') return '💻';
  if (name === 'glob') return '📁';
  if (name === 'grep') return '🔍';
  if (name === 'web_search' || name === 'web_fetch') return '🌐';
  if (name === 'delegate' || name === 'orchestrate') return '🤖';
  if (name.startsWith('todo_')) return '📋';
  return '🛠️';
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ToolMonitor() {
  // 按调用顺序排列（不倒序）
  const toolCalls = useRuntimeStore((state) => state.messageStream?.toolCalls || []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (toolCalls.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">🛠️ 工具调用</div>
        <div className="p-3 bg-bg-primary rounded-lg text-sm text-text-secondary text-center">
          暂无工具调用
        </div>
      </div>
    );
  }

  const runningCount = toolCalls.filter(t => t.status === 'running').length;
  const successCount = toolCalls.filter(t => t.status === 'success').length;
  const errorCount = toolCalls.filter(t => t.status === 'error').length;

  return (
    <div className="space-y-3">
      {/* 标题 + 统计 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">🛠️ 工具调用</div>
        <div className="flex gap-1.5 text-xs">
          {runningCount > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded">{runningCount} 执行中</span>
          )}
          <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded">{successCount} 成功</span>
          {errorCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded">{errorCount} 失败</span>
          )}
        </div>
      </div>

      {/* 调用队列（按顺序） */}
      <div className="space-y-1">
        {toolCalls.map((tool, index) => {
          const isExpanded = expandedId === tool.id;
          const desc = describeToolCall(tool.name, tool.input || {});
          const icon = toolIcon(tool.name);
          const dur = formatDuration(tool.duration);

          return (
            <div key={tool.id} className="bg-bg-primary rounded overflow-hidden border border-bg-tertiary">
              <button
                onClick={() => setExpandedId(isExpanded ? null : tool.id)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-secondary transition-colors text-left"
              >
                {/* 序号 */}
                <span className="text-xs text-text-tertiary w-5 flex-shrink-0 text-right">{index + 1}</span>

                {/* 状态图标 */}
                {tool.status === 'running' ? (
                  <Loader size={13} className="text-blue-500 animate-spin flex-shrink-0" />
                ) : tool.status === 'success' ? (
                  <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle size={13} className="text-error flex-shrink-0" />
                )}

                {/* 工具图标 + 操作描述 */}
                <span className="text-xs flex-shrink-0">{icon}</span>
                <span className="text-sm flex-1 truncate text-text-primary">{desc}</span>

                {/* 耗时 */}
                {dur && <span className="text-xs text-text-secondary flex-shrink-0">{dur}</span>}

                {/* 展开 */}
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="px-3 pb-2 pt-1 border-t border-bg-tertiary space-y-2">
                  {/* 输入参数 */}
                  {tool.input && Object.keys(tool.input).length > 0 && (
                    <div>
                      <div className="text-xs text-text-secondary mb-1">输入</div>
                      <pre className="text-xs font-mono bg-bg-secondary rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-text-primary">
                        {JSON.stringify(tool.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {/* 输出结果 */}
                  {tool.output && (
                    <div>
                      <div className="text-xs text-text-secondary mb-1">输出</div>
                      {isDiffOutput(tool.output) ? (
                        // Diff 输出：完整显示，支持 ANSI 颜色
                        <pre 
                          className="text-xs font-mono bg-bg-secondary rounded p-2 overflow-x-auto max-h-96 overflow-y-auto text-text-primary whitespace-pre"
                          dangerouslySetInnerHTML={{ __html: ansiToHtml(tool.output) }}
                        />
                      ) : (
                        // 普通输出：截断到 500 字符
                        <pre className="text-xs font-mono bg-bg-secondary rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-text-primary whitespace-pre-wrap break-words">
                          {tool.output.slice(0, 500)}
                          {tool.output.length > 500 && '...'}
                        </pre>
                      )}
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

