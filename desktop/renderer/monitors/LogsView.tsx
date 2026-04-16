// ============================================================
// Xuanji Desktop - 日志视图组件
// ============================================================
// 职责：
// - 展示系统日志流
// - 按级别过滤（debug / info / warn / error）
// - 按分类过滤（system / agent / tool / ipc）
// - 显示日志时间、级别、分类、消息
// - 支持清空日志
// - 数据来源：runtimeStore.logs
// ============================================================

import { useState, useMemo, useRef, useEffect } from 'react';
import { FileText, AlertCircle, Info, AlertTriangle, Bug, Trash2, Filter } from 'lucide-react';
import { useRuntimeStore } from '../stores';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'all';
type LogCategory = 'system' | 'agent' | 'tool' | 'ipc' | 'all';

export default function LogsView() {
  const logs = useRuntimeStore((state) => state.logs);
  const clearLogs = useRuntimeStore((state) => state.clearLogs);
  const [filterLevel, setFilterLevel] = useState<LogLevel>('all');
  const [filterCategory, setFilterCategory] = useState<LogCategory>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // 过滤日志
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (filterLevel !== 'all') {
      result = result.filter((log) => log.level === filterLevel);
    }

    if (filterCategory !== 'all') {
      result = result.filter((log) => log.category === filterCategory);
    }

    return result;
  }, [logs, filterLevel, filterCategory]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  // 检测用户手动滚动
  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 10;
      setAutoScroll(isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'debug':
        return <Bug size={12} className="text-text-secondary" />;
      case 'info':
        return <Info size={12} className="text-blue-500" />;
      case 'warn':
        return <AlertTriangle size={12} className="text-yellow-500" />;
      case 'error':
        return <AlertCircle size={12} className="text-error" />;
      default:
        return <FileText size={12} className="text-text-secondary" />;
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'debug':
        return 'text-text-secondary';
      case 'info':
        return 'text-blue-500';
      case 'warn':
        return 'text-yellow-500';
      case 'error':
        return 'text-error';
      default:
        return 'text-text-primary';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'system':
        return 'bg-purple-500/20 text-purple-500';
      case 'agent':
        return 'bg-green-500/20 text-green-500';
      case 'tool':
        return 'bg-blue-500/20 text-blue-500';
      case 'ipc':
        return 'bg-yellow-500/20 text-yellow-500';
      default:
        return 'bg-bg-secondary text-text-secondary';
    }
  };

  return (
    <div className="flex flex-col space-y-3">
      {/* 标题和操作栏 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">📋 日志流</div>
        <button
          onClick={clearLogs}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-primary hover:bg-bg-tertiary rounded transition-colors"
          title="清空日志"
        >
          <Trash2 size={12} />
          清空
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 text-xs">
        {/* 级别筛选 */}
        <div className="flex items-center gap-1">
          <Filter size={12} className="text-text-secondary" />
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as LogLevel)}
            className="bg-bg-primary border border-bg-tertiary rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
          >
            <option value="all">全部级别</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>

        {/* 分类筛选 */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as LogCategory)}
          className="bg-bg-primary border border-bg-tertiary rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
        >
          <option value="all">全部分类</option>
          <option value="system">System</option>
          <option value="agent">Agent</option>
          <option value="tool">Tool</option>
          <option value="ipc">IPC</option>
        </select>

        {/* 统计 */}
        <div className="flex-1 text-right text-text-secondary">
          {filteredLogs.length} / {logs.length} 条
        </div>
      </div>

      {/* 日志列表 */}
      <div
        ref={logsContainerRef}
        className="overflow-y-auto bg-bg-primary rounded-lg p-2 space-y-1 font-mono text-xs"
        style={{ maxHeight: '600px', minHeight: '300px' }}
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center text-text-secondary py-8">暂无日志</div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 py-1 hover:bg-bg-secondary rounded px-2">
              {/* 时间 */}
              <span className="text-text-tertiary flex-shrink-0">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>

              {/* 级别图标 */}
              <div className="flex-shrink-0 mt-0.5">{getLevelIcon(log.level)}</div>

              {/* 级别文本 */}
              <span className={`${getLevelColor(log.level)} w-12 flex-shrink-0 uppercase`}>
                {log.level}
              </span>

              {/* 分类标签 */}
              <span
                className={`${getCategoryColor(log.category)} px-1.5 py-0.5 rounded flex-shrink-0 text-xs`}
              >
                {log.category}
              </span>

              {/* 消息内容 */}
              <span className="text-text-primary flex-1 break-words">{log.message}</span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* 自动滚动提示 */}
      {!autoScroll && (
        <div className="mt-2 text-xs text-center">
          <button
            onClick={() => {
              setAutoScroll(true);
              logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="text-primary hover:underline"
          >
            ↓ 跳转到最新日志
          </button>
        </div>
      )}
    </div>
  );
}
