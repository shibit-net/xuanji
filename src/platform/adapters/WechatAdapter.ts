/**
 * 微信 ClawBot Adapter
 *
 * 扫码认证 + 长轮询 + iLink 私有协议
 * 设计文档：docs/platform-integration-design.md §5.4
 */

import { randomUUID, randomBytes, createHash, createCipheriv } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { PlatformAdapter, PlatformMessage, WechatConfig } from '../types.js';
import type { CredentialManager } from '../auth/CredentialManager.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'WechatAdapter' });

const VERSION = 0x00020404; // 2.4.4

interface WechatToken {
  token: string;
  baseUrl: string;
  uin: string;
  expiresAt?: number;
}

export class WechatAdapter implements PlatformAdapter {
  readonly platform = 'wechat' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private credentials: CredentialManager;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private getUpdatesBuf = '';
  private contextTokens = new Map<string, string>();

  private tokenInfo: WechatToken | null = null;
  /** bot 自身的 user ID，从收到消息的 to_user_id 中获取 */
  private botUserId: string | null = null;

  constructor(private config: WechatConfig, credentials: CredentialManager) {
    this.credentials = credentials;
  }

  // ── 认证 ─────────────────────────────────────────────────

  private loadSavedToken(): WechatToken | null {
    try {
      const tokenPath = this.resolveTokenPath();
      if (existsSync(tokenPath)) {
        const data = JSON.parse(readFileSync(tokenPath, 'utf-8'));
        if (data.token && data.baseUrl) {
          log.info('Loaded saved wechat token');
          return data;
        }
      }
    } catch (err) {
      log.warn(`Failed to load wechat token: ${(err as Error).message}`);
    }
    return null;
  }

  private saveToken(): void {
    if (!this.tokenInfo) return;
    try {
      const tokenPath = this.resolveTokenPath();
      const dir = path.dirname(tokenPath);
      if (!existsSync(dir)) {
        const fs = require('fs');
        fs.mkdirSync(dir, { recursive: true });
      }
      writeFileSync(tokenPath, JSON.stringify(this.tokenInfo, null, 2));
      log.info('Wechat token saved');
    } catch (err) {
      log.error(`Failed to save wechat token: ${(err as Error).message}`);
    }
  }

