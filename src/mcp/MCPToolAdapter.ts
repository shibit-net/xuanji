/**
 * ============================================================
 * MCP Tool Adapter - Bridge MCP Tools to BaseTool
 * ============================================================
 * 将 MCP 工具适配为璇玑的 BaseTool 接口
 */

import { BaseTool } from '@/tools/BaseTool';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import { getMCPManager } from './MCPManager';
import type { MCPTool } from './types';

/**
 * MCP 工具适配器
 *
 * 将 MCP 工具包装为 BaseTool，使其能够在璇玑的工具系统中使用
 * 工具名格式: {serverName}:{toolName} (如 market:stock_price)
 */
export class MCPToolAdapter extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JSONSchema;
  readonly readonly: boolean = true; // MCP 工具默认为只读（并行执行）

  private serverName: string;
  private mcpTool: MCPTool;

  constructor(serverName: string, mcpTool: MCPTool) {
    super();
    this.serverName = serverName;
    this.mcpTool = mcpTool;

    // 工具名: serverName:toolName
    this.name = `${serverName}:${mcpTool.name}`;
    this.description = mcpTool.description ?? `MCP tool from ${serverName}`;
    this.input_schema = mcpTool.inputSchema as JSONSchema;
  }

  /**
   * 执行工具
   */
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const manager = getMCPManager();

    try {
      const result = await manager.callTool(this.serverName, this.mcpTool.name, input);

      // ── 文本内容 ──
      const textContents = result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');

      // ── 多模态内容（图片/音频/视频/文件）──
      // MCP 协议支持 image/resource 类型的返回内容（如截图、文件），提取为 contentBlocks
      // Provider 层自动处理 vision / 非 vision 模型兼容：
      //   视觉模型 → 直接传递 base64 图像
      //   纯文本模型 → Provider 自动降级为 [Image: ...] 文本描述
      const LLM_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
      const LLM_AUDIO = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm']);
      const LLM_VIDEO = new Set(['video/mp4', 'video/webm', 'video/ogg']);
      const mediaBlocks = new Array<ToolResult['contentBlocks'] extends Array<infer T> ? T : never>();
      const mediaNotes: string[] = [];

      for (const c of result.content) {
        // ── type: 'image' ──
        if (c.type === 'image' && c.data) {
          const mime = c.mimeType || 'image/png';
          this.classifyMedia('image', mime, c.data, undefined, LLM_IMAGE, LLM_AUDIO, LLM_VIDEO, mediaBlocks, mediaNotes);
          continue;
        }
        // ── type: 'resource'（如 Playwright 截图、文件资源）──
        if (c.type === 'resource') {
          const rc = c as unknown as Record<string, unknown>;
          const rcMime = (rc.mimeType as string) || (rc.mimetype as string) || '';
          const rcUri = (rc.uri as string) || '';
          const rcBlob = (rc.blob as string) || (rc.data as string) || '';
          const rcName = (rc.name as string) || (rc.fileName as string) || rcUri.split('/').pop() || '';
          if (rcBlob && rcMime) {
            this.classifyMedia('image', rcMime, rcBlob, rcName, LLM_IMAGE, LLM_AUDIO, LLM_VIDEO, mediaBlocks, mediaNotes);
          } else if (rcMime.startsWith('image/')) {
            mediaNotes.push(`📷 工具返回了图片资源（${rcMime}），但无 base64 数据`);
          } else if (rcMime.startsWith('audio/')) {
            mediaNotes.push(`🎵 工具返回了音频资源（${rcMime}），但无 base64 数据`);
          } else if (rcMime.startsWith('video/')) {
            mediaNotes.push(`🎬 工具返回了视频资源（${rcMime}），但无 base64 数据`);
          } else if (rcUri || rcName) {
            mediaNotes.push(`📄 工具输出了文件: ${rcName || rcUri}（${rcMime || 'unknown'}）`);
          }
          continue;
        }
      }

      // ── 构建结果内容（纯文本模型也能看到多媒体描述）──
      const parts: string[] = [];
      if (textContents) parts.push(textContents);
      if (mediaNotes.length > 0) parts.push(...mediaNotes);
      const displayContent = parts.join('\n');

      if (result.isError) {
        return this.error(displayContent || 'MCP tool execution failed');
      }

      const toolResult = this.success(displayContent || 'Tool executed successfully', {
        serverName: this.serverName,
        toolName: this.mcpTool.name,
      });

      // 挂载 contentBlocks（Provider / ContextManager 取走注入对话上下文）
      if (mediaBlocks.length > 0) {
        (toolResult as any).contentBlocks = mediaBlocks;
      }

      return toolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`MCP tool execution failed: ${message}`, {
        serverName: this.serverName,
        toolName: this.mcpTool.name,
      });
    }
  }

  // ── 多媒体分类辅助方法 ──
  // eslint-disable-next-line max-params
  private classifyMedia(
    typeHint: string, mime: string, data: string, name: string | undefined,
    IMG: Set<string>, AUD: Set<string>, VID: Set<string>,
    blocks: Array<any>, notes: string[],
  ): void {
    if (IMG.has(mime)) {
      blocks.push({ type: 'image' as const, mimeType: mime, data });
      notes.push(`📷 工具返回了截图（${mime}）`);
    } else if (AUD.has(mime)) {
      blocks.push({ type: 'audio' as const, mimeType: mime, data });
      notes.push(`🎵 工具返回了音频（${mime}）`);
    } else if (VID.has(mime)) {
      blocks.push({ type: 'video' as const, mimeType: mime, data });
      notes.push(`🎬 工具返回了视频（${mime}）`);
    } else if (mime.startsWith('image/')) {
      notes.push(`📷 工具返回了 ${mime} 格式图片，LLM 不支持直接解读（支持: ${[...IMG].join(', ')}）`);
    } else if (mime.startsWith('audio/')) {
      notes.push(`🎵 工具返回了 ${mime} 格式音频，LLM 不支持直接解读`);
    } else if (mime.startsWith('video/')) {
      notes.push(`🎬 工具返回了 ${mime} 格式视频，LLM 不支持直接解读`);
    } else if (name) {
      notes.push(`📄 工具输出了文件: ${name}（${mime}）`);
    } else {
      notes.push(`📄 工具输出了 ${mime} 类型资源`);
    }
  }

  /**
   * 获取服务器名称
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * 获取原始 MCP 工具定义
   */
  getMCPTool(): MCPTool {
    return this.mcpTool;
  }
}
