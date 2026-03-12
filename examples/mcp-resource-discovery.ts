/**
 * ============================================================
 * ResourceDiscovery 使用示例
 * ============================================================
 * 展示如何使用 ResourceDiscovery 访问 MCP Server 提供的资源
 */

import { MCPManager, ResourceDiscovery } from '@/mcp';

async function main() {
  // 1. 初始化 MCP Manager
  const mcpManager = MCPManager.getInstance();
  await mcpManager.initialize({
    enabled: true,
    servers: [
      {
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    ],
  });

  // 2. 创建 ResourceDiscovery
  const resourceDiscovery = new ResourceDiscovery(mcpManager);

  // 3. 列出所有资源
  console.log('=== 列出所有资源 ===');
  const allResources = await resourceDiscovery.listAllResources();
  console.log(`找到 ${allResources.length} 个资源`);
  for (const resource of allResources) {
    console.log(`- ${resource.name} (${resource.uri})`);
    if (resource.description) {
      console.log(`  ${resource.description}`);
    }
  }

  // 4. 列出指定服务器的资源
  console.log('\n=== 列出 filesystem 服务器的资源 ===');
  const fsResources = await resourceDiscovery.listServerResources('filesystem');
  console.log(`找到 ${fsResources.length} 个资源`);

  // 5. 读取资源内容
  if (fsResources.length > 0) {
    const firstResource = fsResources[0];
    console.log(`\n=== 读取资源: ${firstResource.name} ===`);
    try {
      const content = await resourceDiscovery.readResource(firstResource.uri);
      console.log(`URI: ${content.uri}`);
      console.log(`MIME Type: ${content.mimeType}`);
      console.log(`Content: ${content.content.substring(0, 100)}...`);
    } catch (error) {
      console.error(`读取失败: ${error}`);
    }
  }

  // 6. 使用 URI 模板
  console.log('\n=== 使用 URI 模板 ===');
  const templateResources = fsResources.filter((r) => r.uriTemplate);
  if (templateResources.length > 0) {
    const template = templateResources[0].uriTemplate!;
    console.log(`模板: ${template}`);

    const uri = resourceDiscovery.resolveTemplate(template, {
      path: 'example.txt',
    });
    console.log(`解析后: ${uri}`);
  }

  // 7. 缓存统计
  console.log('\n=== 缓存统计 ===');
  const stats = resourceDiscovery.getCacheStats();
  console.log(`缓存大小: ${stats.size}`);
  console.log(`最大缓存: ${stats.maxSize}`);
  console.log(`TTL: ${stats.defaultTTL / 1000}s`);

  // 8. 刷新缓存
  console.log('\n=== 刷新缓存 ===');
  await resourceDiscovery.refreshCache('filesystem');
  console.log('缓存已刷新');

  // 9. 清理
  resourceDiscovery.destroy();
  await mcpManager.shutdown();
}

// 运行示例
main().catch(console.error);
