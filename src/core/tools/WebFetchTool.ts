// ============================================================
// M6 工具系统 — WebFetchTool 网页抓取
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, getMaxToolOutputLength } from '@/core/utils/truncation';
import { getToolTimeouts } from '@/core/config/RuntimeConfig';

/** 默认超时 (ms) */
const DEFAULT_FETCH_TIMEOUT = 30_000;

/** 最大抓取内容大小 (bytes) */
const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 网页抓取工具
 *
 * 抓取 URL 内容，将 HTML 转换为 Markdown 以便 LLM 阅读。
 */
export class WebFetchTool extends BaseTool {
  readonly name = 'web_fetch';
  readonly description = '抓取网页 URL 内容并转换为 Markdown 格式。支持 HTML 页面、JSON API、纯文本。可配合 prompt 参数提取特定信息。';
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'HTTP/HTTPS URL',
      },
      prompt: {
        type: 'string',
        description: '对抓取内容的提问（可选，仅作为上下文提示返回给 LLM，不会自动摘要）',
      },
      timeout: {
        type: 'number',
        description: `超时时间（毫秒），默认 ${DEFAULT_FETCH_TIMEOUT}`,
        default: DEFAULT_FETCH_TIMEOUT,
      },
    },
    required: ['url'],
  };

  /** 只读工具 */
  override readonly readonly: boolean = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const prompt = input.prompt as string | undefined;
    const timeout = (input.timeout as number | undefined) ?? getToolTimeouts()?.webFetch ?? DEFAULT_FETCH_TIMEOUT;

    // URL 验证
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return this.error(`无效的 URL: ${url}`);
    }

    // 仅支持 HTTP(S)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return this.error(`仅支持 HTTP/HTTPS 协议: ${parsedUrl.protocol}`);
    }

    // SSRF 防护：阻止访问内网地址和云元数据端点
    if (this.isSSRFTarget(parsedUrl.hostname)) {
      return this.error(`安全限制：不允许访问内网地址或云元数据端点: ${parsedUrl.hostname}`);
    }

    // 自动升级 HTTP 到 HTTPS（仅对公网域名）
    if (parsedUrl.protocol === 'http:' && !this.isPrivateAddress(parsedUrl.hostname)) {
      parsedUrl.protocol = 'https:';
    }

    try {
      // DNS rebinding 防护：解析域名后检查实际 IP
      if (!this.isIPLiteral(parsedUrl.hostname)) {
        const dns = await import('node:dns/promises');
        try {
          const { address } = await dns.lookup(parsedUrl.hostname);
          if (this.isSSRFTarget(address)) {
            return this.error(`安全限制：域名 ${parsedUrl.hostname} 解析到内网地址: ${address}`);
          }
        } catch { /* DNS 失败，让 fetch 自然报错 */ }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // 手动处理重定向，验证目标协议安全
      let finalUrl = parsedUrl.toString();
      const MAX_REDIRECTS = 5;
      let redirectCount = 0;
      let response: Response;

      while (true) {
        response = await fetch(finalUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'Xuanji/1.0 (AI Assistant; +https://github.com/shibit/xuanji)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        });

        // 处理重定向（3xx）
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break; // 无 Location header，停止重定向

          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            clearTimeout(timer);
            return this.error(`重定向次数过多 (>${MAX_REDIRECTS}): ${url}`);
          }

          // 验证重定向目标协议
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, finalUrl);
          } catch {
            clearTimeout(timer);
            return this.error(`重定向目标 URL 无效: ${location}`);
          }

          if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
            clearTimeout(timer);
            return this.error(`重定向目标协议不安全: ${redirectUrl.protocol}`);
          }

          // SSRF 防护：检查重定向目标（防止 DNS rebinding 和重定向到内网）
          if (this.isSSRFTarget(redirectUrl.hostname)) {
            clearTimeout(timer);
            return this.error(`安全限制：重定向目标为内网地址: ${redirectUrl.hostname}`);
          }

          // DNS rebinding 防护：对重定向目标域名也做 DNS 解析检查
          if (!this.isIPLiteral(redirectUrl.hostname)) {
            const dns = await import('node:dns/promises');
            try {
              const { address } = await dns.lookup(redirectUrl.hostname);
              if (this.isSSRFTarget(address)) {
                clearTimeout(timer);
                return this.error(`安全限制：重定向目标 ${redirectUrl.hostname} 解析到内网地址: ${address}`);
              }
            } catch { /* DNS 失败，让 fetch 自然报错 */ }
          }

          finalUrl = redirectUrl.toString();
          continue;
        }

        break;
      }

      clearTimeout(timer);

      if (!response.ok) {
        return this.error(`HTTP ${response.status} ${response.statusText}: ${finalUrl}`);
      }

      // 检查内容大小（Content-Length header）
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_SIZE) {
        return this.error(`内容过大 (${contentLength} bytes)，超过 ${MAX_CONTENT_SIZE / 1024 / 1024}MB 限制`);
      }

      const contentType = response.headers.get('content-type') ?? '';

      // 流式读取并限制大小（防止服务器不返回 Content-Length 时内存溢出）
      let body: string;
      const reader = response.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let totalSize = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalSize += value.byteLength;
            if (totalSize > MAX_CONTENT_SIZE) {
              reader.cancel();
              return this.error(`内容过大 (>${MAX_CONTENT_SIZE / 1024 / 1024}MB)，已中止下载`);
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        body = new TextDecoder().decode(
          chunks.length === 1
            ? chunks[0]
            : Buffer.concat(chunks)
        );
      } else {
        // Fallback: response.body 不可用时使用 text()
        body = await response.text();
        if (body.length > MAX_CONTENT_SIZE) {
          return this.error(`内容过大 (>${MAX_CONTENT_SIZE / 1024 / 1024}MB)，超出限制`);
        }
      }

      let content: string;

      if (contentType.includes('application/json')) {
        // JSON: 格式化输出
        try {
          const json = JSON.parse(body);
          content = '```json\n' + JSON.stringify(json, null, 2) + '\n```';
        } catch {
          content = body;
        }
      } else if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        // HTML: 转换为 Markdown
        content = await this.htmlToMarkdown(body);
      } else {
        // 纯文本 / 其他
        content = body;
      }

      // 截断过长内容
      content = middleTruncate(content, getMaxToolOutputLength());

      // 构建输出
      let output = `# ${finalUrl}\n\n`;
      if (prompt) {
        output += `> 提问: ${prompt}\n\n`;
      }
      output += content;

      return this.success(output, {
        url: finalUrl,
        contentType,
        contentLength: body.length,
      });
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return this.error(`请求超时 (${timeout}ms): ${url}`);
        }
        return this.error(`网页抓取失败: ${err.message}`);
      }
      return this.error(`网页抓取失败: ${String(err)}`);
    }
  }

  /**
   * 将 HTML 转换为 Markdown
   */
  private async htmlToMarkdown(html: string): Promise<string> {
    try {
      // 动态加载 turndown（避免启动时阻塞）
      const TurndownService = (await import('turndown')).default;
      const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });

      // 移除 script 和 style 标签
      turndown.remove(['script', 'style', 'noscript', 'iframe']);

      return turndown.turndown(html);
    } catch {
      // turndown 不可用时，降级到简单文本提取
      return this.extractText(html);
    }
  }

  /**
   * 简单 HTML 文本提取（降级方案）
   */
  private extractText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * 判断是否为内网/本地地址（不应升级为 HTTPS）
   */
  private isPrivateAddress(hostname: string): boolean {
    // URL().hostname 对 IPv6 返回 [::1] 格式，需要去除方括号
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');

    if (cleanHostname === 'localhost' || cleanHostname === '127.0.0.1' || cleanHostname === '::1') return true;
    if (cleanHostname === '0.0.0.0') return true;
    if (/^127\./.test(cleanHostname)) return true;
    if (cleanHostname.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanHostname)) return true;
    if (cleanHostname.startsWith('192.168.')) return true;
    if (cleanHostname.endsWith('.local')) return true;
    return false;
  }

  /**
   * 判断 hostname 是否为 IP 字面量（IPv4 或 IPv6）
   */
  private isIPLiteral(hostname: string): boolean {
    // URL().hostname 对 IPv6 返回 [::1] 格式，需要去除方括号
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');
    return /^\d+\.\d+\.\d+\.\d+$/.test(cleanHostname) || cleanHostname.includes(':');
  }

  /**
   * SSRF 防护：判断目标地址是否为内网/本地/云元数据端点
   * 阻止对以下地址的请求：
   * - localhost / 127.0.0.0/8 / ::1
   * - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
   * - 169.254.169.254 (AWS/GCP/Azure 元数据)
   * - fd00::/8 (IPv6 ULA)
   * - .local 域名
   * - 0.0.0.0
   * - IPv4-mapped IPv6 (::ffff:127.0.0.1)
   * - IPv4-compatible IPv6 ([::127.0.0.1])
   * - 八进制 IP (0177.0.0.1)
   * - 十六进制 IP (0x7f000001)
   * - 十进制整数 IP (2130706433)
   */
  private isSSRFTarget(hostname: string): boolean {
    // URL().hostname 对 IPv6 返回 [::1] 格式，需要去除方括号
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');

    if (cleanHostname === 'localhost' || cleanHostname === '127.0.0.1' || cleanHostname === '::1') return true;
    if (cleanHostname === '0.0.0.0') return true;
    // 云元数据端点
    if (cleanHostname === '169.254.169.254') return true;
    if (cleanHostname === 'metadata.google.internal') return true;
    // 127.0.0.0/8
    if (/^127\./.test(cleanHostname)) return true;
    // 10.x.x.x
    if (cleanHostname.startsWith('10.')) return true;
    // 172.16-31.x.x
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanHostname)) return true;
    // 192.168.x.x
    if (cleanHostname.startsWith('192.168.')) return true;
    // .local 域名
    if (cleanHostname.endsWith('.local')) return true;
    // IPv6 ULA (fd00::/8) 和 link-local (fe80::/10)
    if (/^fd[0-9a-f]{2}:/i.test(cleanHostname) || /^fe[89ab][0-9a-f]:/i.test(cleanHostname)) return true;

    // IPv4-mapped IPv6: ::ffff:127.0.0.1 (URL 会规范化为 ::ffff:7f00:1 等格式)
    // ::ffff:7f00:0 ~ ::ffff:7fff:ffff (127.0.0.0/8)
    // ::ffff:a00:0 ~ ::ffff:aff:ffff (10.0.0.0/8)
    // ::ffff:ac10:0 ~ ::ffff:ac1f:ffff (172.16.0.0/12)
    // ::ffff:c0a8:0 ~ ::ffff:c0a8:ffff (192.168.0.0/16)
    if (/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.test(cleanHostname)) {
      const match = cleanHostname.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
      if (match) {
        const high = parseInt(match[1], 16);
        const low = parseInt(match[2], 16);
        const ipNum = (high << 16) | low;
        if (this.isPrivateIPNumber(ipNum)) return true;
      }
    }

    // IPv4-mapped IPv6: 点分十进制格式 ::ffff:127.0.0.1
    const ffmpMatch = cleanHostname.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/i);
    if (ffmpMatch) {
      return this.isSSRFTarget(ffmpMatch[1]);
    }

    // IPv4-compatible IPv6: ::127.0.0.1
    const v4compatMatch = cleanHostname.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (v4compatMatch) {
      return this.isSSRFTarget(v4compatMatch[1]);
    }

    // 八进制 IP: 0177.0.0.1（各段以 0 开头且包含非 0x 前缀的八进制数字）
    const octalMatch = cleanHostname.match(/^(0\d+)\.(0\d*)\.(0\d*)\.(0\d*)$/);
    if (octalMatch) {
      const ipNum = this.parseOctalIP(cleanHostname);
      if (ipNum !== null && this.isPrivateIPNumber(ipNum)) return true;
    }

    // 十六进制 IP: 0x7f000001
    if (/^0x[0-9a-fA-F]+$/.test(cleanHostname)) {
      const ipNum = parseInt(cleanHostname, 16);
      if (!isNaN(ipNum) && this.isPrivateIPNumber(ipNum)) return true;
    }

    // 十进制整数 IP: 2130706433
    if (/^\d+$/.test(cleanHostname) && cleanHostname.length > 3) {
      const ipNum = parseInt(cleanHostname, 10);
      if (!isNaN(ipNum) && this.isPrivateIPNumber(ipNum)) return true;
    }

    return false;
  }

  /**
   * 将 IPv4 地址字符串转换为 32 位数值
   * 支持标准十进制 (127.0.0.1) 和八进制 (0177.0.0.1)
   */
  private parseIPToNumber(hostname: string): number | null {
    const parts = hostname.split('.');
    if (parts.length !== 4) return null;

    let result = 0;
    for (const part of parts) {
      let val: number;
      if (part.startsWith('0') && part.length > 1 && !part.startsWith('0x')) {
        // 八进制
        val = parseInt(part, 8);
      } else {
        val = parseInt(part, 10);
      }
      if (isNaN(val) || val < 0 || val > 255) return null;
      result = (result << 8) | val;
    }
    return result >>> 0; // 确保无符号
  }

  /**
   * 解析八进制 IP 为数值
   */
  private parseOctalIP(hostname: string): number | null {
    return this.parseIPToNumber(hostname);
  }

  /**
   * 判断 32 位 IP 数值是否属于内网/回环/元数据范围
   * - 127.0.0.0/8: 0x7F000000 ~ 0x7FFFFFFF
   * - 10.0.0.0/8: 0x0A000000 ~ 0x0AFFFFFF
   * - 172.16.0.0/12: 0xAC100000 ~ 0xAC1FFFFF
   * - 192.168.0.0/16: 0xC0A80000 ~ 0xC0A8FFFF
   * - 169.254.169.254: 0xA9FEA9FE
   * - 0.0.0.0: 0x00000000
   */
  private isPrivateIPNumber(ip: number): boolean {
    // 0.0.0.0
    if (ip === 0) return true;
    // 127.0.0.0/8
    if ((ip >>> 24) === 127) return true;
    // 10.0.0.0/8
    if ((ip >>> 24) === 10) return true;
    // 172.16.0.0/12
    if ((ip >>> 20) === 0xAC1) return true;
    // 192.168.0.0/16
    if ((ip >>> 16) === 0xC0A8) return true;
    // 169.254.169.254
    if (ip === 0xA9FEA9FE) return true;
    return false;
  }
}
