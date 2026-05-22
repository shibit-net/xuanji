// ============================================================
// RemoteControlService — 手机远程操控服务
// ============================================================
//
// 在 Electron 主进程中启动一个 HTTP + WebSocket 服务，
// 提供屏幕截图和远程操作能力。
//
// NAT 穿透：Cloudflare Tunnel（免费，零配置）
// 用法: cloudflared tunnel --url http://localhost:3899
//
// 安全：启动时生成随机 token，手机端首次扫码配对

import { app, desktopCapturer, BrowserWindow } from 'electron';
import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface RemoteConfig {
  port: number;
  enableAuth: boolean;
}

const DEFAULT_CONFIG: RemoteConfig = {
  port: 3899,
  enableAuth: true,
};

export class RemoteControlService {
  private config: RemoteConfig;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private token: string = '';
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private clients = new Map<WebSocket, { authenticated: boolean }>();

  constructor(config?: Partial<RemoteConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 生成随机配对 token */
  generateToken(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    this.token = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return this.token;
  }

  getToken(): string {
    return this.token || this.generateToken();
  }

  /** 启动服务 */
  async start(): Promise<void> {
    await this.ensureScreenPermission();
    this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress || 'unknown';
      console.log(`[RemoteControl] WS client connected: ${clientIp}`);

      this.clients.set(ws, { authenticated: !this.config.enableAuth });

      ws.on('message', (data) => this.handleMessage(ws, data));
      ws.on('close', () => {
        this.clients.delete(ws);
        if (this.clients.size === 0) this.stopCapture();
      });
      ws.on('error', () => this.clients.delete(ws));
    });

