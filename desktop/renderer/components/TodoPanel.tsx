// ============================================================
// TodoPanel - 任务列表面板
// ============================================================

import React, { memo } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronUp, AlertCircle, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExecutionStore } from '../stores/executionStore';

/** 状态排序权重：in_progress → pending → failed → completed */
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  failed: 2,
  completed: 3,
};

function TodoPanel() {
  const todos = useExecutionStore((state) => state.todos);
  const [collapsed, setCollapsed] = React.useState(true); // 默认收起
  const [archivedCount, setArchivedCount] = React.useState(0);
  const [archiving, setArchiving] = React.useState(false);

  // 加载归档数量
  React.useEffect(() => {
    window.electron.todoGetArchivedCount().then((res) => {
      if (res.success && res.count !== undefined) {
        setArchivedCount(res.count);
      }
    });
  }, []);

  // 归档已完成任务
  const handleArchiveCompleted = async () => {
    if (archiving) return;

    const completedCount = todos.filter((t) => t.status === 'completed').length;
    if (completedCount === 0) return;

    setArchiving(true);
    try {
      const res = await window.electron.todoArchiveCompleted();
      if (res.success && res.count !== undefined) {
        // 更新归档总数
        setArchivedCount((prev) => prev + res.count);
      }
    } catch (err) {
      console.error('归档失败:', err);
    } finally {
      setArchiving(false);
    }
  };

  // 没有任务时不显示
  if (todos.length === 0) return null;

  // 统计
  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const pending = todos.filter((t) => t.status === 'pending').length;
  const failed = todos.filter((t) => t.status === 'failed').length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  // 当前正在执行的任务
  const currentTask = todos.find((t) => t.status === 'in_progress');

  // 按优先级排序：in_progress → pending → failed → completed
  const sortedTodos = [...todos].sort((a, b) => {
    const orderA = STATUS_ORDER[a.status] ?? 4;
    const orderB = STATUS_ORDER[b.status] ?? 4;
    return orderA - orderB;
  });

  // 超出显示限制时优先隐藏 completed 任务，最多显示 10 条
  const MAX_VISIBLE = 10;
  let visibleTodos = sortedTodos;
  let hiddenCompletedCount = 0;

  if (sortedTodos.length > MAX_VISIBLE) {
    const nonCompleted = sortedTodos.filter((t) => t.status !== 'completed');
    const completedItems = sortedTodos.filter((t) => t.status === 'completed');

    if (nonCompleted.length >= MAX_VISIBLE) {
      // 非完成任务已满，完全隐藏已完成
      visibleTodos = nonCompleted.slice(0, MAX_VISIBLE);
      hiddenCompletedCount = completedItems.length;
    } else {
      // 补充部分已完成任务
      const completedSlots = MAX_VISIBLE - nonCompleted.length;
      visibleTodos = [...nonCompleted, ...completedItems.slice(0, completedSlots)];
      hiddenCompletedCount = completedItems.length - completedSlots;
    }
  }

  const hiddenCount = sortedTodos.length - visibleTodos.length;

  return (
    <div className="flex-shrink-0 border-t border-border bg-card">
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-primary/10 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold text-foreground">
            📋 任务列表
          </div>
          <div className="text-xs text-muted-foreground">
            {completed}/{total} 已完成
            {inProgress > 0 && <span className="ml-2 text-primary">· {inProgress} 进行中</span>}
            {pending > 0 && <span className="ml-2">· {pending} 待处理</span>}
            {failed > 0 && <span className="ml-2 text-red-500">· {failed} 失败</span>}
            {archivedCount > 0 && (
              <span className="ml-2 text-muted-foreground/50">· {archivedCount} 已归档</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 归档按钮 */}
          {completed > 0 && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleArchiveCompleted();
              }}
              disabled={archiving}
              variant="ghost"
              size="sm"
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 h-auto"
              title={`归档 ${completed} 个已完成任务`}
            >
              <Archive size={12} className={archiving ? 'animate-pulse' : ''} />
              <span>归档</span>
            </Button>
          )}

          {/* 进度条 */}
          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* 折叠按钮 */}
          {collapsed ? (
            <ChevronDown size={16} className="text-muted-foreground" />
          ) : (
            <ChevronUp size={16} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {/* 收起时显示当前正在执行的任务 */}
      {collapsed && currentTask && (
        <div className="px-4 pb-2">
          <div className="flex items-start gap-2 p-2 rounded bg-primary/10">
            <Loader2 size={16} className="text-primary animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-primary font-medium truncate">
                {currentTask.subject}
              </div>
              {currentTask.activeForm && (
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {currentTask.activeForm}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 展开时显示所有任务列表 */}
      {!collapsed && (
        <div className="px-4 pb-3 space-y-1.5 max-h-48 overflow-y-auto">
          {visibleTodos.map((todo) => {
            const statusIcon =
              todo.status === 'completed' ? (
                <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
              ) : todo.status === 'in_progress' ? (
                <Loader2 size={16} className="text-primary animate-spin flex-shrink-0" />
              ) : todo.status === 'failed' ? (
                <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
              ) : (
                <Circle size={16} className="text-muted-foreground flex-shrink-0" />
              );

            const statusColor =
              todo.status === 'completed'
                ? 'text-muted-foreground line-through'
                : todo.status === 'in_progress'
                ? 'text-primary font-medium'
                : todo.status === 'failed'
                ? 'text-red-500'
                : 'text-foreground';

            return (
              <div
                key={todo.id}
                className="flex items-start gap-2 p-2 rounded hover:bg-primary/10 transition-colors"
              >
                {statusIcon}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${statusColor} truncate`}>
                    {todo.subject}
                  </div>
                  {todo.activeForm && todo.status === 'in_progress' && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {todo.activeForm}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* 隐藏任务提示 */}
          {hiddenCount > 0 && (
            <div className="text-xs text-muted-foreground text-center py-1">
              {hiddenCompletedCount > 0
                ? `还有 ${hiddenCompletedCount} 个已完成任务未显示`
                : `还有 ${hiddenCount} 个任务未显示`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(TodoPanel);
