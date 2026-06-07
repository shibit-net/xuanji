/**
 * Platform IPC 处理器 — 远端平台接入管理
 *
 * 设计文档：docs/platform-integration-design.md §12.5
 */

import { ipcMain, BrowserWindow } from 'electron';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { logger } from '../../../src/infrastructure/logger/index.js';
import { enhancedMessageBus } from './GlobalMessageBus.js';
import { getAgentCwd } from './download.js';

const log = logger.child({ module: 'PlatformIPC' });

// ─── 平台桥接单例（延迟初始化）─────────────────────────────

let platformRouter: any = null;
let platformRouterPromise: Promise<any> | null = null;
let webhookServer: any = null;
let platformReady = false;
let messageHandlerRegistered = false;

/** 将平台消息转发到 agent-bridge 子进程进行自动处理 */
function forwardToAgentBridge(msg: any): void {
  const agentChannel = enhancedMessageBus.getChannel('agent');
  if (agentChannel && agentChannel.isConnected()) {
    // 收集附件中的本地文件路径，agent-bridge 可以注入到 prompt 让 LLM 自行读取
    const localFiles: string[] = [];
    const attachments = (msg.attachments || []) as Array<{ type: string; localPath?: string }>;
    for (const att of attachments) {
      if (att.localPath) {
        localFiles.push(att.localPath);
      }
    }

    // 构建增强的文本：注入群聊上下文和发送者信息
    let enhancedText = '';
    // 先尝试从配置中查找群成员显示名
    let displayName = msg.userName;
    if (!displayName && platformRouter && msg.userId) {
      const routerName = platformRouter.getMemberName?.(msg.chatId, msg.userId);
      if (routerName) displayName = routerName;
    }
    const senderName = displayName || (msg.chatType === 'group' ? `用户(${msg.userId?.slice(-6) || '未知'})` : '你');
    if (msg.chatType === 'group') {
      const groupName = msg.raw?.chatName || msg.chatId || '群聊';
      enhancedText = `[群: ${groupName}]\n[${senderName}]: `;
    } else {
      enhancedText = `[${senderName}]: `;
    }
    enhancedText += msg.text;

    // 清理飞书 SDK 自动生成的 @ 标记（@_user_X），去掉它们
    enhancedText = enhancedText.replace(/@_user_\d+/g, '').trim();

    if (localFiles.length > 0) {
      enhancedText += `\n\n[附件已下载到本地，你可以用文件工具查看：\n${localFiles.map(p => `  file://${p}`).join('\n')}]`;
    }

    agentChannel.send('platform:message', {
      id: msg.id,
      sessionKey: msg.sessionKey,
      platform: msg.platform,
      text: enhancedText,
      userId: msg.userId,
      userName: msg.userName,
      chatId: msg.chatId,
      chatType: msg.chatType,
      channelPrompt: msg.channelPrompt,
      senderType: msg.senderType,
      mentions: msg.mentions,
      replyTo: msg.replyTo,
      attachments: msg.attachments,
    });
  } else {
  }
}