    return new Promise((resolve) => {
      this.httpServer!.listen(this.config.port, '0.0.0.0', () => {
        console.log(`[RemoteControl] Server running on http://0.0.0.0:${this.config.port}`);
        resolve();
      });
    });
  }

  /** 停止服务 */
  stop(): void {
    this.stopCapture();
    if (this.wss) {
      this.wss.clients.forEach(c => c.close());
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.clients.clear();
  }

  // ── HTTP 请求处理 ─────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // 静态页面（PWA 前端）
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html', ...corsHeaders });
      res.end(this.getHtmlPage());
      return;
    }

    // API
    try {
      switch (url.pathname) {
        case '/api/token':
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ token: this.getToken() }));
          break;

        case '/api/screenshot':
          const dataUrl = await this.captureScreenshot();
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ image: dataUrl }));
          break;

        case '/api/status':
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({
            name: 'xuanji',
            platform: process.platform,
            online: true,
            tokenRequired: this.config.enableAuth,
          }));
          break;

        default:
          res.writeHead(404, { ...corsHeaders });
          res.end('Not found');
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  // ── WebSocket 消息处理 ───────────────────────────

  private handleMessage(ws: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]) {
    try {
      const msg = JSON.parse(raw.toString());
      const client = this.clients.get(ws);
      if (!client) return;

      switch (msg.type) {
        case 'auth':
          if (msg.token === this.token) {
            client.authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
            this.startCapture();
          } else {
            ws.send(JSON.stringify({ type: 'auth_fail', message: 'Token 错误' }));
          }
          break;

        case 'click':
          if (!client.authenticated) return;
          this.sendToMain({ type: 'remote:click', x: msg.x, y: msg.y });
          break;

        case 'doubleclick':
          if (!client.authenticated) return;
          this.sendToMain({ type: 'remote:doubleclick', x: msg.x, y: msg.y });
          break;

        case 'scroll':
          if (!client.authenticated) return;
          this.sendToMain({ type: 'remote:scroll', x: msg.x, y: msg.y, deltaX: msg.deltaX, deltaY: msg.deltaY });
          break;

        case 'type':
          if (!client.authenticated) return;
          this.sendToMain({ type: 'remote:type', text: msg.text });
          break;
      }
    } catch { /* ignore malformed */ }
  }

  // ── 截图 ───────────────────────────────────────────

  private async captureScreenshot(): Promise<string> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (sources.length === 0) throw new Error('No screen source found');
    return sources[0].thumbnail.toDataURL();
  }

  /** 开始定期推送画面到已认证客户端 */
  private startCapture() {
    if (this.captureInterval) return;
    this.captureInterval = setInterval(async () => {
      try {
        const image = await this.captureScreenshot();
        const payload = JSON.stringify({ type: 'frame', image });
        for (const [ws, client] of this.clients) {
          if (client.authenticated && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        }
      } catch { /* skip frame on error */ }
    }, 200); // 5fps
  }

  private stopCapture() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  // ── 权限 ───────────────────────────────────────────

  private async ensureScreenPermission(): Promise<void> {
    if (process.platform === 'darwin') {
      // macOS 需要屏幕录制权限
      // 首次启动时弹窗引导用户去系统设置开启
      const os = require('node:os');
      console.log('[RemoteControl] macOS screen recording permission required.');
      console.log('[RemoteControl] Go to System Settings > Privacy & Security > Screen Recording');
    }
  }

  // ── IPC → 主进程 ─────────────────────────────────

  private sendToMain(data: any) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:action', data);
    }
  }

  // ── PWA 前端页面 ─────────────────────────────────

  private getHtmlPage(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>xuanji 远程桌面</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d12;color:#e2e8f0;font-family:-apple-system,sans-serif;overflow:hidden;height:100dvh;touch-action:none}
#container{width:100%;height:100%;position:relative}
#screen{width:100%;height:100%;object-fit:contain;image-rendering:auto;touch-action:none}
#overlay{position:absolute;inset:0;width:100%;height:100%;z-index:10}
#status{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(13,13,18,0.8);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:6px 16px;font-size:13px;z-index:20;white-space:nowrap}
#pairing{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(13,13,18,0.95);z-index:30;gap:16px;padding:24px}
#pairing.hidden{display:none}
.token{font-size:48px;font-weight:700;letter-spacing:8px;color:#60a5fa;font-family:monospace}
.hint{font-size:14px;color:#94a3b8;text-align:center;max-width:300px;line-height:1.6}
.toolbar{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:20;display:flex;gap:8px;background:rgba(13,13,18,0.85);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:8px 12px}
.toolbar button{width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#94a3b8;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
.toolbar button:active{background:rgba(96,165,250,0.2);color:#60a5fa}
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.status-dot.online{background:#4ade80;box-shadow:0 0 6px #4ade8080}
.status-dot.offline{background:#f87171;box-shadow:0 0 6px #f8717180}
</style>
</head>
<body>
<div id="container">
  <div id="status"><span class="status-dot online" id="dot"></span><span id="statusText">连接中...</span></div>
  <div id="pairing">
    <div style="font-size:14px;color:#94a3b8;margin-bottom:4px">配对码</div>
    <div class="token" id="tokenDisplay">------</div>
    <div class="hint">在 xuanji 桌面端打开远程控制<br>输入此配对码完成连接</div>
  </div>
  <img id="screen" src="" alt="screenshot" />
  <div id="overlay"></div>
  <div class="toolbar">
    <button id="btnClick" style="border-color:#60a5fa44;color:#60a5fa">👆</button>
    <button id="btnBack">↩</button>
    <button id="btnHome">🏠</button>
    <button id="btnKeyboard">⌨️</button>
  </div>
</div>
<script>
const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
let ws;
let mode = 'touch'; // 'touch' | 'mouse'
let lastTouch = null;
let isDragging = false;
let authToken = '';
let connected = false;

const screen = document.getElementById('screen');
const overlay = document.getElementById('overlay');
const statusText = document.getElementById('statusText');
const pairingDiv = document.getElementById('pairing');
const tokenDisplay = document.getElementById('tokenDisplay');

function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { statusText.textContent = '已连接'; pairingDiv.classList.remove('hidden'); };
  ws.onclose = () => { statusText.textContent = '已断开'; connected = false; setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch(msg.type) {
      case 'auth_ok':
        pairingDiv.classList.add('hidden');
        connected = true;
        statusText.textContent = '远程控制中';
        break;
      case 'auth_fail':
        alert('配对失败: ' + msg.message);
        pairingDiv.classList.remove('hidden');
        break;
      case 'frame':
        screen.src = msg.image;
        break;
    }
  };
}

// 获取配对码
fetch('/api/token').then(r => r.json()).then(d => { tokenDisplay.textContent = d.token; authToken = d.token; });

// WebSocket 认证
function doAuth() {
  if (ws && ws.readyState === WebSocket.OPEN && authToken) {
    ws.send(JSON.stringify({ type: 'auth', token: authToken }));
  }
}
setInterval(() => { if (!connected && authToken) doAuth(); }, 1000);

// 触控 → 发送坐标
overlay.addEventListener('touchstart', (e) => {
  lastTouch = { id: e.changedTouches[0].identifier, x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY, time: Date.now() };
  isDragging = false;
});
overlay.addEventListener('touchmove', (e) => {
  const t = e.changedTouches[0];
  if (lastTouch && lastTouch.id === t.identifier) {
    const dx = t.clientX - lastTouch.x;
    const dy = t.clientY - lastTouch.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
    if (isDragging && connected) {
      ws.send(JSON.stringify({ type: 'scroll', deltaX: -dx, deltaY: -dy, x: t.clientX, y: t.clientY }));
    }
    lastTouch = { id: t.identifier, x: t.clientX, y: t.clientY, time: Date.now() };
  }
});
overlay.addEventListener('touchend', (e) => {
  if (!isDragging && lastTouch && connected) {
    const rect = overlay.getBoundingClientRect();
    const scaleX = screen.naturalWidth / rect.width || 1;
    const scaleY = screen.naturalHeight / rect.height || 1;
    const x = Math.round(lastTouch.x * scaleX);
    const y = Math.round(lastTouch.y * scaleY);
    ws.send(JSON.stringify({ type: 'click', x, y }));
  }
  lastTouch = null;
  isDragging = false;
});

connect();
</script>
</body>
</html>`;
  }
}
