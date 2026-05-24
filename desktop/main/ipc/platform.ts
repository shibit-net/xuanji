/**
 * Platform IPC 处理器 — 远端平台接入管理
 *
 * 设计文档：docs/platform-integration-design.md §12.5
 */

import { ipcMain, BrowserWindow } from 'electron';
import { logger } from '../../../src/core/logger/index.js';
import { enhancedMessageBus } from './GlobalMessageBus.js';

const log = logger.child({ module: 'PlatformIPC' });

// ─── 平台桥接单例（延迟初始化）─────────────────────────────

let platformRouter: any = null;
let webhookServer: any = null;
let platformReady = false;
let messageHandlerRegistered = false;

/** 将平台消息转发到 agent-bridge 子进程进行自动处理 */
function forwardToAgentBridge(msg: any): void {
  const agentChannel = enhancedMessageBus.getChannel('agent');
  log.info(`[DIAG] forwardToAgentBridge: channel=${!!agentChannel} connected=${agentChannel?.isConnected()}`);
  if (agentChannel && agentChannel.isConnected()) {
    agentChannel.send('platform:message', {
      id: msg.id,
      sessionKey: msg.sessionKey,
      platform: msg.platform,
      text: msg.text,
      userId: msg.userId,
      chatId: msg.chatId,
      chatType: msg.chatType,
      channelPrompt: msg.channelPrompt,
    });
    log.info(`[DIAG] Forwarded platform message to agent-bridge: ${msg.id} platform=${msg.platform} text="${(msg.text || '').slice(0, 50)}"`);
  } else {
    log.warn(`[DIAG] Cannot forward platform message: channel not ready`);
  }
}

/** 接收 agent-bridge 的回复并发送到远端平台 */
async function handleAgentBridgeReply(data: {
  sessionKey: string;
  platform: string;
  chatId: string;
  text: string;
  imagePaths?: string[];
  audioPaths?: string[];
  videoPaths?: string[];
  filePaths?: string[];
}): Promise<void> {
  try {
    log.info(`[DIAG] handleAgentBridgeReply: platformRouter=${!!platformRouter} platform=${data.platform} chatId=${data.chatId} text="${(data.text || '').slice(0, 50)}" images=${data.imagePaths?.length || 0} audios=${data.audioPaths?.length || 0} videos=${data.videoPaths?.length || 0} files=${data.filePaths?.length || 0}`);
    if (!platformRouter) {
      log.warn(`[DIAG] handleAgentBridgeReply: platformRouter is null, skipping reply`);
      return;
    }
    const adapter = platformRouter.getAdapter(data.platform);
    if (!adapter) {
      log.warn(`[DIAG] handleAgentBridgeReply: No adapter for reply: ${data.platform}`);
      return;
    }
    await adapter.sendText({ chatId: data.chatId, text: data.text });

    // 发送 agent 生成的图片
    if (data.imagePaths?.length && typeof adapter.sendImage === 'function') {
      for (const imagePath of data.imagePaths) {
        try {
          await adapter.sendImage({ chatId: data.chatId, imagePath, replyTo: undefined });
          log.info(`[DIAG] Agent image sent to ${data.platform}/${data.chatId}: ${imagePath}`);
        } catch (imgErr) {
          log.error(`[DIAG] Failed to send image to ${data.platform}: ${(imgErr as Error).message}`);
        }
      }
    }

    // 发送 agent 生成的语音（优先走 sendVoice，降级走 sendFile）
    if (data.audioPaths?.length) {
      for (const audioPath of data.audioPaths) {
        try {
          if (typeof adapter.sendVoice === 'function') {
            await adapter.sendVoice({ chatId: data.chatId, voicePath: audioPath, replyTo: undefined });
            log.info(`[DIAG] Agent voice sent to ${data.platform}/${data.chatId}: ${audioPath}`);
          } else if (typeof adapter.sendFile === 'function') {
            await adapter.sendFile({ chatId: data.chatId, filePath: audioPath, replyTo: undefined });
            log.info(`[DIAG] Agent audio sent to ${data.platform}/${data.chatId} (via sendFile): ${audioPath}`);
          }
        } catch (voiceErr) {
          log.error(`[DIAG] Failed to send audio to ${data.platform}: ${(voiceErr as Error).message}`);
        }
      }
    }

    // 发送 agent 生成的视频（走 sendFile）
    if (data.videoPaths?.length && typeof adapter.sendFile === 'function') {
      for (const videoPath of data.videoPaths) {
        try {
          await adapter.sendFile({ chatId: data.chatId, filePath: videoPath, replyTo: undefined });
          log.info(`[DIAG] Agent video sent to ${data.platform}/${data.chatId}: ${videoPath}`);
        } catch (fileErr) {
          log.error(`[DIAG] Failed to send video to ${data.platform}: ${(fileErr as Error).message}`);
        }
      }
    }

    // 发送 agent 生成的文件
    if (data.filePaths?.length && typeof adapter.sendFile === 'function') {
      for (const filePath of data.filePaths) {
        try {
          await adapter.sendFile({ chatId: data.chatId, filePath, replyTo: undefined });
          log.info(`[DIAG] Agent file sent to ${data.platform}/${data.chatId}: ${filePath}`);
        } catch (fileErr) {
          log.error(`[DIAG] Failed to send file to ${data.platform}: ${(fileErr as Error).message}`);
        }
      }
    }

    broadcastToAll('platform:message-sent', {
      sessionKey: data.sessionKey,
      platform: data.platform,
      text: data.text,
      role: 'agent',
      timestamp: Date.now(),
    });
    log.info(`[DIAG] Agent reply sent to ${data.platform}/${data.chatId}`);
  } catch (err) {
    log.error(`[DIAG] Failed to send agent reply: ${(err as Error).message}`);
  }
}

