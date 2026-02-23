// ============================================================
// IM 适配器 — 企业微信机器人 (HTTP 回调模式)
// ============================================================
//
// 企业微信回调配置文档:
// https://developer.work.weixin.qq.com/document/path/91116
//
// 发送应用消息文档:
// https://developer.work.weixin.qq.com/document/10514
// https://developer.work.weixin.qq.com/document/path/90236
//
// 加解密方案说明:
// https://developer.work.weixin.qq.com/document/path/91144
//
// 流程:
// 1. 启动 HTTP 服务监听回调端口
// 2. GET  请求 → URL 验证（签名校验 + AES 解密 echostr → 返回明文）
// 3. POST 请求 → 接收消息（签名校验 + AES 解密 → 提取文本）
// 4. ChatSession.run() → 通过应用消息 API 回复
//
// ⚠️ 重要: 企业微信回调 URL 只支持 80 和 443 端口！
//    如果使用非标准端口，需要通过 Nginx 反向代理转发。
//
// 消息长度限制:
// - text 消息: 最长 2048 字节，超过截断
// - markdown 消息: 最长 2048 字节，仅支持子集语法
// - 超长内容自动分段发送
//
// 加解密使用 Node.js 内置 crypto 模块，无需额外依赖。
//

import type { IMAdapter } from './IMAdapter';
import type { ChatSession } from '@/core/chat/ChatSession';
import { MessageFormatter } from './MessageFormatter';
import * as crypto from 'crypto';
import * as http from 'http';

/** 企业微信单条消息最大字节数 */
const MAX_MSG_BYTES = 2048;
/** 分段发送时预留安全余量（字节） */
const MSG_SAFE_BYTES = 1900;
/** 分段发送的间隔（毫秒），避免触发频率限制 */
const SEGMENT_DELAY_MS = 300;

/**
 * 企业微信配置
 */
interface WecomConfig {
  /** 企业 ID */
  corpId: string;
  /** 应用 Secret（用于获取 access_token） */
  secret: string;
  /** 应用 Agent ID */
  agentId: string;
  /** 回调 Token（用于签名验证） */
  token: string;
  /** 回调 EncodingAESKey（43 位，用于消息加解密） */
  encodingAESKey: string;
  /** 回调监听端口 */
  port: number;
}

/**
 * WecomBot — 企业微信 HTTP 回调机器人
 *
 * 启动一个 HTTP 服务器监听企业微信的回调推送：
 * - GET  /wecom → URL 验证
 * - POST /wecom → 接收用户消息 → ChatSession 处理 → 应用消息 API 回复
 */
export class WecomBot implements IMAdapter {
  readonly name = 'wecom';
  private session: ChatSession | null = null;
  private config: WecomConfig;
  private server: http.Server | null = null;
  private accessToken: string = '';
  private tokenExpiry: number = 0;
  private running = false;
  /** AES 密钥 (从 EncodingAESKey base64 解码) */
  private aesKey: Buffer | null = null;
  /** 日志回调 */
  private logCallback?: (message: string) => void;
  /** 正在处理消息的用户集合（防止重复处理） */
  private processingUsers: Set<string> = new Set();

  constructor(config?: Partial<WecomConfig>) {
    this.config = {
      corpId: config?.corpId ?? process.env.WECOM_CORPID ?? '',
      secret: config?.secret ?? process.env.WECOM_SECRET ?? '',
      agentId: config?.agentId ?? process.env.WECOM_AGENT_ID ?? '',
      token: config?.token ?? process.env.WECOM_TOKEN ?? '',
      encodingAESKey: config?.encodingAESKey ?? process.env.WECOM_ENCODING_AES_KEY ?? '',
      port: config?.port ?? (parseInt(process.env.WECOM_PORT ?? '9880') || 9880),
    };
  }