  private resolveTokenPath(): string {
    const tokenPath = this.config.token_path || '~/.xuanji/platform/wechat-token.json';
    if (tokenPath.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, tokenPath.slice(1));
    }
    return tokenPath;
  }

  /**
   * 获取二维码用于扫码登录。
   * POST https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3
   */
  async getLoginQR(): Promise<{ qrcodeUrl?: string; qrcodeImgBase64?: string }> {
    try {
      const response = await fetch(
        'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3',
        {
          method: 'POST',
          headers: {
            'iLink-App-Id': 'bot',
            'iLink-App-ClientVersion': String(VERSION),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ local_token_list: [] }),
        },
      );

      const data = await response.json() as any;
      if (data.qrcode) {
        log.info('Wechat QR code obtained');
        return { qrcodeUrl: data.qrcode, qrcodeImgBase64: data.qrcode_img_content };
      }
      log.warn('getLoginQR: no qrcode in response');
      return {};
    } catch (err) {
      log.error(`getLoginQR failed: ${(err as Error).message}`);
      return {};
    }
  }

  /**
   * 轮询扫码结果（35s 长轮询）。
   * 用户扫码确认后，获取 bot_token + baseUrl + uin，自动保存 token。
   *
   * @param pollToken - getLoginQR() 返回的 qrcodeUrl
   * @param onVerifyCode - 需要配对码时的回调，返回用户输入的 4 位配对码
   */
  async waitForScan(
    pollToken: string,
    onVerifyCode?: () => Promise<string>,
  ): Promise<WechatToken> {
    let qrcode = pollToken;
    let baseUrl = 'https://ilinkai.weixin.qq.com';
    let verifyCode: string | undefined;
    let refreshCount = 0;
    const MAX_REFRESH = 3;

    while (true) {
      let url = `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
      if (verifyCode) {
        url += `&verify_code=${encodeURIComponent(verifyCode)}`;
      }

      let data: any;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 40000);
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'iLink-App-Id': 'bot',
              'iLink-App-ClientVersion': String(VERSION),
            },
            signal: controller.signal,
          });
          data = await response.json();
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // 长轮询 35s 超时正常，继续轮询
          continue;
        }
        log.warn(`Wechat QR poll error: ${(err as Error).message}, retrying...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      log.info(`Wechat QR status: ${data.status}`);

      switch (data.status) {
        case 'wait':
        case 'scaned':
          // 继续轮询
          break;

        case 'confirmed': {
          const token: WechatToken = {
            token: data.bot_token,
            baseUrl: data.baseurl,
            uin: data.ilink_user_id || data.ilink_bot_id || '',
          };
          this.setToken(token);
          log.info('Wechat QR login confirmed');
          return token;
        }

        case 'scaned_but_redirect':
          if (data.baseurl) {
            baseUrl = data.baseurl;
            log.info(`Wechat IDC redirect to ${baseUrl}`);
          }
          break;

        case 'need_verifycode':
          if (onVerifyCode) {
            verifyCode = await onVerifyCode();
            log.info('Wechat verify code submitted');
          } else {
            throw new Error('Wechat QR requires verify code but no callback provided');
          }
          break;

        case 'verify_code_blocked':
          throw new Error('Wechat verify code blocked, please restart QR login');

        case 'binded_redirect':
          if (data.baseurl) {
            baseUrl = data.baseurl;
            log.info(`Wechat binded redirect to ${baseUrl}`);
          }
          break;

        case 'expired':
          refreshCount++;
          if (refreshCount > MAX_REFRESH) {
            throw new Error('Wechat QR code expired (max refreshes reached)');
          }
          log.info(`Refreshing wechat QR (${refreshCount}/${MAX_REFRESH})`);
          const newQR = await this.getLoginQR();
          if (!newQR.qrcodeUrl) {
            throw new Error('Failed to refresh wechat QR code');
          }
          qrcode = newQR.qrcodeUrl;
          verifyCode = undefined;
          break;

        default:
          log.warn(`Unknown wechat QR status: ${data.status}`);
          break;
      }
    }
  }

  /** 手动设置 token（跳过扫码流程） */
  setToken(token: WechatToken): void {
    this.tokenInfo = token;
    this.saveToken();
    // 同步到 CredentialManager 用于健康检查
    this.credentials.storeToken('wechat', token.token, 7200);
  }

  // ── 生命周期 ─────────────────────────────────────────────

  async start(): Promise<void> {
    // 注册微信 token 刷新回调
    this.credentials.registerRefresher('wechat', async () => {
      // 微信 token 过期后只能重新扫码，无法自动刷新
      throw new Error('Wechat token expired, re-auth required');
    });

    // 尝试加载已保存的 token
    if (!this.tokenInfo) {
      this.tokenInfo = this.loadSavedToken();
      if (this.tokenInfo) {
        this.credentials.storeToken('wechat', this.tokenInfo.token, 7200);
      }
    }

    if (!this.tokenInfo) {
      log.info('No wechat token found, waiting for QR code login');
      return;
    }

    this.running = true;
    this.startPolling();
    log.info('Wechat adapter started, polling...');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.credentials.clearToken('wechat');
    log.info('Wechat adapter stopped');
  }

  async ping(): Promise<void> {
    // 微信没有 ping，getupdates 能正常返回就是健康
    await this.pollOnce();
  }

  // ── 长轮询 ───────────────────────────────────────────────

  private startPolling(): void {
    const interval = this.config.poll_interval_ms || 35000;
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch((err) => {
        log.error(`Wechat poll error: ${err.message}`);
        this.handlePollError(err);
      });
    }, interval);

    // 立即执行第一次轮询
    this.pollOnce().catch(() => {});
  }

  private async pollOnce(): Promise<void> {
    if (!this.tokenInfo) return;

    const { token, baseUrl } = this.tokenInfo;

    const response = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        get_updates_buf: this.getUpdatesBuf,
        base_info: {
          channel_version: '1.0.2',
          bot_agent: 'xuanji/1.0',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`getupdates HTTP ${response.status}: ${response.statusText}`);
    }

    const rawText = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      log.error(`Wechat getupdates non-JSON response: ${rawText.slice(0, 500)}`);
      return;
    }

    if (data.ret != null && data.ret !== 0) {
      if (data.errcode === 'SESSION_EXPIRED') {
        log.warn('Wechat token expired, requiring re-auth');
        this.tokenInfo = null;
        this.stop();
        return;
      }
      log.warn(`Wechat getupdates error: ret=${data.ret} errcode=${data.errcode}`);
      return;
    }

    this.lastActivity = Date.now();
    this.getUpdatesBuf = data.get_updates_buf || '';

    // 处理消息
    for (const raw of data.msgs || []) {
      const msg = this.parseMessage(raw);
      if (msg) {
        this.messageHandler?.(msg);
      }
    }
  }

  // ── 消息解析 ─────────────────────────────────────────────

  private parseMessage(raw: any): PlatformMessage | null {
    if (!raw.from_user_id || !raw.item_list?.length) return null;

    // 保存 bot 自身的 user ID（用于发送回复时的 from_user_id）
    if (raw.to_user_id && !this.botUserId) {
      this.botUserId = raw.to_user_id;
      log.info(`[DIAG] WechatAdapter botUserId set to: ${this.botUserId}`);
    }

    // 提取文本
    let text = '';
    const attachments: any[] = [];

    for (const item of raw.item_list) {
      switch (item.type) {
        case 1: // TEXT
          text += item.text_item?.text || '';
          break;
        case 2: // IMAGE
          attachments.push({
            type: 'image' as const,
            url: item.image_item?.media?.full_url,
          });
          break;
        case 4: // FILE
          attachments.push({
            type: 'file' as const,
            name: item.file_item?.media?.name,
            url: item.file_item?.media?.full_url,
          });
          break;
        case 5: // VOICE
          attachments.push({ type: 'voice' as const });
          break;
      }
    }

    // 保存 context_token
    if (raw.context_token) {
      this.contextTokens.set(raw.from_user_id, raw.context_token);
    }

    return {
      id: raw.message_id,
      platform: 'wechat',
      userId: raw.from_user_id,
      chatId: raw.from_user_id,
      chatType: 'private',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      sessionKey: buildSessionKey({ platform: 'wechat', chatType: 'private', chatId: raw.from_user_id }),
      raw: { ...raw, context_token: raw.context_token },
    };
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    if (!this.tokenInfo) throw new Error('Wechat not authenticated');

    const { token, baseUrl } = this.tokenInfo;
    const contextToken = this.contextTokens.get(options.chatId) || '';
    const clientId = `xuanji-wechat-${randomUUID()}`;

    const body: any = {
      msg: {
        from_user_id: '',
        to_user_id: options.chatId,
        client_id: clientId,
        message_type: 2,
        message_state: 2, // FINISH
        item_list: [{ type: 1, text_item: { text: options.text } }],
      },
      base_info: { channel_version: '2.4.4', bot_agent: 'xuanji/1.0' },
    };

    // context_token 为空时不传该字段（服务器要求要么有效要么不传）
    if (contextToken) {
      body.msg.context_token = contextToken;
    }

    log.info(`[DIAG] sendText: baseUrl=${baseUrl} chatId=${options.chatId} contextToken=${contextToken.slice(0, 20)}... text="${options.text.slice(0, 50)}"`);

    const response = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (data.ret != null && data.ret !== 0) {
      throw new Error(`Wechat sendText failed: HTTP ${response.status}, ret=${data.ret}, body=${JSON.stringify(data).slice(0, 200)}`);
    }

    if (data.msg_id) {
      return data.msg_id;
    }
    // ret 为 0 或 undefined（body={}）均视为成功
    log.info(`[DIAG] sendText succeeded (ret=${data.ret}, msg_id=${data.msg_id || clientId})`);
    return data.msg_id || clientId;
  }

  async sendMarkdown(options: { chatId: string; content: string; replyTo?: string }): Promise<string> {
    // 微信不支持 Markdown，降级为纯文本
    const plainText = this.stripMarkdown(options.content);
    return this.sendText({ chatId: options.chatId, text: plainText, replyTo: options.replyTo });
  }

  async sendImage(options: { chatId: string; imagePath: string; replyTo?: string }): Promise<string> {
    if (!this.tokenInfo) throw new Error('Wechat not authenticated');

    const fileBuffer = readFileSync(options.imagePath);
    const rawSize = fileBuffer.length;
    const rawMd5 = createHash('md5').update(fileBuffer).digest('hex');
    const filekey = randomBytes(16).toString('hex');
    const aesKey = randomBytes(16);

    // 1. PKCS7 padding + AES-128-ECB 加密
    const blockSize = 16;
    const paddingLen = blockSize - (rawSize % blockSize);
    const padded = Buffer.concat([fileBuffer, Buffer.alloc(paddingLen, paddingLen)]);
    const cipher = createCipheriv('aes-128-ecb', aesKey, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    // 2. 获取 CDN 上传 URL
    const getUploadUrlRes = await fetch(
      `${this.tokenInfo.baseUrl}/ilink/bot/getuploadurl`,
      {
        method: 'POST',
        headers: this.buildHeaders(this.tokenInfo.token),
        body: JSON.stringify({
          filekey,
          media_type: 1,
          to_user_id: options.chatId,
          rawsize: rawSize,
          rawfilemd5: rawMd5,
          filesize: encrypted.length,
          no_need_thumb: true,
          aeskey: aesKey.toString('hex'),
        }),
      },
    );

    const uploadData = await getUploadUrlRes.json() as any;
    if (uploadData.ret !== 0) {
      throw new Error(`Wechat getuploadurl failed: ret=${uploadData.ret}`);
    }

    // 3. POST 密文到 CDN
    const cdnRes = await fetch(
      `https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${encodeURIComponent(uploadData.upload_param)}&filekey=${filekey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: encrypted,
      },
    );

    const downloadParam = cdnRes.headers.get('x-encrypted-param');
    if (!downloadParam) {
      throw new Error('Wechat CDN upload missing x-encrypted-param header');
    }

    // 4. 图片 aes_key 编码：base64(raw 16 bytes)
    const aesKeyEncoded = Buffer.from(aesKey).toString('base64');

    // 5. 构建 sendmessage 请求
    const clientId = `xuanji-wechat-${randomUUID()}`;
    const contextToken = this.contextTokens.get(options.chatId) || '';

    const body: any = {
      msg: {
        from_user_id: '',
        to_user_id: options.chatId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{
          type: 2,
          image_item: {
            media: {
              filekey,
              download_param: downloadParam,
              aes_key: aesKeyEncoded,
              full_url: '', // CDN 方式不需要 full_url
            },
          },
        }],
      },
      base_info: { channel_version: '1.0.2', bot_agent: 'xuanji/1.0' },
    };

    body.msg.context_token = contextToken;

    const sendRes = await fetch(
      `${this.tokenInfo.baseUrl}/ilink/bot/sendmessage`,
      {
        method: 'POST',
        headers: this.buildHeaders(this.tokenInfo.token),
        body: JSON.stringify(body),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.ret != null && sendData.ret !== 0) {
      throw new Error(`Wechat sendImage failed: ret=${sendData.ret}`);
    }

    return sendData.msg_id || clientId;
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  // ── 辅助 ─────────────────────────────────────────────────

  private buildHeaders(token: string): Record<string, string> {
    const uin = this.tokenInfo?.uin || this.randomUin();
    return {
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': String(VERSION),
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-WECHAT-UIN': Buffer.from(uin).toString('base64'),
    };
  }

  private randomUin(): string {
    return String(Math.floor(Math.random() * 4294967295));
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/###?\s+/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim();
  }

  private handlePollError(err: Error): void {
    if (err.message.includes('SESSION_EXPIRED')) {
      log.warn('Wechat session expired, stopping poll');
      this.stop();
    }
    // 其他错误继续轮询
  }
}