/** 初始化 platform ↔ agent-bridge 通信 */
export function initAgentBridgeForwarding(): void {
  const agentChannel = enhancedMessageBus.getChannel('agent');
  if (!agentChannel) return;

  // 监听 agent-bridge 的平台回复（幂等：重复调用只覆盖 handler）
  agentChannel.handle('platform:reply', handleAgentBridgeReply);
  log.info('Platform ↔ Agent-bridge forwarding initialized');
}

/** 获取或创建 PlatformRouter 单例 */
async function getPlatformRouter(): Promise<any> {
  if (!platformRouter) {
    const { PlatformRouter } = await import('../../../src/platform/PlatformRouter.js');

    // 尝试获取数据库（可选，失败不影响 session 持久化）
    let db: any = undefined;
    try {
      const { getMemoryManager } = await import('../../../src/core/memory/globals.js');
      const mm = getMemoryManager();
      db = mm ? (mm as any).db : undefined;
    } catch {
      // getMemoryManager 可能尚未就绪，正常降级
    }

    const { getAuthState } = await import('../config/auth.js');
    const { getUserPlatformDir } = await import('../../../src/core/config/PathManager.js');
    const uid = getAuthState().user?.userId || 'default';
    const dataDir = getUserPlatformDir(uid);

    platformRouter = new PlatformRouter(db, dataDir);
    log.info(`PlatformRouter initialized for user: ${uid}`);

    // 自动恢复已保存的平台连接
    await restorePlatformConnections(platformRouter, dataDir);
  }
  return platformRouter;
}

/** 启动时恢复已保存的平台连接（token/credential 持久化 → adapter 自动重建） */
async function restorePlatformConnections(router: any, dataDir: string): Promise<void> {
  const { existsSync, readFileSync } = await import('fs');

  // WeChat token 恢复
  const wechatTokenPath = `${dataDir}/wechat-token.json`;
  if (existsSync(wechatTokenPath)) {
    try {
      const raw = readFileSync(wechatTokenPath, 'utf-8');
      const tokenInfo = JSON.parse(raw);
      if (tokenInfo.token && tokenInfo.baseUrl) {
        const { WechatAdapter } = await import('../../../src/platform/adapters/WechatAdapter.js');
        const config = { token_path: wechatTokenPath, base_url: tokenInfo.baseUrl, poll_interval_ms: 35000 };
        const adapter = new WechatAdapter(config, router.credentials);
        adapter.setToken(tokenInfo);
        router.registerAdapter(adapter);
        ensureMessageHandler(router);
        await adapter.start();
        log.info(`WeChat connection restored (uin: ${tokenInfo.uin || 'unknown'})`);
      }
    } catch (err) {
      log.warn(`Failed to restore WeChat connection: ${(err as Error).message}`);
    }
  }
}

