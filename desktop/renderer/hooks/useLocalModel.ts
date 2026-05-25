// ============================================================
// useLocalModel - 本地模型状态管理 Hook
// ============================================================

import { useState, useEffect } from 'react';

export type LocalModelType = 'qwen2.5-0.5b-q4' | 'qwen2.5-1.5b-q4' | 'chatglm3-6b-q4' | 'chatglm3-6b-q3' | 'glm4-9b-q4';

export interface LocalModelInfo {
  id: LocalModelType;
  name: string;
  size: string;
  description: string;
  filename: string;
}

export const LOCAL_MODELS: Record<LocalModelType, LocalModelInfo> = {
  'qwen2.5-0.5b-q4': {
    id: 'qwen2.5-0.5b-q4',
    name: 'Qwen2.5-0.5B (Q4)',
    size: '469 MB',
    description: '轻量级模型，速度快',
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  },
  'qwen2.5-1.5b-q4': {
    id: 'qwen2.5-1.5b-q4',
    name: 'Qwen2.5-1.5B (Q4)',
    size: '1.1 GB',
    description: '更准确，速度较慢',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  'chatglm3-6b-q4': {
    id: 'chatglm3-6b-q4',
    name: 'ChatGLM3-6B (Q4)',
    size: '3.5 GB',
    description: '高精度分类，推荐',
    filename: 'chatglm3-6b.Q4_K_M.gguf',
  },
  'chatglm3-6b-q3': {
    id: 'chatglm3-6b-q3',
    name: 'ChatGLM3-6B (Q3)',
    size: '2.7 GB',
    description: '更快，精度略降',
    filename: 'chatglm3-6b.Q3_K_M.gguf',
  },
  'glm4-9b-q4': {
    id: 'glm4-9b-q4',
    name: 'GLM-4-9B (Q4)',
    size: '5.4 GB',
    description: '最高精度，资源需求高',
    filename: 'glm-4-9b-chat.Q4_K_M.gguf',
  },
};

export interface LocalModelStatus {
  installed: boolean;
  downloading: boolean;
  progress: number;
  error?: string;
}

export function useLocalModel(modelId: string | undefined, downloadSource?: string, hfMirror?: string) {
  const [status, setStatus] = useState<LocalModelStatus>({
    installed: false,
    downloading: false,
    progress: 0,
  });

  const isLocalModel = modelId && modelId in LOCAL_MODELS;
  const modelInfo = isLocalModel ? LOCAL_MODELS[modelId as LocalModelType] : null;

  useEffect(() => {
    if (!isLocalModel) return;

    // 检查模型是否已安装
    const checkInstalled = async () => {
      try {
        const result = await window.electron.localModelCheck(modelId);
        if (result.success) {
          setStatus((prev) => ({ ...prev, installed: result.installed || false }));
        }
      } catch (err) {
        console.error('Failed to check model status:', err);
      }
    };

    checkInstalled();

    // 监听下载进度
    const interval = setInterval(async () => {
      try {
        const result = await window.electron.downloadGetTasks();
        if (result.success && result.tasks) {
          const modelTask = result.tasks.find(
            (t) => t.category === 'model' && t.name.includes(modelInfo?.filename || '')
          );

          if (modelTask) {
            setStatus({
              installed: modelTask.status === 'completed',
              downloading: modelTask.status === 'downloading' || modelTask.status === 'pending',
              progress: modelTask.progress.percent,
              error: modelTask.status === 'failed' ? modelTask.error : undefined,
            });
          }
        }
      } catch (err) {
        console.error('Failed to get download tasks:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [modelId, isLocalModel, modelInfo?.filename]);

  const startDownload = async () => {
    if (!isLocalModel || !modelInfo) return;

    try {
      const result = await window.electron.localModelDownload(modelId, downloadSource, hfMirror);
      if (result.success) {
        setStatus((prev) => ({ ...prev, downloading: true, progress: 0 }));
      } else {
        setStatus((prev) => ({ ...prev, error: result.error }));
      }
    } catch (err: any) {
      setStatus((prev) => ({ ...prev, error: err.message }));
    }
  };

  return {
    isLocalModel,
    modelInfo,
    status,
    startDownload,
  };
}
