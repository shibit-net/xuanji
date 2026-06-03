import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebFetchTool } from '@/tools/WebFetchTool';

describe('WebFetchTool', () => {
  let tool: WebFetchTool;

  beforeEach(() => {
    tool = new WebFetchTool();
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('web_fetch');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('url');
    expect(tool.input_schema.properties!.url).toBeDefined();
    expect(tool.input_schema.properties!.prompt).toBeDefined();
    expect(tool.input_schema.properties!.timeout).toBeDefined();
  });

  it('应该是只读工具', () => {
    expect(tool.readonly).toBe(true);
  });

  it('无效 URL 应返回错误', async () => {
    const result = await tool.execute({ url: 'not-a-url' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('无效的 URL');
  });

  it('非 HTTP(S) 协议应返回错误', async () => {
    const result = await tool.execute({ url: 'ftp://example.com/file.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('仅支持 HTTP/HTTPS');
  });

  it('应抓取并转换 HTML 页面', async () => {
    // Mock fetch
    const mockHtml = '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/html']]) as any,
      text: async () => mockHtml,
    }));

    const result = await tool.execute({
      url: 'https://example.com',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('https://example.com');
    // 应包含转换后的 Markdown 内容
    expect(result.content).toMatch(/Hello/);
    expect(result.content).toMatch(/World/);

    vi.unstubAllGlobals();
  });

  it('应处理 JSON 响应', async () => {
    const mockJson = JSON.stringify({ name: 'test', value: 42 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]) as any,
      text: async () => mockJson,
    }));

    const result = await tool.execute({
      url: 'https://api.example.com/data',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('```json');
    expect(result.content).toContain('"name": "test"');
    expect(result.content).toContain('"value": 42');

    vi.unstubAllGlobals();
  });

  it('应处理纯文本响应', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]) as any,
      text: async () => 'Hello, plain text!',
    }));

    const result = await tool.execute({
      url: 'https://example.com/readme.txt',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Hello, plain text!');

    vi.unstubAllGlobals();
  });

  it('HTTP 错误应返回错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Map() as any,
    }));

    const result = await tool.execute({
      url: 'https://example.com/missing',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('HTTP 404');

    vi.unstubAllGlobals();
  });

  it('网络错误应返回错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await tool.execute({
      url: 'https://example.com',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Network error');

    vi.unstubAllGlobals();
  });

  it('prompt 参数应包含在输出中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]) as any,
      text: async () => 'Page content',
    }));

    const result = await tool.execute({
      url: 'https://example.com',
      prompt: '总结这个页面的内容',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('总结这个页面的内容');

    vi.unstubAllGlobals();
  });

  it('超时应返回错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    ));

    const result = await tool.execute({
      url: 'https://example.com',
      timeout: 1000,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('超时');

    vi.unstubAllGlobals();
  });

  describe('SSRF 防护', () => {
    it('应阻止访问 localhost', async () => {
      const result = await tool.execute({ url: 'http://localhost:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 127.0.0.1', async () => {
      const result = await tool.execute({ url: 'http://127.0.0.1:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 127.0.0.0/8 范围', async () => {
      const result = await tool.execute({ url: 'http://127.1.2.3:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 10.x.x.x 内网', async () => {
      const result = await tool.execute({ url: 'http://10.0.0.1' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 172.16-31.x.x 内网', async () => {
      const result = await tool.execute({ url: 'http://172.16.0.1' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');

      const result2 = await tool.execute({ url: 'http://172.31.255.255' });
      expect(result2.isError).toBe(true);
      expect(result2.content).toContain('安全限制');
    });

    it('应阻止访问 192.168.x.x 内网', async () => {
      const result = await tool.execute({ url: 'http://192.168.1.1' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问云元数据端点', async () => {
      const result = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 .local 域名', async () => {
      const result = await tool.execute({ url: 'http://myhost.local' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 IPv6 回环地址', async () => {
      const result = await tool.execute({ url: 'http://[::1]:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 IPv6 ULA (fd00::/8)', async () => {
      const result = await tool.execute({ url: 'http://[fd00::1]:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止访问 IPv6 link-local (fe80::/10)', async () => {
      const result = await tool.execute({ url: 'http://[fe80::1]:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止八进制 IP (0177.0.0.1)', async () => {
      const result = await tool.execute({ url: 'http://0177.0.0.1' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止十六进制 IP (0x7f000001)', async () => {
      const result = await tool.execute({ url: 'http://0x7f000001' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止十进制整数 IP (2130706433)', async () => {
      const result = await tool.execute({ url: 'http://2130706433' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应阻止 IPv4-mapped IPv6 (::ffff:127.0.0.1)', async () => {
      const result = await tool.execute({ url: 'http://[::ffff:127.0.0.1]:8080' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('安全限制');
    });

    it('应允许访问正常公网地址', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com',
        headers: new Map([['content-type', 'text/plain']]) as any,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('Success') })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: vi.fn(),
          }),
        },
      }));

      const result = await tool.execute({ url: 'https://example.com' });
      expect(result.isError).toBe(false);

      vi.unstubAllGlobals();
    });
  });
});