/** 获取或创建 WebhookServer 单例 */
async function getWebhookServer(): Promise<any> {
  if (!webhookServer) {
    const { WebhookServer } = await import('../../../src/platform/http/WebhookServer.js');
    webhookServer = new WebhookServer(0); // auto-assign port
    log.info('WebhookServer created');
  }
  return webhookServer;
}

// ─── 向所有渲染进程广播事件 ─────────────────────────────────

function broadcastToAll(event: string, data: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, data);
    }
  }
}

function ensureMessageHandler(router: any): void {
  if (messageHandlerRegistered) return;
  router.registerMessageHandler((sessionKey: string, msg: any) => {
    log.info(`Platform message received: sessionKey=${sessionKey}, platform=${msg.platform}, text=${(msg.text || '').slice(0, 50)}`);

    broadcastToAll('platform:message-received', {
      id: msg.id,
      sessionKey,
      platform: msg.platform,
      text: msg.text,
      role: 'user',
      timestamp: Date.now(),
      userName: msg.userName,
    });
    // 携带完整 session 数据，确保新会话可在侧边栏自动创建
    broadcastToAll('platform:session-updated', {
      sessionKey,
      platform: msg.platform,
      chatId: msg.chatId,
      userId: msg.userId,
      userName: msg.userName,
      status: 'online',
    });
    forwardToAgentBridge({ ...msg, sessionKey });
  });
  messageHandlerRegistered = true;
}

// ─── IPC 注册 ──────────────────────────────────────────────

