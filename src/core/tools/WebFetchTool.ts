// ============================================================
// M6 工具系统 — WebFetchTool 网页抓取
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';
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
      content = middleTruncate(content, MAX_TOOL_OUTPUT_LENGTH);

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
    return this.isSSRFTarget(hostname);
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
   */
  private isSSRFTarget(hostname: string): boolean {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (hostname === '0.0.0.0') return true;
    // 云元数据端点
    if (hostname === '169.254.169.254') return true;
    if (hostname === 'metadata.google.internal') return true;
    // 127.0.0.0/8
    if (/^127\./.test(hostname)) return true;
    // 10.x.x.x
    if (hostname.startsWith('10.')) return true;
    // 172.16-31.x.x
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true;
    // 192.168.x.x
    if (hostname.startsWith('192.168.')) return true;
    // .local 域名
    if (hostname.endsWith('.local')) return true;
    // IPv6 ULA (fd00::/8) 和 link-local (fe80::/10)
    if (/^f[de]/i.test(hostname)) return true;
    return false;
  }
}
