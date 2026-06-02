// ============================================================
// 媒体生成适配器 — 共享工具函数
// ============================================================

import type { ToolMediaGenConfig } from '@/shared/types/config';
import type { ContentBlockResult } from './PlatformAdapter';

/**
 * 带超时的 HTTP POST 请求
 */
export async function apiPost(
  url: string,
  cfg: ToolMediaGenConfig,
  body: unknown,
  timeoutMs = 30_000,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const bodyText = await resp.text();
    if (!resp.ok) {
      let msg: string;
      try {
        msg =
          JSON.parse(bodyText)?.error?.message ||
          JSON.parse(bodyText)?.message ||
          `HTTP ${resp.status}`;
      } catch {
        msg = `HTTP ${resp.status}: ${bodyText.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    return JSON.parse(bodyText);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带超时的 HTTP GET 请求
 */
export async function apiGet(
  url: string,
  cfg: ToolMediaGenConfig,
  timeoutMs = 30_000,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
    });
    const bodyText = await resp.text();
    if (!resp.ok) {
      let msg: string;
      try {
        msg =
          JSON.parse(bodyText)?.error?.message ||
          JSON.parse(bodyText)?.message ||
          `HTTP ${resp.status}`;
      } catch {
        msg = `HTTP ${resp.status}: ${bodyText.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    return JSON.parse(bodyText);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP DELETE 请求（取消任务等场景）
 */
export async function apiDelete(
  url: string,
  cfg: ToolMediaGenConfig,
  timeoutMs = 30_000,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
    });
    const bodyText = await resp.text();
    if (!resp.ok && resp.status !== 204) {
      let msg: string;
      try {
        msg =
          JSON.parse(bodyText)?.error?.message ||
          JSON.parse(bodyText)?.message ||
          `HTTP ${resp.status}`;
      } catch {
        msg = `HTTP ${resp.status}: ${bodyText.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    return bodyText ? JSON.parse(bodyText) : { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 异步任务轮询器（视频生成等场景）
 */
export async function waitForAsyncTask(
  api: {
    createTask(): Promise<{ taskId: string }>;
    pollStatus(taskId: string): Promise<{
      status: 'running' | 'succeeded' | 'failed';
      result?: any;
      error?: string;
    }>;
  },
  cfg: ToolMediaGenConfig,
): Promise<any> {
  const interval = cfg.pollInterval || 5000;
  const timeout = cfg.pollTimeout || 600_000;
  const start = Date.now();

  const { taskId } = await api.createTask();
  while (Date.now() - start < timeout) {
    const s = await api.pollStatus(taskId);
    if (s.status === 'succeeded') return s.result;
    if (s.status === 'failed') throw new Error(s.error || 'Task failed');
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Task timed out after ${timeout}ms`);
}

/**
 * 从 API 响应中提取 b64_json / url 图片
 */
export function parseB64Images(data: any): ContentBlockResult[] {
  if (!data?.data || !Array.isArray(data.data)) {
    throw new Error('API 响应格式异常：缺少 data 数组');
  }
  const blocks: ContentBlockResult[] = [];
  for (const item of data.data) {
    if (item.b64_json) {
      blocks.push({ type: 'image', mimeType: 'image/png', data: item.b64_json });
    } else if (item.url) {
      blocks.push({ type: 'image', mimeType: 'image/png', data: '', url: item.url });
    }
  }
  if (blocks.length === 0) {
    throw new Error('API 返回了空的生成结果');
  }
  return blocks;
}

/**
 * 将简写尺寸转为具体分辨率
 */
export function resolveSize(input?: string, defaultSize?: string): string {
  const map: Record<string, string> = {
    '1K': '1024x1024',
    '2K': '2048x2048',
    '4K': '4096x4096',
  };
  return map[input || defaultSize || '2K'] || '2048x2048';
}
