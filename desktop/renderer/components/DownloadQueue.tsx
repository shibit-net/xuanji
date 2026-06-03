import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import clsx from 'clsx';

interface DownloadTask {
  id: string;
  url: string;
  name: string;
  category?: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: {
    percent: number;
    downloaded: number;
    total: number;
    speed: number;
  };
  error?: string;
}

export const DownloadQueue: React.FC = () => {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const handleDownloadEvent = (event: { type: string; task: DownloadTask }) => {
      setTasks((prevTasks) => {
        const existingIndex = prevTasks.findIndex((t) => t.id === event.task.id);
        if (existingIndex >= 0) {
          const newTasks = [...prevTasks];
          newTasks[existingIndex] = event.task;
          return newTasks;
        } else {
          return [...prevTasks, event.task];
        }
      });
    };

    window.electron.on('download:event', handleDownloadEvent);

    const loadTasks = async () => {
      try {
        const result = await window.electron.downloadGetTasks();
        if (result.success && result.tasks) {
          setTasks(result.tasks);
        }
      } catch (err) {
        console.error('[DownloadQueue] 加载任务列表失败:', err);
      }
    };
    loadTasks();

    return () => {
      window.electron.off('download:event', handleDownloadEvent);
    };
  }, []);

  const activeTasks = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'pending'
  );
  const finishedTasks = tasks.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );

  if (tasks.length === 0) return null;

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    return `${formatSize(bytesPerSec)}/s`;
  };

  const handleCancel = async (taskId: string) => {
    try {
      await window.electron.downloadCancel(taskId);
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  };

  const handleClearFinished = async () => {
    try {
      await window.electron.downloadClearFinished();
    } catch (err) {
      console.error('Failed to clear finished downloads:', err);
    }
  };

  return (
    <div
      className={clsx(
        'overflow-hidden transition-all duration-300',
        expanded
          ? 'fixed bottom-0 right-0 w-[400px] max-h-[400px] bg-card border-t border-l border-border rounded-tl z-[1000]'
          : 'relative h-7'
      )}
    >
      {/* 标题栏 */}
      <div
        className={clsx(
          'flex items-center justify-between px-3 h-7 cursor-pointer select-none',
          expanded && 'bg-muted/30'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground/70">
            {expanded ? '▼' : '▶'} 下载队列
          </span>
          {activeTasks.length > 0 && (
            <span className="text-xs text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded-full">
              {activeTasks.length}
            </span>
          )}
        </div>
        {expanded && finishedTasks.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-foreground/70 bg-transparent border-none cursor-pointer px-1.5 py-0.5 h-auto"
            onClick={(e) => {
              e.stopPropagation();
              handleClearFinished();
            }}
          >
            清除已完成
          </Button>
        )}
      </div>

      {/* 任务列表 */}
      {expanded && (
        <div className="max-h-[360px] overflow-y-auto p-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="mb-2 p-2 bg-muted/50 rounded border border-border"
            >
              {/* 任务名称 */}
              <div className="flex justify-between items-center mb-1">
                <span
                  className="text-[13px] text-foreground/70 overflow-hidden text-ellipsis whitespace-nowrap flex-1"
                  title={task.name}
                >
                  {task.name}
                </span>
                {task.status === 'downloading' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px] text-red-400 bg-transparent border-none cursor-pointer px-1 py-0.5 h-auto"
                    onClick={() => handleCancel(task.id)}
                  >
                    取消
                  </Button>
                )}
              </div>

              {/* 进度条 */}
              {(task.status === 'downloading' || task.status === 'pending') && (
                <>
                  <div className="w-full h-1 bg-border rounded-sm overflow-hidden mb-1">
                    <div
                      className="h-full bg-emerald-400 transition-[width] duration-300"
                      style={{ width: `${task.progress.percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>
                      {formatSize(task.progress.downloaded)} / {formatSize(task.progress.total)}
                    </span>
                    <span>{formatSpeed(task.progress.speed)}</span>
                  </div>
                </>
              )}

              {/* 状态 */}
              {task.status === 'completed' && (
                <div className="text-[11px] text-emerald-400">✓ 下载完成</div>
              )}
              {task.status === 'failed' && (
                <div className="text-[11px] text-red-400">
                  ✗ 失败: {task.error}
                </div>
              )}
              {task.status === 'cancelled' && (
                <div className="text-[11px] text-muted-foreground">已取消</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