  setLogger(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  private log(message: string): void {
    console.log(`[企业微信] ${message}`);
    this.logCallback?.(`${message}`);
  }

  private logError(message: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    const full = detail ? `${message}: ${detail}` : message;
    console.error(`[企业微信] ${full}`);
    this.logCallback?.(`❌ ${full}`);
  }

  async start(session: ChatSession): Promise<void> {
    if (!this.config.corpId || !this.config.secret) {
      throw new Error('企业微信配置缺失，请设置 WECOM_CORPID 和 WECOM_SECRET');
    }
    if (!this.config.token || !this.config.encodingAESKey) {
      throw new Error('企业微信回调配置缺失，请设置 WECOM_TOKEN 和 WECOM_ENCODING_AES_KEY');
    }

    this.session = session;
    this.running = true;

    // 解码 AES 密钥: EncodingAESKey(43字符) + "=" → Base64 解码 → 32 字节
    this.aesKey = Buffer.from(this.config.encodingAESKey + '=', 'base64');

    // 获取初始 access_token
    await this.refreshAccessToken();
    this.log('access_token 获取成功');

    // 启动 HTTP 服务器
    await this.startServer();

    this.log(`HTTP 服务已启动 — 监听端口 ${this.config.port}`);

    // 获取公网 IP
    const publicIP = await this.getPublicIP();

    this.log('');
    this.log('═══════════════════════════════════════════');
    this.log('📋 企业微信后台配置信息');
    this.log('═══════════════════════════════════════════');
    this.log('');
    this.log(`  Token:           ${this.config.token}`);
    this.log(`  EncodingAESKey:  ${this.config.encodingAESKey}`);
    this.log('');

    // ⚠ 企业微信回调 URL 只支持 80/443 端口
    // 中国家庭宽带 80/443 端口被运营商封锁
    // 必须通过 Cloudflare Tunnel 或 Nginx 反向代理
    this.log('⚠ 企业微信回调 URL 只支持 80/443 端口');
    this.log('  中国家庭宽带 80/443 端口通常被运营商封锁');
    this.log('');
    this.log('  推荐方案: 使用 Cloudflare Tunnel（免费）');
    this.log(`    1. 安装: brew install cloudflared  (或 apt install cloudflared)`);
    this.log(`    2. 登录: cloudflared tunnel login`);
    this.log(`    3. 创建: cloudflared tunnel create xuanji`);
    this.log(`    4. 运行: cloudflared tunnel --url http://localhost:${this.config.port} run xuanji`);
    this.log('    5. 获得地址如: https://xuanji.你的域名.com');
    this.log('    6. 填入企业微信后台「接收消息服务器 URL」');
    this.log('');

    if (publicIP) {
      this.log('  备选方案（需要公网 80 端口可用）:');
      this.log(`    回调地址: http://${publicIP}/wecom`);
      this.log(`    企业可信 IP: ${publicIP}`);
    }

    this.log('');
    this.log('═══════════════════════════════════════════');
  }

  /**
   * 获取公网 IP 地址
   */
  private async getPublicIP(): Promise<string> {
    // 多个 IP 获取服务，按优先级排列
    const services = [
      { url: 'https://api.ipify.org', timeout: 5000 },
      { url: 'https://ifconfig.me/ip', timeout: 5000 },
      { url: 'https://icanhazip.com', timeout: 5000 },
      { url: 'https://checkip.amazonaws.com', timeout: 5000 },
      { url: 'https://wtfismyip.com/text', timeout: 5000 },
      { url: 'https://ident.me', timeout: 5000 },
    ];

    for (const service of services) {
      try {
        this.log(`正在尝试从 ${service.url} 获取公网 IP...`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), service.timeout);

        const resp = await fetch(service.url, {
          signal: controller.signal,
          // 添加请求头，某些服务需要
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        clearTimeout(timeout);

        if (resp.ok) {
          const ip = (await resp.text()).trim();
          // IP 格式验证：IPv4 地址 (xxx.xxx.xxx.xxx)
          if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
            this.log(`✓ 成功获取公网 IP: ${ip}`);
            return ip;
          } else {
            this.log(`  ✗ ${service.url} 返回格式不正确: ${ip.substring(0, 50)}`);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(`  ✗ ${service.url} 失败: ${errMsg}`);
        // 继续尝试下一个服务
      }
    }

    // 所有服务都失败，返回提示信息
    this.log('⚠ 无法自动获取外网 IP');
    this.log('  原因可能是: 网络连接问题、防火墙阻止、运行环境限制等');
    this.log('  解决方案: 请在回调地址字段中手动输入本地机器的外网 IP');
    return '';
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  // ── HTTP 服务器 ────────────────────────────────────────

  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.log(`收到 ${req.method} ${req.url}`);
        this.handleRequest(req, res).catch((err) => {
          this.logError('处理请求失败', err);
          res.writeHead(500);
          res.end('Internal Server Error');
        });
      });

      this.server.on('error', (err) => {
        this.logError('HTTP 服务器错误', err);
        reject(err);
      });

      this.server.listen(this.config.port, () => {
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // 只处理 /wecom 路径
    if (url.pathname !== '/wecom') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    if (req.method === 'GET') {
      // URL 验证
      this.handleVerify(url, res);
    } else if (req.method === 'POST') {
      // 接收消息
      const body = await this.readBody(req);
      await this.handleCallback(url, body, res);
    } else {
      res.writeHead(405);
      res.end('Method Not Allowed');
    }
  }

  // ── GET: URL 验证 ─────────────────────────────────────

  /**
   * 企业微信验证 URL:
   * GET /wecom?msg_signature=xxx&timestamp=xxx&nonce=xxx&echostr=xxx
   * → 验签 → 解密 echostr → 返回明文
   */
  private handleVerify(url: URL, res: http.ServerResponse): void {
    const msgSignature = url.searchParams.get('msg_signature') ?? '';
    const timestamp = url.searchParams.get('timestamp') ?? '';
    const nonce = url.searchParams.get('nonce') ?? '';
    const echostr = url.searchParams.get('echostr') ?? '';

    // 验证签名
    const expectedSig = this.calcSignature(timestamp, nonce, echostr);
    if (expectedSig !== msgSignature) {
      this.logError('URL 验证签名不匹配');
      res.writeHead(403);
      res.end('Signature mismatch');
      return;
    }

    // 解密 echostr
    const decrypted = this.decrypt(echostr);
    if (!decrypted) {
      this.logError('URL 验证解密失败');
      res.writeHead(500);
      res.end('Decrypt failed');
      return;
    }

    this.log('URL 验证成功 ✓');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(decrypted);
  }

  // ── POST: 接收消息 ────────────────────────────────────

  /**
   * 企业微信推送消息:
   * POST /wecom?msg_signature=xxx&timestamp=xxx&nonce=xxx
   * Body: XML 格式，包含 <Encrypt> 字段
   * → 验签 → 解密 → 提取文本 → ChatSession 处理 → 回复
   */
  private async handleCallback(url: URL, body: string, res: http.ServerResponse): Promise<void> {
    // 先立即返回 200，避免企业微信 5 秒超时重试
    res.writeHead(200);
    res.end('success');

    const msgSignature = url.searchParams.get('msg_signature') ?? '';
    const timestamp = url.searchParams.get('timestamp') ?? '';
    const nonce = url.searchParams.get('nonce') ?? '';

    // 从 XML 提取 <Encrypt> 内容
    const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    if (!encryptMatch) {
      this.logError('无法提取 Encrypt 字段');
      return;
    }
    const encryptedMsg = encryptMatch[1];

    // 验证签名
    const expectedSig = this.calcSignature(timestamp, nonce, encryptedMsg);
    if (expectedSig !== msgSignature) {
      this.logError('消息签名不匹配');
      return;
    }

    // 解密
    const xml = this.decrypt(encryptedMsg);
    if (!xml) {
      this.logError('消息解密失败');
      return;
    }

    this.log('消息解密成功 ✓');

    // 解析消息 XML
    const msgTypeMatch = xml.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/);
    const contentMatch = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
    const fromUserMatch = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
    const eventMatch = xml.match(/<Event><!\[CDATA\[(.*?)\]\]><\/Event>/);

    const msgType = msgTypeMatch?.[1] ?? '';
    const content = contentMatch?.[1]?.trim() ?? '';
    const fromUser = fromUserMatch?.[1] ?? '';

    // 处理事件消息
    if (msgType === 'event') {
      const event = eventMatch?.[1] ?? '';
      this.log(`收到事件: ${event} (来自 ${fromUser})`);
      await this.handleEvent(fromUser, event);
      return;
    }

    // 只处理文本消息
    if (msgType !== 'text' || !content) {
      this.log(`忽略非文本消息 (msgType=${msgType})`);
      return;
    }

    this.log(`收到消息 (${fromUser}): ${content.slice(0, 80)}`);

    // 防止同一用户重复处理（企业微信超时重试）
    if (this.processingUsers.has(fromUser)) {
      this.log(`用户 ${fromUser} 的消息正在处理中，跳过重复请求`);
      return;
    }

    // 处理消息并回复
    await this.processAndReply(fromUser, content);
  }

  /**
   * 处理事件消息（关注、进入应用等）
   */
  private async handleEvent(userId: string, event: string): Promise<void> {
    switch (event) {
      case 'subscribe':
      case 'enter_agent':
        await this.sendTextMessage(userId, '你好！我是 璇玑 AI 助手 ✨\n\n直接发送文字消息即可开始对话。');
        break;
      default:
        this.log(`未处理的事件类型: ${event}`);
    }
  }

  // ── 消息处理 ──────────────────────────────────────────

  /**
   * 处理用户消息并通过应用消息 API 回复
   */
  private async processAndReply(userId: string, text: string): Promise<void> {
    if (!this.session) {
      this.logError('ChatSession 未初始化，无法处理消息');
      return;
    }

    this.processingUsers.add(userId);
    this.log('开始调用 ChatSession 处理...');
    const formatter = new MessageFormatter();

    this.session.on({
      onText: (t) => formatter.appendText(t),
      onToolStart: (id, name, input) => formatter.toolStart(name, input),
      onToolEnd: (id, name, result, isError) => formatter.toolEnd(name, result, isError),
      onError: (err) => formatter.appendText(`\n❌ 错误: ${err.message}`),
    });

    try {
      await this.session.run(text);
      this.log('ChatSession 处理完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      formatter.appendText(`\n❌ 执行失败: ${msg}`);
    } finally {
      this.processingUsers.delete(userId);
    }

    const reply = formatter.format();
    await this.sendReply(userId, reply);
  }

  // ── 消息发送 ──────────────────────────────────────────

  /**
   * 智能发送回复消息
   *
   * 根据内容长度和格式自动选择最佳发送策略:
   * 1. 短消息 (≤2048 字节) → 优先 markdown，失败回退 text
   * 2. 长消息 (>2048 字节) → 按段落分割，逐段发送
   *
   * 参考文档: https://developer.work.weixin.qq.com/document/10514
   */
  private async sendReply(userId: string, content: string): Promise<void> {
    if (!content.trim()) {
      this.log('回复内容为空，跳过发送');
      return;
    }

    const contentBytes = Buffer.byteLength(content, 'utf8');
    this.log(`回复内容: ${contentBytes} 字节, ${content.length} 字符`);

    if (contentBytes <= MAX_MSG_BYTES) {
      // 短消息：直接发送
      const success = await this.sendMarkdownMessage(userId, content);
      if (!success) {
        // markdown 发送失败，回退到 text
        this.log('markdown 发送失败，回退到 text 类型');
        await this.sendTextMessage(userId, content);
      }
    } else {
      // 长消息：分段发送
      this.log(`内容超过 ${MAX_MSG_BYTES} 字节，分段发送...`);
      const segments = this.splitMessage(content);
      this.log(`分为 ${segments.length} 段发送`);

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const header = segments.length > 1 ? `📄 (${i + 1}/${segments.length})\n` : '';
        const text = header + segment;

        const success = await this.sendTextMessage(userId, text);
        if (!success) {
          this.logError(`第 ${i + 1} 段发送失败，停止后续发送`);
          break;
        }

        // 分段之间加延迟，避免触发频率限制
        if (i < segments.length - 1) {
          await this.delay(SEGMENT_DELAY_MS);
        }
      }
    }
  }

  /**
   * 发送 text 类型消息
   *
   * text 消息特点:
   * - 最长 2048 字节，超过截断
   * - 支持换行、链接自动识别
   * - 所有客户端都支持（包括微工作台）
   */
  private async sendTextMessage(userId: string, content: string): Promise<boolean> {
    // 确保不超过字节限制
    const truncated = this.truncateByBytes(content, MAX_MSG_BYTES);

    return this.callSendApi(userId, {
      msgtype: 'text',
      text: {
        content: truncated,
      },
    });
  }

  /**
   * 发送 markdown 类型消息
   *
   * markdown 消息特点:
   * - 最长 2048 字节
   * - 支持标题、加粗、链接、引用、行内代码、字体颜色
   * - 微工作台（原企业号）不支持展示
   *
   * 支持的语法子集:
   * - 标题: # ~ ######
   * - 加粗: **text**
   * - 链接: [text](url)
   * - 引用: > text
   * - 字体颜色: <font color="info|comment|warning">text</font>
   * - 行内代码: `code`
   */
  private async sendMarkdownMessage(userId: string, content: string): Promise<boolean> {
    // 确保不超过字节限制
    const truncated = this.truncateByBytes(content, MAX_MSG_BYTES);

    return this.callSendApi(userId, {
      msgtype: 'markdown',
      markdown: {
        content: truncated,
      },
    });
  }

  /**
   * 调用企业微信消息发送 API
   *
   * API: POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=ACCESS_TOKEN
   * 文档: https://developer.work.weixin.qq.com/document/path/90236
   *
   * @returns true 发送成功, false 发送失败
   */
  private async callSendApi(userId: string, msgBody: Record<string, unknown>): Promise<boolean> {
    const payload = {
      touser: userId,
      agentid: this.config.agentId ? parseInt(this.config.agentId) : undefined,
      // 开启重复消息检查，30分钟内相同内容不重复发送
      enable_duplicate_check: 0,
      duplicate_check_interval: 1800,
      ...msgBody,
    };

    // 最多重试 1 次（token 过期时刷新后重试）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const token = await this.getAccessToken();
        const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;

        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          this.logError(`HTTP 请求失败: ${resp.status} ${resp.statusText}`);
          return false;
        }

        const data = await resp.json() as {
          errcode: number;
          errmsg: string;
          invaliduser?: string;
        };

        if (data.errcode === 0) {
          this.log(`回复发送成功 → ${userId} (${msgBody.msgtype})`);
          return true;
        }

        // access_token 过期 (errcode=40014 或 42001)，刷新后重试
        if ((data.errcode === 40014 || data.errcode === 42001) && attempt === 0) {
          this.log('access_token 已过期，正在刷新...');
          this.accessToken = '';
          this.tokenExpiry = 0;
          continue;
        }

        // 不支持 markdown (errcode=40008 等)
        if (data.errcode === 40008 && msgBody.msgtype === 'markdown') {
          this.log('当前用户客户端不支持 markdown，需要回退到 text');
          return false;
        }

        // invaliduser: 消息发送到了无效用户
        if (data.invaliduser) {
          this.logError(`无效用户: ${data.invaliduser}`);
        }

        this.logError(`发送失败: errcode=${data.errcode} ${data.errmsg}`);
        return false;
      } catch (err) {
        this.logError('发送消息网络错误', err);
        return false;
      }
    }