export function registerPlatformIpcHandlers(): void {
  // ── 平台启用 ─────────────────────────────────────────────
  ipcMain.handle('platform:enable', async (_event, data: {
    platform: string;
    config: Record<string, any>;
  }) => {
    try {
      const router = await getPlatformRouter();
      router.configure({ [data.platform]: data.config });

      // 根据平台类型创建 Adapter
      await createAndRegisterAdapter(router, data.platform, data.config);

      // 预注册会话，确保侧边栏立即可见
      const fallbackId = data.config.app_id || data.config.corp_id || data.config.client_id || data.platform;
      router.registerSession(data.platform, fallbackId);

      // 注册消息转发到 UI + agent-bridge（仅首次）
      ensureMessageHandler(router);

      await router.start();
      platformReady = true;

      // 启动 WebhookServer（如未启动）
      const whServer = await getWebhookServer();
      if (!whServer.getPort()) {
        const port = await whServer.start();
        log.info(`WebhookServer listening on port ${port}`);
      }

      return { success: true, sessions: router.listSessions() };
    } catch (err) {
      log.error(`Failed to enable platform ${data.platform}: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 平台停用 ─────────────────────────────────────────────
  ipcMain.handle('platform:disable', async (_event, platform: string) => {
    try {
      if (platformRouter) {
        await platformRouter.disablePlatform(platform);
        platformRouter.removeAdapter(platform);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 平台状态查询 ─────────────────────────────────────────
  ipcMain.handle('platform:status', async () => {
    try {
      const router = await getPlatformRouter();
      return {
        success: true,
        sessions: router.listSessions(),
        health: router.health(),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 健康检查 ─────────────────────────────────────────────
  ipcMain.handle('platform:health', async () => {
    try {
      if (!platformRouter) return { success: true, health: [] };
      return { success: true, health: platformRouter.health() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 主动回复 ─────────────────────────────────────────────
  ipcMain.handle('platform:send-reply', async (_event, data: {
    sessionKey: string;
    text: string;
  }) => {
    try {
      if (!platformRouter) throw new Error('PlatformRouter not initialized');
      const { parseSessionKey } = await import('../../../src/platform/SessionRouter.js');
      const { platform, chatId } = parseSessionKey(data.sessionKey);
      const adapter = platformRouter.getAdapter(platform);
      if (!adapter) throw new Error(`No adapter for platform: ${platform}`);

      await adapter.sendText({ chatId, text: data.text });

      broadcastToAll('platform:message-sent', {
        sessionKey: data.sessionKey,
        platform,
        text: data.text,
        role: 'agent',
        timestamp: Date.now(),
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 更新 channel_prompt ──────────────────────────────────
  ipcMain.handle('platform:update-prompt', async (_event, data: {
    platform: string;
    chatId: string;
    prompt: string;
  }) => {
    try {
      if (platformRouter) {
        platformRouter.updateChannelPrompt(data.platform, data.chatId, data.prompt);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 微信扫码 ─────────────────────────────────────────────
  // 待确认的微信 Adapter（二维码展示期间暂存）
  let pendingWechatAdapter: any = null;

  ipcMain.handle('platform:wechat-qr', async () => {
    try {
      const { WechatAdapter } = await import('../../../src/platform/adapters/WechatAdapter.js');
      const router = await getPlatformRouter();
      const config = (router as any)._wechatConfig || {};
      pendingWechatAdapter = new WechatAdapter(config, router.credentials);
      const qr = await pendingWechatAdapter.getLoginQR();
      if (!qr.qrcodeUrl) {
        return { success: false, error: '获取二维码失败' };
      }
      return { success: true, qrcodeUrl: qr.qrcodeUrl, qrcodeImgBase64: qr.qrcodeImgBase64 };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('platform:wechat-scan', async (_event, data: {
    qrcodeUrl: string;
  }) => {
    try {
      if (!pendingWechatAdapter) {
        return { success: false, error: '请先获取二维码' };
      }

      // 轮询扫码结果（阻塞直到成功或失败）
      const token = await pendingWechatAdapter.waitForScan(data.qrcodeUrl);

      // 扫码成功，注册 adapter 到 router
      const router = await getPlatformRouter();
      const adapter = pendingWechatAdapter;
      pendingWechatAdapter = null;

      router.registerAdapter(adapter);

      // 预注册会话，确保侧边栏立即可见
      const chatId = token.uin || `bot-${token.token.substring(0, 8)}`;
      router.registerSession('wechat', chatId);

      // 注册消息转发（仅首次）
      ensureMessageHandler(router);

      await router.start();
      platformReady = true;

      // 启动 WebhookServer（如未启动）
      const whServer = await getWebhookServer();
      if (!whServer.getPort()) {
        const port = await whServer.start();
        log.info(`WebhookServer listening on port ${port}`);
      }

      return { success: true, token, sessions: router.listSessions() };
    } catch (err) {
      pendingWechatAdapter = null;
      return { success: false, error: (err as Error).message };
    }
  });

  // 初始化 agent-bridge 转发
  initAgentBridgeForwarding();

  log.info('Platform IPC handlers registered');
}

// ─── Adapter 创建 ──────────────────────────────────────────

async function createAndRegisterAdapter(
  router: any,
  platform: string,
  config: Record<string, any>,
): Promise<void> {
  let adapter: any;

  const credentials = router.credentials;

  switch (platform) {
    case 'wecom': {
      const { WecomAdapter } = await import('../../../src/platform/adapters/WecomAdapter.js');
      adapter = new WecomAdapter(config, credentials);
      break;
    }
    case 'feishu': {
      const { FeishuAdapter } = await import('../../../src/platform/adapters/FeishuAdapter.js');
      adapter = new FeishuAdapter(config, credentials);
      break;
    }
    case 'dingtalk': {
      const { DingTalkAdapter } = await import('../../../src/platform/adapters/DingTalkAdapter.js');
      adapter = new DingTalkAdapter(config, credentials);
      break;
    }
    case 'wechat': {
      const { WechatAdapter } = await import('../../../src/platform/adapters/WechatAdapter.js');
      adapter = new WechatAdapter(config, credentials);
      break;
    }
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }

  router.registerAdapter(adapter);

  // 注册 Webhook 路由
  if (typeof adapter.getWebhookHandler === 'function') {
    const wh = adapter.getWebhookHandler();
    const ws = await getWebhookServer();
    ws.register(wh.path, wh.handler);
    log.info(`Webhook route registered: ${wh.path} for ${platform}`);
  }
}
