// ============================================================
// Xuanji Desktop - 浮动任务面板
// ============================================================
// 悬浮在输入框上方的可展开/收起任务列表
// ============================================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, CheckCircle, Circle, Loader2 } from 'lucide-react';
import { useExecutionStore } from '../stores/executionStore';
import type { TodoItem } from '../stores/executionStore';

export function FloatingTodoPanel() {
  const todos = useExecutionStore((state) => state.todos);
  const [isExpanded, setIsExpanded] = useState(false);

  // 没有任务时不显示
  if (todos.length === 0) return null;

  // 按状态分组
  const inProgress = todos.filter(t => t.status === 'in_progress');
  const pending = todos.filter(t => t.status === 'pending');
  const completed = todos.filter(t => t.status === 'completed');

  // 只在有进行中的任务时自动展开
  const shouldAutoExpand = inProgress.length > 0;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 px-4 pointer-events-none">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto pointer-events-auto"
      >
        {/* 紧凑头部 */}
        <div
          className="bg-bg-secondary/90 backdrop-blur-sm border border-bg-tertiary/50 rounded-t-lg px-3 py-2 cursor-pointer hover:bg-bg-tertiary/30 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 text-xs">
            {/* 进行中任务的简要显示 */}
            {inProgress.length > 0 ? (
              <>
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />
                <span className="text-text-primary font-medium flex-1 truncate">
                  {inProgress[0].subject}
                  {inProgress.length > 1 && <span className="text-text-secondary ml-1">+{inProgress.length - 1}</span>}
                </span>
              </>
            ) : pending.length > 0 ? (
              <>
                <Circle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-text-secondary flex-1 truncate">
                  {pending.length} 个待处理任务
                </span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                <span className="text-text-secondary flex-1">全部完成</span>
              </>
            )}

            <span className="text-text-tertiary text-[10px] px-1.5 py-0.5 bg-bg-tertiary/50 rounded">
              {completed.length}/{todos.length}
            </span>

            {(isExpanded || shouldAutoExpand) ? (
              <ChevronDown className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
            )}
          </div>
        </div>

        {/* 展开的任务列表 */}
        <AnimatePresence>
          {(isExpanded || shouldAutoExpand) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden bg-bg-secondary/90 backdrop-blur-sm border-x border-b border-bg-tertiary/50 rounded-b-lg"
            >
              <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                {/* 进行中 */}
                {inProgress.map((todo) => (
                  <TaskRow key={todo.id} todo={todo} />
                ))}

                {/* 待处理 */}
                {pending.slice(0, 10).map((todo) => (
                  <TaskRow key={todo.id} todo={todo} />
                ))}

                {pending.length > 10 && (
                  <div className="text-[10px] text-text-tertiary text-center py-1">
                    +{pending.length - 10} 个待处理
                  </div>
                )}

                {/* 已完成（最多显示 5 个） */}
                {completed.length > 0 && (
                  <>
                    {completed.slice(0, 5).map((todo) => (
                      <TaskRow key={todo.id} todo={todo} />
                    ))}
                    {completed.length > 5 && (
                      <div className="text-[10px] text-text-tertiary text-center py-1">
                        +{completed.length - 5} 个已完成
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function TaskRow({ todo }: { todo: TodoItem }) {
  const getIcon = () => {
    switch (todo.status) {
      case 'in_progress':
        return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
      case 'pending':
        return <Circle className="w-3 h-3 text-gray-400" />;
      case 'completed':
        return <CheckCircle className="w-3 h-3 text-green-400" />;
      default:
        return <Circle className="w-3 h-3 text-gray-400" />;
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-tertiary/30 transition-colors">
      <div className="flex-shrink-0">{getIcon()}</div>
      <span className={`text-xs flex-1 truncate ${todo.status === 'completed' ? 'line-through text-text-tertiary' : 'text-text-secondary'}`}>
        {todo.subject}
      </span>
      {todo.activeForm && todo.status === 'in_progress' && (
        <span className="text-[10px] text-blue-400 flex-shrink-0 max-w-[120px] truncate">
          {todo.activeForm}
        </span>
      )}
    </div>
  );
}
