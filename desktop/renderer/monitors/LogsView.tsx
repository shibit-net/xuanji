// ============================================================
// Xuanji Desktop - 日志视图组件（持久化版本）
// ============================================================
// 职责：
// - 从持久化日志文件读取日志（.xuanji/logs/）
// - 按级别过滤（debug / info / warn / error）
// - 按关键词搜索
// - 实时监听日志文件变化（tail -f 效果）
// - 显示日志时间、级别、命名空间、消息
// - 支持清空日志
// - 保持格式化和高可读性展示
// ============================================================

import { useState, useMemo, useRef, useEffect } from 'react';
import { FileText, AlertCircle, Info, AlertTriangle, Bug, Trash2, Filter, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'all';

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  namespace: string;
  message: string;
  raw: string;
}

export default function LogsView() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [filterLevel, setFilterLevel] = useState<LogLevel>('all');
  const [keyword, setKeyword] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isWatching, setIsWatching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // 加载日志
  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const levels = filterLevel === 'all' ? ['debug', 'info', 'warn', 'error'] : [filterLevel];
      const result = await window.electron.logsReadLatest(1000, levels);
      if (result.success) {
        setLogs(result.logs || []);
      }
    } catch (error) {
      console.error('加载日志失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 启动实时监听
  const startWatch = async () => {
    const levels = filterLevel === 'all' ? ['debug', 'info', 'warn', 'error'] : [filterLevel];
    const result = await window.electron.logsStartWatch(levels);
    if (result.success) {
      setIsWatching(true);
    }
  };

  // 停止实时监听
  const stopWatch = async () => {
    await window.electron.logsStopWatch();
    setIsWatching(false);
  };

  // 清空日志
  const handleClearLogs = async () => {
    if (!confirm('确定要清空所有日志文件吗？')) return;

    const result = await window.electron.logsClear();
    if (result.success) {
      setLogs([]);
    }
  };

  // 初始加载
  useEffect(() => {
    loadLogs();
  }, []);

  // 监听级别变化，重新加载和监听
  useEffect(() => {
    loadLogs();
    if (isWatching) {
      stopWatch().then(() => startWatch());
    }
  }, [filterLevel]);

  // 监听新日志记录
  useEffect(() => {
    const handleNewRecord = (record: LogRecord) => {
      // 应用级别过滤
      if (filterLevel !== 'all' && record.level !== filterLevel) {
        return;
      }

      setLogs(prev => [...prev, record].slice(-1000));
    };

    window.electron.onLogsNewRecord(handleNewRecord);

    return () => {
      window.electron.removeAllListeners('logs:new-record');
    };
  }, [filterLevel]);

  // 组件挂载时启动监听
  useEffect(() => {
    startWatch();
    return () => {
      stopWatch();
    };
  }, []);

  // 过滤日志（关键词）
  const filteredLogs = useMemo(() => {
    if (!keyword.trim()) return logs;

    const kw = keyword.toLowerCase();
    return logs.filter(log =>
      log.message.toLowerCase().includes(kw) ||
      log.namespace.toLowerCase().includes(kw)
    );
  }, [logs, keyword]);

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

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN', { hour12: false });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="flex flex-col space-y-3">
      {/* 标题和操作栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">📋 日志流</div>
          {isWatching && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              实时
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={loadLogs}
            disabled={isLoading}
            variant="ghost"
            size="sm"
            className="flex items-center gap-1 disabled:opacity-50"
            title="刷新日志"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            刷新
          </Button>
          <Button
            onClick={handleClearLogs}
            variant="ghost"
            size="sm"
            className="flex items-center gap-1"
            title="清空日志"
          >
            <Trash2 size={12} />
            清空
          </Button>
        </div>
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

        {/* 关键词搜索 */}
        <div className="flex-1 flex items-center gap-1 bg-bg-primary border border-bg-tertiary rounded px-2 py-1">
          <Search size={12} className="text-text-secondary" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索日志..."
            className="flex-1 bg-transparent text-xs focus:outline-none"
          />
        </div>

        {/* 统计 */}
        <div className="text-text-secondary">
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
          <div className="text-center text-text-secondary py-8">
            {isLoading ? '加载中...' : '暂无日志'}
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className="flex items-start gap-2 py-1 hover:bg-bg-secondary rounded px-2">
              {/* 时间 */}
              <span className="text-text-tertiary flex-shrink-0 w-20">
                {formatTime(log.timestamp)}
              </span>

              {/* 级别图标 */}
              <div className="flex-shrink-0 mt-0.5">{getLevelIcon(log.level)}</div>

              {/* 级别文本 */}
              <span className={`${getLevelColor(log.level)} w-12 flex-shrink-0 uppercase font-semibold`}>
                {log.level}
              </span>

              {/* 命名空间 */}
              <span className="text-purple-400 flex-shrink-0 max-w-[150px] truncate" title={log.namespace}>
                [{log.namespace}]
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
          <Button
            onClick={() => {
              setAutoScroll(true);
              logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            variant="link"
            size="sm"
            className="text-primary"
          >
            ↓ 跳转到最新日志
          </Button>
        </div>
      )}
    </div>
  );
}