/** 接收 agent-bridge 的回复并发送到远端平台 */
async function handleAgentBridgeReply(data: {
  sessionKey: string;
  platform: string;
  chatId: string;
  text: string;
  replyTo?: string;
  imagePaths?: string[];
  audioPaths?: string[];
  videoPaths?: string[];
  filePaths?: string[];
}): Promise<void> {
  try {
    if (!platformRouter) {
      return;
    }
    const adapter = platformRouter.getAdapter(data.platform);
    if (!adapter) {
      log.error(`handleAgentBridgeReply: No adapter for platform=${data.platform}`);
      return;
    }
    const result = await adapter.sendText({ chatId: data.chatId, text: data.text, replyTo: data.replyTo });

    // 发送 agent 生成的图片
    if (data.imagePaths?.length && typeof adapter.sendImage === 'function') {
      log.info(`handleAgentBridgeReply: Sending ${data.imagePaths.length} images to ${data.platform}/${data.chatId}: ${JSON.stringify(data.imagePaths)}`);
      for (const imagePath of data.imagePaths) {
        try {
          await adapter.sendImage({ chatId: data.chatId, imagePath, replyTo: data.replyTo });
        } catch (imgErr) {
          log.error(`Failed to send image to ${data.platform}/${data.chatId}: ${(imgErr as Error).message}`);
        }
      }
    }

    // 发送 agent 生成的语音（优先走 sendVoice，降级走 sendFile）
    if (data.audioPaths?.length) {
      for (const audioPath of data.audioPaths) {
        try {
          if (typeof adapter.sendVoice === 'function') {
            await adapter.sendVoice({ chatId: data.chatId, voicePath: audioPath, replyTo: undefined });
          } else if (typeof adapter.sendFile === 'function') {
            await adapter.sendFile({ chatId: data.chatId, filePath: audioPath, replyTo: undefined });
          }
        } catch (voiceErr) {
          log.error(`Failed to send voice to ${data.platform}/${data.chatId}: ${(voiceErr as Error).message}`);
        }
      }
    }

    // 发送 agent 生成的视频（走 sendFile）
    if (data.videoPaths?.length && typeof adapter.sendFile === 'function') {
      for (const videoPath of data.videoPaths) {
        try {
          await adapter.sendFile({ chatId: data.chatId, filePath: videoPath, replyTo: undefined });
        } catch (fileErr) {
          log.error(`Failed to send video to ${data.platform}/${data.chatId}: ${(fileErr as Error).message}`);
        }
      }
    }

    // 发送 agent 生成的文件
    if (data.filePaths?.length && typeof adapter.sendFile === 'function') {
      for (const filePath of data.filePaths) {
        try {
          await adapter.sendFile({ chatId: data.chatId, filePath, replyTo: undefined });
        } catch (fileErr) {
          log.error(`Failed to send file to ${data.platform}/${data.chatId}: ${(fileErr as Error).message}`);
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
  } catch (err) {
    log.error(`Failed to send agent reply: ${(err as Error).message}`);
  }
}

/** 飞书连接成功后广播占位会话，侧边栏立即显示。
 *  如果已有真实飞书会话（从持久化恢复），跳过占位广播，避免重启后占位+真实并存。 */
function emitFeishuPlaceholder(router: any): void {
  const adapter = router?.getAdapter?.('feishu');
  if (!adapter?.wsStarted) return;

  // 检查是否已有真实飞书会话（从 sessions.json 恢复），有则不需要占位
  const allSessions: any[] = router.listSessions?.() || [];
  const hasRealFeishuSession = allSessions.some(
    (s: any) => s.platform === 'feishu' && !s.id?.includes('__placeholder__'),
  );
  if (hasRealFeishuSession) return;

  broadcastToAll('platform:session-updated', {
    sessionKey: 'feishu:private:__placeholder__',
    platform: 'feishu',
    chatId: '__feishu_placeholder__',
    userId: '',
    userName: '飞书已连接',
    chatType: 'private',
    status: 'online',
  });
}

/** 初始化 platform ↔ agent-bridge 通信 */
export function initAgentBridgeForwarding(): void {
  const agentChannel = enhancedMessageBus.getChannel('agent');
  if (!agentChannel) return;

  // 监听 agent-bridge 的平台回复（幂等：重复调用只覆盖 handler）
  agentChannel.handle('platform:reply', handleAgentBridgeReply);

  // 监听 agent-bridge 的远端权限确认请求 → 发送文本到平台用户
  agentChannel.handle('platform:permission-request', async (data: {
    id: string;
    platform: string;
    chatId: string;
    text: string;
  }) => {
    try {
      const router = await getPlatformRouter();
      const adapter = router.getAdapter(data.platform);
      if (adapter && typeof adapter.sendText === 'function') {
        await adapter.sendText({ chatId: data.chatId, text: data.text });
        log.info(`Platform permission request sent: platform=${data.platform} chatId=${data.chatId}`);
      } else {
        log.warn(`Platform permission request failed: no adapter for platform=${data.platform}`);
      }
    } catch (err) {
      log.error(`Platform permission request error: ${(err as Error).message}`);
    }
  });

  log.info('Platform ↔ Agent-bridge forwarding initialized');
}

/** 获取或创建 PlatformRouter 单例（防竞态：Promise 锁确保仅初始化一次） */
async function getPlatformRouter(): Promise<any> {
  if (platformRouter) return platformRouter;
  if (!platformRouterPromise) {
    platformRouterPromise = initPlatformRouter();
  }
  return platformRouterPromise;
}

async function initPlatformRouter(): Promise<any> {
  const { PlatformRouter } = await import('../../../src/platform/PlatformRouter.js');

  // 尝试获取数据库（可选，失败不影响 session 持久化）
  let db: any = undefined;
  try {
    const { getMemoryManager } = await import('../../../src/memory/globals.js');
    const mm = getMemoryManager();
    db = mm ? (mm as any).db : undefined;
  } catch {
    // getMemoryManager 可能尚未就绪，正常降级
  }

  const { getAuthState } = await import('../config/auth.js');
  const { getUserPlatformDir } = await import('../../../src/infrastructure/config/PathManager.js');
  const uid = getAuthState().user?.userId || 'default';
  const dataDir = getUserPlatformDir(uid);

  platformRouter = new PlatformRouter(db, dataDir);
  log.info(`PlatformRouter initialized for user: ${uid}`);

  // 自动恢复已保存的平台连接
  await restorePlatformConnections(platformRouter, dataDir);

  // 确保 WeChat 扫码时 token 保存到用户专属目录，与恢复路径一致
  (platformRouter as any)._wechatConfig = { token_path: `${dataDir}/wechat-token.json` };

  return platformRouter;
}

/** 保存平台配置，供重启后自动恢复 */
async function savePlatformConfig(dataDir: string, platform: string, config: Record<string, any>): Promise<void> {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
  const configsPath = `${dataDir}/platform-configs.json`;
  try {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    let configs: Record<string, any> = {};
    if (existsSync(configsPath)) {
      configs = JSON.parse(readFileSync(configsPath, 'utf-8'));
    }
    configs[platform] = { ...config, savedAt: Date.now() };
    writeFileSync(configsPath, JSON.stringify(configs, null, 2));
    log.info(`Platform config saved: ${platform}`);
  } catch (err) {
    log.warn(`Failed to save platform config: ${(err as Error).message}`);
  }
}

/** 从平台配置中删除指定平台条目 */
async function deletePlatformConfig(dataDir: string, platform: string): Promise<void> {
  const { existsSync: ex, readFileSync: rd, writeFileSync: wr } = await import('fs');
  const configsPath = `${dataDir}/platform-configs.json`;
  try {
    if (!ex(configsPath)) return;
    let configs: Record<string, any> = JSON.parse(rd(configsPath, 'utf-8'));
    if (configs[platform]) {
      delete configs[platform];
      wr(configsPath, JSON.stringify(configs, null, 2));
      log.info(`Platform config removed: ${platform}`);
    }
  } catch (err) {
    log.warn(`Failed to delete platform config for ${platform}: ${(err as Error).message}`);
  }
}

/** 清理指定平台所有会话的备注名 */
async function cleanSessionNamesForPlatform(dataDir: string, platform: string): Promise<void> {
  const { existsSync: ex, readFileSync: rd, writeFileSync: wr } = await import('fs');
  const namesPath = `${dataDir}/session-names.json`;
  try {
    if (!ex(namesPath)) return;
    const names: Record<string, string> = JSON.parse(rd(namesPath, 'utf-8'));
    const prefix = `${platform}:`;
    let changed = false;
    for (const key of Object.keys(names)) {
      if (key.startsWith(prefix)) {
        delete names[key];
        changed = true;
      }
    }
    if (changed) {
      wr(namesPath, JSON.stringify(names, null, 2));
      log.info(`Session names cleaned for platform: ${platform}`);
    }
  } catch (err) {
    log.warn(`Failed to clean session names for ${platform}: ${(err as Error).message}`);
  }
}

/** 保存会话备注名到磁盘 */
async function saveSessionNames(dataDir: string, updates: Record<string, string>): Promise<void> {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
  const namesPath = `${dataDir}/session-names.json`;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  let names: Record<string, string> = {};
  if (existsSync(namesPath)) {
    names = JSON.parse(readFileSync(namesPath, 'utf-8'));
  }
  Object.assign(names, updates);
  writeFileSync(namesPath, JSON.stringify(names, null, 2));
}

/** 从磁盘加载会话备注名 */
async function loadSessionNames(dataDir: string): Promise<Record<string, string>> {
  const { existsSync, readFileSync } = await import('fs');
  const namesPath = `${dataDir}/session-names.json`;
  try {
    if (existsSync(namesPath)) {
      return JSON.parse(readFileSync(namesPath, 'utf-8'));
    }
  } catch (err) {
    log.warn(`Failed to load session names: ${(err as Error).message}`);
  }
  return {};
}

/** 启动时恢复已保存的平台连接（token/credential 持久化 → adapter 自动重建） */
async function restorePlatformConnections(router: any, dataDir: string): Promise<void> {
  const { existsSync, readFileSync } = await import('fs');

  // ── 0. 读取平台配置（检查禁用标记）─────────────────────────
  const configsPath = `${dataDir}/platform-configs.json`;
  let savedConfigs: Record<string, any> = {};
  if (existsSync(configsPath)) {
    try {
      savedConfigs = JSON.parse(readFileSync(configsPath, 'utf-8'));
    } catch { /* ignore parse errors */ }
  }

  // ── 1. 恢复 WeChat（长轮询 token）──────────────────────────
  const wechatTokenPath = `${dataDir}/wechat-token.json`;
  // 检查是否已被用户禁用
  if (savedConfigs.wechat?._disabled) {
    log.info('WeChat was disabled by user, skipping restore');
  } else if (existsSync(wechatTokenPath)) {
    try {
      const raw = readFileSync(wechatTokenPath, 'utf-8');
      const tokenInfo = JSON.parse(raw);
      if (tokenInfo.token && tokenInfo.baseUrl) {
        const { WechatAdapter } = await import('../../../src/platform/adapters/WechatAdapter.js');
        const config = { token_path: wechatTokenPath, base_url: tokenInfo.baseUrl, poll_interval_ms: 3000 };
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

  // ── 2. 恢复飞书/钉钉/企微（OAuth + Webhook）───────────────
  if (!existsSync(configsPath)) return;

  try {
    const configs = JSON.parse(readFileSync(configsPath, 'utf-8'));
    let webhookNeeded = false;

    for (const [platform, config] of Object.entries(configs)) {
      if (platform === 'wechat') continue; // WeChat 已在上面处理
      if ((config as any)._disabled) continue; // 已手动禁用，跳过恢复

      try {
        let adapter: any;
        const adapterConfig = config as Record<string, any>;

        switch (platform) {
          case 'feishu': {
            const { FeishuAdapter } = await import('../../../src/platform/adapters/FeishuAdapter.js');
            adapterConfig.workspacePath = getAgentCwd();
            adapter = new FeishuAdapter(adapterConfig, router.credentials);
            break;
          }
          case 'dingtalk': {
            const { DingTalkAdapter } = await import('../../../src/platform/adapters/DingTalkAdapter.js');
            adapter = new DingTalkAdapter(adapterConfig, router.credentials);
            webhookNeeded = true;
            break;
          }
          case 'wecom': {
            const { WecomAdapter } = await import('../../../src/platform/adapters/WecomAdapter.js');
            adapter = new WecomAdapter(adapterConfig, router.credentials);
            webhookNeeded = true;
            break;
          }
          default:
            continue;
        }

        router.registerAdapter(adapter);
        ensureMessageHandler(router);

        // 覆盖 onGroupMembersUpdated：用 IPC 转发到子进程 AgentGateway，而不是依赖 setAgent()
        adapter.onGroupMembersUpdated?.((chatId, members) => {
          const ch = enhancedMessageBus.getChannel('agent');
          if (!ch) return;
          const selfMember = members.find(m => m.isSelf);
          ch.send('platform:group-members-updated', {
            chatId,
            members,
            botDisplayName: selfMember?.name,
            botId: selfMember?.id,
          });
          log.info(`Group members forwarded to agent-bridge: chatId=${chatId} count=${members.length} isSelf=${selfMember?.name || '(none)'}`);
        });

        // 注册 Webhook 路由（WebSocket 模式返回 null，跳过）
        if (typeof adapter.getWebhookHandler === 'function') {
          const wh = adapter.getWebhookHandler();
          if (wh) {
            const ws = await getWebhookServer();
            ws.register(wh.path, wh.handler);
            log.info(`Webhook route restored: ${wh.path} for ${platform}`);
          }
        }

        await adapter.start();
        log.info(`${platform} connection restored`);

        // 飞书连接恢复后广播占位会话
        if (platform === 'feishu') {
          emitFeishuPlaceholder(router);
        }
      } catch (err) {
        log.warn(`Failed to restore ${platform} connection: ${(err as Error).message}`);
      }
    }

    // 有 webhook 平台时自动启动 WebhookServer
    if (webhookNeeded) {
      const ws = await getWebhookServer();
      if (!ws.getPort()) {
        const port = await ws.start();
        log.info(`WebhookServer auto-started on port ${port} during restore`);
      }
    }
  } catch (err) {
    log.warn(`Failed to restore platform configs: ${(err as Error).message}`);
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
      chatName: msg.raw?.chatName,
      chatType: msg.chatType,
      eventType: msg.eventType || 'message',
      readReceipt: msg.readReceipt,
      recallMessageId: msg.recallMessageId,
    });
    // 携带完整 session 数据，确保新会话可在侧边栏自动创建
    broadcastToAll('platform:session-updated', {
      sessionKey,
      platform: msg.platform,
      chatId: msg.chatId,
      userId: msg.userId,
      userName: msg.userName,
      chatName: msg.raw?.chatName,
      chatType: msg.chatType,
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

      // 注册消息转发到 UI + agent-bridge（仅首次）
      ensureMessageHandler(router);

      await router.start();
      platformReady = true;

      // 飞书连接成功后广播占位会话，侧边栏立即显示"飞书已连接"
      emitFeishuPlaceholder(router);

      // 持久化平台配置，确保重启后自动恢复连接
      const { getAuthState } = await import('../config/auth.js');
      const { getUserPlatformDir } = await import('../../../src/infrastructure/config/PathManager.js');
      const uid = getAuthState().user?.userId || 'default';
      const dataDir = getUserPlatformDir(uid);
      await savePlatformConfig(dataDir, data.platform, data.config);

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
      const { getAuthState } = await import('../config/auth.js');
      const { getUserPlatformDir } = await import('../../../src/infrastructure/config/PathManager.js');
      const uid = getAuthState().user?.userId || 'default';
      const dataDir = getUserPlatformDir(uid);

      if (platformRouter) {
        await platformRouter.disablePlatform(platform);
        platformRouter.removeAdapter(platform);
        platformRouter.cleanupPlatformData(platform);
      }

      // 4. 删除平台配置文件（token/credential）
      const tokenFiles: Record<string, string> = {
        wechat: `${dataDir}/wechat-token.json`,
      };
      if (tokenFiles[platform] && existsSync(tokenFiles[platform])) {
        unlinkSync(tokenFiles[platform]);
        log.info(`Deleted token file: ${tokenFiles[platform]}`);
      }

      // 5. 从 platform-configs.json 中移除该平台条目
      await deletePlatformConfig(dataDir, platform);

      // 6. 清理该平台所有会话的备注名
      await cleanSessionNamesForPlatform(dataDir, platform);

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

  // ── 会话备注名持久化 ───────────────────────────────────
  ipcMain.handle('platform:save-session-name', async (_event, data: {
    sessionId: string;
    name: string;
  }) => {
    try {
      const { getAuthState } = await import('../config/auth.js');
      const { getUserPlatformDir } = await import('../../../src/infrastructure/config/PathManager.js');
      const uid = getAuthState().user?.userId || 'default';
      const dataDir = getUserPlatformDir(uid);
      await saveSessionNames(dataDir, { [data.sessionId]: data.name });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('platform:load-session-names', async () => {
    try {
      const { getAuthState } = await import('../config/auth.js');
      const { getUserPlatformDir } = await import('../../../src/infrastructure/config/PathManager.js');
      const uid = getAuthState().user?.userId || 'default';
      const dataDir = getUserPlatformDir(uid);
      const names = await loadSessionNames(dataDir);
      return { success: true, names };
    } catch (err) {
      return { success: false, error: (err as Error).message, names: {} };
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

      // 持久化微信配置，清除 _disabled 标记（防止重启后误跳过恢复）
      const { getAuthState } = await import('../config/auth.js');
      const { getUserPlatformDir } = await import('../../../src/infrastructure/config/PathManager.js');
      const scanUid = getAuthState().user?.userId || 'default';
      const scanDataDir = getUserPlatformDir(scanUid);
      await savePlatformConfig(scanDataDir, 'wechat', { token_path: `${scanDataDir}/wechat-token.json` });

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

  // 后台初始化 PlatformRouter，提前恢复远端连接（不阻塞 IPC 注册）
  getPlatformRouter().catch((err) => {
    log.error(`Failed to init PlatformRouter on startup: ${(err as Error).message}`);
  });

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
      config.workspacePath = getAgentCwd();
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

  // 注册 Webhook 路由（WebSocket 模式返回 null，跳过）
  if (typeof adapter.getWebhookHandler === 'function') {
    const wh = adapter.getWebhookHandler();
    if (wh) {
      const ws = await getWebhookServer();
      ws.register(wh.path, wh.handler);
      log.info(`Webhook route registered: ${wh.path} for ${platform}`);
    }
  }
}