    return false;
  }

  // ── 消息分段 ──────────────────────────────────────────

  /**
   * 将长文本按字节安全分段
   *
   * 分段策略（按优先级）:
   * 1. 优先在 \n\n (空行) 处分割
   * 2. 其次在 \n (换行) 处分割
   * 3. 最后在空格处分割
   * 4. 兜底按字节强制截断（确保不切断 UTF-8 字符）
   */
  private splitMessage(text: string): string[] {
    const segments: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      const remainingBytes = Buffer.byteLength(remaining, 'utf8');

      // 不超限，直接放入
      if (remainingBytes <= MSG_SAFE_BYTES) {
        segments.push(remaining);
        break;
      }

      // 找最佳切分点
      const cutIndex = this.findCutPoint(remaining, MSG_SAFE_BYTES);
      segments.push(remaining.substring(0, cutIndex).trimEnd());
      remaining = remaining.substring(cutIndex).trimStart();
    }

    return segments.filter(s => s.length > 0);
  }

  /**
   * 在不超过 maxBytes 的范围内找最佳切分点
   */
  private findCutPoint(text: string, maxBytes: number): number {
    // 先找到字节限制对应的大致字符位置
    let charEnd = text.length;
    while (charEnd > 0 && Buffer.byteLength(text.substring(0, charEnd), 'utf8') > maxBytes) {
      // 中文约 3 字节，英文 1 字节，步进按比例估算
      charEnd = Math.max(1, charEnd - Math.ceil((Buffer.byteLength(text.substring(0, charEnd), 'utf8') - maxBytes) / 3));
    }

    // 精确找到字节安全的位置
    while (charEnd > 0 && Buffer.byteLength(text.substring(0, charEnd), 'utf8') > maxBytes) {
      charEnd--;
    }

    if (charEnd <= 0) charEnd = 1;

    // 在 charEnd 范围内，优先在自然断点处切分
    const searchRange = text.substring(0, charEnd);

    // 优先级 1: 空行 (\n\n)
    const doubleNewline = searchRange.lastIndexOf('\n\n');
    if (doubleNewline > charEnd * 0.3) {
      return doubleNewline + 2;
    }

    // 优先级 2: 单换行 (\n)
    const singleNewline = searchRange.lastIndexOf('\n');
    if (singleNewline > charEnd * 0.3) {
      return singleNewline + 1;
    }

    // 优先级 3: 句号/感叹号/问号（中英文）
    const sentenceEnd = Math.max(
      searchRange.lastIndexOf('。'),
      searchRange.lastIndexOf('！'),
      searchRange.lastIndexOf('？'),
      searchRange.lastIndexOf('. '),
      searchRange.lastIndexOf('! '),
      searchRange.lastIndexOf('? '),
    );
    if (sentenceEnd > charEnd * 0.3) {
      return sentenceEnd + 1;
    }

    // 优先级 4: 空格
    const space = searchRange.lastIndexOf(' ');
    if (space > charEnd * 0.3) {
      return space + 1;
    }

    // 兜底: 直接按字节截断
    return charEnd;
  }

  /**
   * 按字节截断字符串，确保不切断 UTF-8 多字节字符
   */
  private truncateByBytes(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
      return text;
    }

    // 从末尾逐字符缩短，直到不超过字节限制
    let end = text.length;
    while (end > 0 && Buffer.byteLength(text.substring(0, end), 'utf8') > maxBytes) {
      end--;
    }

    return text.substring(0, end);
  }

  // ── access_token ──────────────────────────────────────

  /**
   * 获取 access_token（带缓存）
   *
   * access_token 有效期 2 小时，提前 5 分钟刷新
   * API: GET https://qyapi.weixin.qq.com/cgi-bin/gettoken
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }
    return this.refreshAccessToken();
  }

  /**
   * 强制刷新 access_token
   */
  private async refreshAccessToken(): Promise<string> {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.config.corpId)}&corpsecret=${encodeURIComponent(this.config.secret)}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`企业微信 token 获取失败: HTTP ${resp.status}`);
    }

    const data = await resp.json() as {
      errcode: number;
      errmsg: string;
      access_token: string;
      expires_in: number;
    };

    if (data.errcode !== 0) {
      throw new Error(`企业微信 token 错误: errcode=${data.errcode} ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    // 提前 5 分钟过期
    this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    this.log(`access_token 刷新成功 (有效期 ${data.expires_in}s)`);
    return this.accessToken;
  }

  // ── 加解密 ────────────────────────────────────────────

  /**
   * 计算签名: sha1(sort(token, timestamp, nonce, encrypt))
   */
  private calcSignature(timestamp: string, nonce: string, encrypt: string): string {
    const arr = [this.config.token, timestamp, nonce, encrypt].sort();
    return crypto.createHash('sha1').update(arr.join('')).digest('hex');
  }

  /**
   * AES-256-CBC 解密企业微信消息
   *
   * 密钥: Base64Decode(EncodingAESKey + "=") → 32 字节
   * IV:   密钥前 16 字节
   * 明文: random(16B) + msg_len(4B, 网络字节序) + msg + receiveid
   */
  private decrypt(encrypted: string): string | null {
    if (!this.aesKey) return null;

    try {
      const iv = this.aesKey.subarray(0, 16);
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, iv);
      decipher.setAutoPadding(false);

      const buf = Buffer.concat([
        decipher.update(encrypted, 'base64'),
        decipher.final(),
      ]);

      // 去除 PKCS#7 填充
      const padLen = buf[buf.length - 1];
      const unpadded = buf.subarray(0, buf.length - padLen);

      // 解析: random(16B) + msg_len(4B) + msg + receiveid
      const msgLen = unpadded.readUInt32BE(16);
      const msg = unpadded.subarray(20, 20 + msgLen).toString('utf8');

      return msg;
    } catch (err) {
      this.logError('AES 解密失败', err);
      return null;
    }
  }

  // ── 工具方法 ──────────────────────────────────────────

  /**
   * 读取 HTTP 请求 body
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /**
   * 延迟工具
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
