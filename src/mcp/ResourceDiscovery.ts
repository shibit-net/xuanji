/**
 * ============================================================
 * MCP Resource Discovery - 资源发现与读取
 * ============================================================
 * 实现 MCP 资源发现与读取功能，让 Agent 能够访问 MCP Server 提供的资源
 */

import type { MCPManager } from './MCPManager';
import type { MCPResource, ResourceContent } from './types';
import { MemoryCache } from './cache';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'ResourceDiscovery' });

/**
 * 资源缓存配置
 */
const RESOURCE_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const MAX_CACHE_SIZE = 100; // 最多缓存 100 个服务器的资源列表

/**
 * 资源读取结果（简化版，用于返回给调用者）
 */
export interface SimpleResourceContent {
  /** 资源 URI */
  uri: string;
  /** 内容（文本或 Base64 编码的二进制） */
  content: string;
  /** MIME 类型 */
  mimeType?: string;
}

/**
 * 资源发现与读取
 */
export class ResourceDiscovery {
  private mcpManager: MCPManager;
  private cache: MemoryCache<MCPResource[]>;

  constructor(mcpManager: MCPManager) {
    this.mcpManager = mcpManager;
    this.cache = new MemoryCache<MCPResource[]>({
      defaultTTL: RESOURCE_CACHE_TTL,
      maxSize: MAX_CACHE_SIZE,
    });
  }

  /**
   * 列出所有资源（从所有 MCP Server）
   */
  async listAllResources(): Promise<MCPResource[]> {
    const allResources: MCPResource[] = [];
    const runtimes = this.mcpManager.getServerRuntimes();

    for (const runtime of runtimes) {
      if (runtime.state !== 'ready') {
        log.debug(`Skipping server "${runtime.name}" (state: ${runtime.state})`);
        continue;
      }

      try {
        const serverResources = await this.listServerResources(runtime.name);
        allResources.push(...serverResources);
      } catch (error) {
        log.warn(`Failed to list resources from "${runtime.name}":`, error);
        // 继续处理其他服务器
      }
    }

    return allResources;
  }

  /**
   * 列出指定 Server 的资源（带缓存）
   */
  async listServerResources(serverId: string): Promise<MCPResource[]> {
    // 尝试从缓存获取
    const cached = this.cache.get(serverId);
    if (cached) {
      log.debug(`Using cached resources for "${serverId}"`);
      return cached;
    }

    // 从 MCP Client 获取
    const client = this.mcpManager.getClient(serverId);
    if (!client) {
      throw new Error(`MCP server "${serverId}" not found`);
    }

    try {
      const resources = await client.listResources();

      // 存入缓存
      this.cache.set(serverId, resources);

      log.debug(`Listed ${resources.length} resources from "${serverId}"`);
      return resources;
    } catch (error) {
      log.error(`Failed to list resources from "${serverId}":`, error);
      throw error;
    }
  }

  /**
   * 读取资源内容
   * @param uri 资源 URI
   * @returns 资源内容（文本或 Base64 编码的二进制）
   */
  async readResource(uri: string): Promise<SimpleResourceContent> {
    // 查找哪个服务器提供该资源
    const allResources = await this.listAllResources();
    const resource = allResources.find((r) => r.uri === uri);

    if (!resource) {
      throw new Error(`Resource not found: ${uri}`);
    }

    // 从资源的 URI 推断服务器名称（格式：serverName:resourceName）
    const serverId = this.findServerByResource(uri);
    if (!serverId) {
      throw new Error(`Cannot determine server for resource: ${uri}`);
    }

    const client = this.mcpManager.getClient(serverId);
    if (!client) {
      throw new Error(`MCP server "${serverId}" not found`);
    }

    try {
      const contents = await this.readResourceWithRetry(client, uri);

      if (contents.length === 0) {
        throw new Error(`Resource returned empty content: ${uri}`);
      }

      // 取第一个内容项
      const content = contents[0];

      return {
        uri: content.uri,
        content: content.text ?? content.blob ?? '',
        mimeType: content.mimeType,
      };
    } catch (error) {
      log.error(`Failed to read resource "${uri}":`, error);
      throw error;
    }
  }

  /**
   * 读取资源（带重试）
   * @param client MCP Client
   * @param uri 资源 URI
   * @param maxRetries 最大重试次数
   */
  private async readResourceWithRetry(
    client: any,
    uri: string,
    maxRetries = 3
  ): Promise<ResourceContent[]> {
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await client.readResource(uri);
      } catch (error) {
        lastError = error as Error;
        log.warn(`Read resource failed (attempt ${i + 1}/${maxRetries}):`, error);

        // 指数退避
        if (i < maxRetries - 1) {
          await this.sleep(Math.pow(2, i) * 1000);
        }
      }
    }

    throw lastError ?? new Error('Read resource failed after retries');
  }

  /**
   * 刷新资源缓存
   * @param serverId 服务器 ID（可选，不指定则刷新所有）
   */
  async refreshCache(serverId?: string): Promise<void> {
    if (serverId) {
      this.cache.delete(serverId);
      log.debug(`Cleared cache for "${serverId}"`);
    } else {
      this.cache.clear();
      log.debug('Cleared all resource cache');
    }
  }

  /**
   * 解析 URI 模板（简化版 RFC 6570）
   * @param template URI 模板（如 "file:///{path}"）
   * @param variables 变量值（如 { path: "home/user/doc.txt" }）
   * @returns 解析后的 URI
   */
  resolveTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = variables[key];
      if (value === undefined) {
        log.warn(`Missing variable "${key}" in template "${template}"`);
        return '';
      }
      return encodeURIComponent(value);
    });
  }

  /**
   * 从资源 URI 推断服务器名称
   * 策略：遍历所有服务器，查找该资源是否在其列表中
   */
  private findServerByResource(uri: string): string | undefined {
    const runtimes = this.mcpManager.getServerRuntimes();

    for (const runtime of runtimes) {
      if (runtime.state !== 'ready') {
        continue;
      }

      // 检查缓存中是否有该资源
      const cached = this.cache.get(runtime.name);
      if (cached && cached.some((r) => r.uri === uri)) {
        return runtime.name;
      }
    }

    return undefined;
  }

  /**
   * 睡眠指定毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; maxSize: number; defaultTTL: number } {
    return this.cache.stats();
  }

  /**
   * 销毁资源发现器（清理缓存）
   */
  destroy(): void {
    this.cache.destroy();
    log.debug('ResourceDiscovery destroyed');
  }
}
