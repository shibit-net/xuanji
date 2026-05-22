/**
 * WebhookServer — 共享 HTTP 服务器
 *
 * 飞书/钉钉/企微的三个 Webhook 端点复用同一 HTTP server。
 * 每个适配器注册自己的路由和处理逻辑。
 *
 * 设计文档：docs/platform-integration-design.md §5 + §11.1
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'WebhookServer' });

// ─── 类型 ──────────────────────────────────────────────────

export interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface WebhookResponse {
  statusCode: number;
  body?: string;
}

export type WebhookHandler = (req: WebhookRequest) => Promise<WebhookResponse>;

// ─── WebhookServer ────────────────────────────────────────

export class WebhookServer {
  private server: Server | null = null;
  private routes = new Map<string, WebhookHandler>();

  constructor(private port: number = 0) {}

  /** 注册 Webhook 路由 */
  register(path: string, handler: WebhookHandler): void {
    this.routes.set(path, handler);
    log.info(`Webhook route registered: ${path}`);
  }

  /** 取消注册 */
  unregister(path: string): void {
    this.routes.delete(path);
  }

  /** 启动服务器 */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err) {
          log.error(`Webhook error: ${(err as Error).message}`);
          res.writeHead(500).end('Internal Error');
        }
      });

      this.server.on('error', reject);

      this.server.listen(this.port, () => {
        const addr = this.server!.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        log.info(`WebhookServer started on port ${actualPort}`);
        resolve(actualPort);
      });
    });
  }

  /** 停止服务器 */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        log.info('WebhookServer stopped');
        resolve();
      });
    });
  }

  /** 获取监听端口 */
  getPort(): number | null {
    if (!this.server) return null;
    const addr = this.server.address();
    return typeof addr === 'object' && addr ? addr.port : null;
  }

  // ── 请求处理 ─────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    const handler = this.routes.get(path);
    if (!handler) {
      res.writeHead(404).end('Not Found');
      return;
    }

    // 读取请求体
    const body = await this.readBody(req);

    const webhookReq: WebhookRequest = {
      method: req.method || 'POST',
      path,
      headers: req.headers,
      body,
    };

    const response = await handler(webhookReq);

    // 设置响应头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    res.writeHead(response.statusCode);
    res.end(response.body || '');
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}

// ─── 便捷辅助函数 ──────────────────────────────────────────

/** 快速创建 200 响应（Webhook ACK） */
export function webhookOk(body?: string): WebhookResponse {
  return { statusCode: 200, body };
}

/** 快速创建错误响应 */
export function webhookError(statusCode: number, message: string): WebhookResponse {
  return { statusCode, body: JSON.stringify({ error: message }) };
}
