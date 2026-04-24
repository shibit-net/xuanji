import React, { useState, useEffect } from 'react';

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
    // 监听下载事件（实时更新）
    const handleDownloadEvent = (event: { type: string; task: DownloadTask }) => {
      console.log('[DownloadQueue] 收到下载事件:', event.type, event.task);
      setTasks((prevTasks) => {
        const existingIndex = prevTasks.findIndex((t) => t.id === event.task.id);

        if (existingIndex >= 0) {
          // 更新现有任务
          const newTasks = [...prevTasks];
          newTasks[existingIndex] = event.task;
          console.log('[DownloadQueue] 更新任务:', event.task.id, event.task.status);
          return newTasks;
        } else {
          // 添加新任务
          console.log('[DownloadQueue] 添加新任务:', event.task.id, event.task.name);
          return [...prevTasks, event.task];
        }
      });
    };

    console.log('[DownloadQueue] 注册 download:event 监听器');
    window.electron.on('download:event', handleDownloadEvent);

    // 初始加载任务列表（在注册监听器后立即执行，确保不会错过任何任务）
    const loadTasks = async () => {
      try {
        console.log('[DownloadQueue] 初始加载任务列表...');
        const result = await window.electron.downloadGetTasks();
        if (result.success && result.tasks) {
          console.log('[DownloadQueue] 加载到', result.tasks.length, '个任务');
          setTasks(result.tasks);
        }
      } catch (err) {
        console.error('[DownloadQueue] 加载任务列表失败:', err);
      }
    };
    loadTasks();

    // 清理监听器
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
      console.log('[DownloadQueue] 取消下载:', taskId);
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
      style={{
        position: expanded ? 'fixed' : 'relative',
        bottom: expanded ? 0 : 'auto',
        right: expanded ? 0 : 'auto',
        width: expanded ? '400px' : 'auto',
        maxHeight: expanded ? '400px' : '28px',
        backgroundColor: expanded ? '#1e1e1e' : 'transparent',
        borderTop: expanded ? '1px solid #3c3c3c' : 'none',
        borderLeft: expanded ? '1px solid #3c3c3c' : 'none',
        borderBottom: 'none',
        borderRight: 'none',
        borderRadius: expanded ? '4px 0 0 0' : '0',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        zIndex: expanded ? 1000 : 'auto',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          backgroundColor: expanded ? '#2d2d2d' : 'transparent',
          cursor: 'pointer',
          userSelect: 'none',
          height: '28px',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#cccccc' }}>
            {expanded ? '▼' : '▶'} 下载队列
          </span>
          {activeTasks.length > 0 && (
            <span
              style={{
                fontSize: '12px',
                color: '#4ec9b0',
                backgroundColor: '#264f44',
                padding: '2px 6px',
                borderRadius: '10px',
              }}
            >
              {activeTasks.length}
            </span>
          )}
        </div>
        {expanded && finishedTasks.length > 0 && (
          <button
            style={{
              fontSize: '12px',
              color: '#cccccc',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleClearFinished();
            }}
          >
            清除已完成
          </button>
        )}
      </div>

      {/* 任务列表 */}
      {expanded && (
        <div
          style={{
            maxHeight: '360px',
            overflowY: 'auto',
            padding: '8px',
          }}
        >
          {tasks.map((task) => (
            <div
              key={task.id}
              style={{
                marginBottom: '8px',
                padding: '8px',
                backgroundColor: '#252526',
                borderRadius: '4px',
                border: '1px solid #3c3c3c',
              }}
            >
              {/* 任务名称 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    color: '#cccccc',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                  title={task.name}
                >
                  {task.name}
                </span>
                {task.status === 'downloading' && (
                  <button
                    style={{
                      fontSize: '11px',
                      color: '#f48771',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                    onClick={() => handleCancel(task.id)}
                  >
                    取消
                  </button>
                )}
              </div>

              {/* 进度条 */}
              {(task.status === 'downloading' || task.status === 'pending') && (
                <>
                  <div
                    style={{
                      width: '100%',
                      height: '4px',
                      backgroundColor: '#3c3c3c',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      marginBottom: '4px',
                    }}
                  >
                    <div
                      style={{
                        width: `${task.progress.percent}%`,
                        height: '100%',
                        backgroundColor: '#4ec9b0',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: '#858585',
                    }}
                  >
                    <span>
                      {formatSize(task.progress.downloaded)} / {formatSize(task.progress.total)}
                    </span>
                    <span>{formatSpeed(task.progress.speed)}</span>
                  </div>
                </>
              )}

              {/* 状态 */}
              {task.status === 'completed' && (
                <div style={{ fontSize: '11px', color: '#4ec9b0' }}>✓ 下载完成</div>
              )}
              {task.status === 'failed' && (
                <div style={{ fontSize: '11px', color: '#f48771' }}>
                  ✗ 失败: {task.error}
                </div>
              )}
              {task.status === 'cancelled' && (
                <div style={{ fontSize: '11px', color: '#858585' }}>已取消</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
