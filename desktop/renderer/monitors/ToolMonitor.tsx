// ============================================================
// ToolMonitor - 工具调用监控组件（按调用顺序展示队列）
// ============================================================

import { useState, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, Loader, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { t } from '@/core/i18n';
import { getDesktopLabel } from '../i18n';
import { useConfigStore } from '../stores/configStore';
import { formatDuration } from '../components/flow/hooks';

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
  const path = String(input.filePath || input.path || '');
  switch (name) {
    case 'read_file':       return t('toolmonitor.read_file', { path });
    case 'write_file':      return t('toolmonitor.write_file', { path });
    case 'edit_file':
    case 'multi_edit':      return t('toolmonitor.edit_file', { path });
    case 'send_file_to_user': return t('toolmonitor.send_file', { path: String(input.filePath || '') });
    case 'glob':            return t('toolmonitor.glob', { pattern: String(input.pattern || '') });
    case 'grep':            return t('toolmonitor.grep', { pattern: String(input.pattern || '') });
    case 'list_directory':  return t('toolmonitor.list_directory', { path: String(input.path || '') });
    case 'change_directory': return t('toolmonitor.change_directory', { path: String(input.path || '') });
    case 'bash':            return t('toolmonitor.bash', { command: String(input.command || '').slice(0, 60) });
    case 'web_search':      return t('toolmonitor.web_search', { query: String(input.query || '') });
    case 'web_fetch':       return t('toolmonitor.web_fetch', { url: String(input.url || '') });
    case 'task':            return t('toolmonitor.task', { type: String(input.subagent_type || 'agent') });
    case 'agent_team':      return t('toolmonitor.agent_team', { team: String((input as any).team_name || '') });
    case 'task_control':    return t('toolmonitor.task_control', { action: String(input.action || '') });
    case 'task_output':     return t('toolmonitor.task_output');
    case 'match_agent':     return t('toolmonitor.match_agent');
    case 'list_agents':     return t('toolmonitor.list_agents');
    case 'list_scenes':     return t('toolmonitor.list_scenes');
    case 'ask_user':        return t('toolmonitor.ask_user', { question: String(input.question || '').slice(0, 50) });
    case 'plan_review':     return t('toolmonitor.plan_review');
    case 'enter_plan_mode': return t('toolmonitor.enter_plan_mode');
    case 'exit_plan_mode':  return t('toolmonitor.exit_plan_mode');
    case 'pdf':             return t('toolmonitor.pdf', { path });
    case 'generate_document': return t('toolmonitor.generate_document');
    case 'xlsx_edit':       return t('toolmonitor.xlsx_edit');
    case 'docx_edit':       return t('toolmonitor.docx_edit');
    case 'doc_to_docx':     return t('toolmonitor.doc_to_docx');
    case 'notebook_edit':   return t('toolmonitor.notebook_edit');
    case 'worktree':        return t('toolmonitor.worktree');
    case 'install':         return t('toolmonitor.install');
    case 'uninstall':       return t('toolmonitor.uninstall');
    case 'mcp_settings':    return t('toolmonitor.mcp_settings');
    case 'skill_manage':    return t('toolmonitor.skill_manage');
    case 'update_persona':  return t('toolmonitor.update_persona');
    case 'mcp_call':        return t('toolmonitor.mcp_call', { server: String(input.serverName || ''), tool: String(input.toolName || '') });
    case 'skill_call':      return t('toolmonitor.skill_call', { skill: String(input.skill || '') });
    case 'scheduler':       return t('toolmonitor.scheduler');
    case 'sleep':           return t('toolmonitor.sleep');
    default:
      if (name.startsWith('todo_')) return t('toolmonitor.todo_prefix');
      if (name.startsWith('memory_')) return t('toolmonitor.memory_prefix');
      if (name.startsWith('ssh_')) return t('toolmonitor.ssh_prefix');
      return name;
  }
}

