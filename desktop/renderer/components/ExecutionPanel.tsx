// ============================================================
// ExecutionPanel - Agent 执行面板组件（右侧执行过程展示）
// ============================================================
// 显示 TODO 列表和进度（数据来源：messageStore → executionStore）

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Circle,
  PlayCircle,
} from 'lucide-react';
import { useExecutionStore, type TodoItem } from '../stores/executionStore';
import { t } from '@/core/i18n';

export default function ExecutionPanel() {
  const todos = useExecutionStore((state) => state.todos);

  // 按状态分组
  const pendingTodos = todos.filter((t) => t.status === 'pending');
  const inProgressTodos = todos.filter((t) => t.status === 'in_progress');
  const completedTodos = todos.filter((t) => t.status === 'completed');
  const failedTodos = todos.filter((t) => t.status === 'failed');

  // 统计
  const totalCount = todos.length;
  const completedCount = completedTodos.length + failedTodos.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">{t('execution.todo_list')}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 进度条 */}
        {totalCount > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t('execution.progress')}</span>
              <span>
                {completedCount} / {totalCount} ({progress.toFixed(0)}%)
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* TODO 列表 */}
        {todos.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            {t('execution.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {inProgressTodos.length > 0 && (
              <TodoGroup title={t('execution.group.in_progress')} todos={inProgressTodos} />
            )}
            {pendingTodos.length > 0 && (
              <TodoGroup title={t('execution.group.pending')} todos={pendingTodos} />
            )}
            {completedTodos.length > 0 && (
              <TodoGroup title={t('execution.group.completed')} todos={completedTodos} />
            )}
            {failedTodos.length > 0 && (
              <TodoGroup title={t('execution.group.failed')} todos={failedTodos} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ========== TODO 分组 ==========
function TodoGroup({ title, todos }: { title: string; todos: TodoItem[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      {todos.map((todo) => (
        <TodoItemComponent key={todo.id} todo={todo} />
      ))}
    </div>
  );
}

function TodoItemComponent({ todo }: { todo: TodoItem }) {
  const [expanded, setExpanded] = useState(false);

  const getIcon = () => {
    switch (todo.status) {
      case 'in_progress':
        return <PlayCircle size={14} className="text-primary" />;
      case 'completed':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'failed':
        return <XCircle size={14} className="text-red-500" />;
      default:
        return <Circle size={14} className="text-muted-foreground" />;
    }
  };

  const getDuration = () => {
    if (!todo.startedAt) return null;
    const end = todo.completedAt || Date.now();
    const duration = end - todo.startedAt;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className="p-2 bg-background rounded">
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {getIcon()}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{todo.subject}</div>
          {todo.status === 'in_progress' && todo.activeForm && (
            <div className="text-xs text-primary mt-1">
              {todo.activeForm}
            </div>
          )}
        </div>
        {getDuration() && (
          <div className="text-xs text-muted-foreground">{getDuration()}</div>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {expanded && todo.description && (
        <div className="mt-2 pl-6 text-xs text-muted-foreground">
          {todo.description}
        </div>
      )}
    </div>
  );
}
