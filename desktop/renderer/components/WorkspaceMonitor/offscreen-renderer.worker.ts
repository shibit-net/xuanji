// ============================================================
// Workspace Monitor - OffscreenCanvas 渲染 Worker
// ============================================================
// 在 Web Worker 中运行完整的 Canvas 渲染管线
// 主线程通过 rAF 发送 "frame" 消息驱动渲染循环

import { CanvasRenderer } from './CanvasRenderer';
import type { WorkspaceState } from './types';

let renderer: CanvasRenderer | null = null;
let frameCount = 0;
let lastStatsTime = 0;

/** Worker 消息处理 */
self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  switch (type) {
    case 'init': {
      const { canvas, dpr, containerWidth, containerHeight } = e.data;
      try {
        renderer = new CanvasRenderer(canvas, { dpr, containerWidth, containerHeight });
        // Worker 模式不调用 start()（无 rAF），渲染由主线程 frame 消息驱动
        self.postMessage({ type: 'ready' });
      } catch (err: any) {
        self.postMessage({ type: 'error', message: err?.message || '初始化渲染器失败' });
      }
      break;
    }

    case 'frame': {
      if (!renderer) return;
      const { timestamp } = e.data;
      renderer.renderFrame(timestamp);

      // 将渲染结果以 ImageBitmap 形式发回主线程
      const bitmap = renderer.getCanvas().transferToImageBitmap();
      self.postMessage({ type: 'bitmap', bitmap }, [bitmap]);

      frameCount++;
      if (timestamp - lastStatsTime > 1000) {
        lastStatsTime = timestamp;
        self.postMessage({ type: 'stats', fps: frameCount, viewScale: renderer.getViewScale() });
        frameCount = 0;
      }
      break;
    }

    case 'updateState': {
      if (!renderer) return;
      const { state }: { state: WorkspaceState } = e.data;
      renderer.updateState(state);
      break;
    }

    case 'resize': {
      if (!renderer) return;
      const { width, height, dpr } = e.data;
      renderer.updateCanvasSize(width, height, dpr);
      break;
    }

    case 'zoom': {
      if (!renderer) return;
      const { factor, screenX, screenY } = e.data;
      renderer.zoom(factor, screenX, screenY);
      break;
    }

    case 'pan': {
      if (!renderer) return;
      const { deltaX, deltaY } = e.data;
      renderer.pan(deltaX, deltaY);
      break;
    }

    case 'resetView': {
      if (!renderer) return;
      renderer.resetView();
      break;
    }

    case 'zoomToFit': {
      if (!renderer) return;
      renderer.zoomToFit();
      break;
    }

    case 'destroy': {
      if (renderer) {
        renderer.destroy();
        renderer = null;
      }
      break;
    }

    default:
      console.warn('[OffscreenWorker] 未知消息类型:', type);
  }
};