/** 工具图标 */
function toolIcon(name: string): string {
  if (name === 'read_file') return '📖';
  if (name === 'write_file') return '📝';
  if (name === 'edit_file' || name === 'multi_edit') return '✏️';
  if (name === 'send_file_to_user') return '📤';
  if (name === 'bash') return '💻';
  if (name === 'glob') return '📁';
  if (name === 'grep') return '🔍';
  if (name === 'list_directory' || name === 'change_directory') return '📂';
  if (name === 'web_search' || name === 'web_fetch') return '🌐';
  if (name === 'task' || name === 'agent_team' || name === 'task_control' || name === 'task_output') return '🤖';
  if (name === 'match_agent' || name === 'list_agents' || name === 'list_scenes') return '🔎';
  if (name === 'ask_user') return '💬';
  if (name === 'plan_review' || name === 'enter_plan_mode' || name === 'exit_plan_mode') return '📋';
  if (name === 'pdf' || name === 'generate_document') return '📄';
  if (name === 'xlsx_edit') return '📊';
  if (name === 'docx_edit' || name === 'doc_to_docx') return '📝';
  if (name === 'notebook_edit') return '📓';
  if (name === 'worktree') return '🌿';
  if (name === 'install' || name === 'uninstall') return '📦';
  if (name === 'mcp_settings' || name === 'skill_manage' || name === 'update_persona') return '⚙️';
  if (name === 'mcp_call' || name === 'skill_call') return '🔌';
  if (name === 'scheduler' || name === 'sleep') return '⏰';
  if (name.startsWith('todo_')) return '✅';
  if (name.startsWith('memory_')) return '🧠';
  if (name.startsWith('ssh_')) return '🖥️';
  return '🛠️';
}

export default memo(function ToolMonitor() {
  // 按调用顺序排列（不倒序）
  const agentMap = useAgentStateMachine((s) => s.agentMap);
  const language = useConfigStore((s) => s.settings.language);

  const toolCalls = useMemo(() => {
    return Object.values(agentMap)
      .flatMap(a => a.currentTools)
      .map(t => ({ ...t, duration: t.endTime ? t.endTime - t.startTime : (t.status === 'running' ? Date.now() - t.startTime : undefined) }))
      .sort((a, b) => a.startTime - b.startTime);
  }, [agentMap]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (toolCalls.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-2">{getDesktopLabel('toolmonitor.title', language)}</div>
        <div className="p-3 bg-background rounded-lg text-sm text-muted-foreground text-center">
          {getDesktopLabel('toolmonitor.empty', language)}
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
        <div className="text-sm font-semibold">{getDesktopLabel('toolmonitor.title', language)}</div>
        <div className="flex gap-1.5 text-xs">
          {runningCount > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded">{getDesktopLabel('toolmonitor.running', language).replace('{count}', String(runningCount))}</span>
          )}
          <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded">{getDesktopLabel('toolmonitor.success', language).replace('{count}', String(successCount))}</span>
          {errorCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded">{getDesktopLabel('toolmonitor.failed', language).replace('{count}', String(errorCount))}</span>
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
            <div key={tool.id} className="bg-background rounded overflow-hidden border border-border">
              <Button
                onClick={() => setExpandedId(isExpanded ? null : tool.id)}
                variant="ghost"
                className="w-full flex items-center gap-2 px-3 py-2 text-left h-auto justify-start"
              >
                {/* 序号 */}
                <span className="text-xs text-muted-foreground/50 w-5 flex-shrink-0 text-right">{index + 1}</span>

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
                <span className="text-sm flex-1 truncate text-foreground">{desc}</span>

                {/* 耗时 */}
                {dur && <span className="text-xs text-muted-foreground flex-shrink-0">{dur}</span>}

                {/* 展开 */}
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </Button>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="px-3 pb-2 pt-1 border-t border-border space-y-2">
                  {/* 输入参数 */}
                  {tool.input && Object.keys(tool.input).length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">{getDesktopLabel('toolmonitor.input', language)}</div>
                      <pre className="text-xs font-mono bg-card rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-foreground">
                        {JSON.stringify(tool.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {/* 输出结果 */}
                  {tool.output && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">{getDesktopLabel('toolmonitor.output', language)}</div>
                      {isDiffOutput(tool.output) ? (
                        // Diff 输出：完整显示，支持 ANSI 颜色
                        <pre 
                          className="text-xs font-mono bg-card rounded p-2 overflow-x-auto max-h-96 overflow-y-auto text-foreground whitespace-pre"
                          dangerouslySetInnerHTML={{ __html: ansiToHtml(tool.output) }}
                        />
                      ) : (
                        // 普通输出：截断到 500 字符
                        <pre className="text-xs font-mono bg-card rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-foreground whitespace-pre-wrap break-words">
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
});

