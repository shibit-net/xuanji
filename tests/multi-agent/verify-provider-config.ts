#!/usr/bin/env tsx
/**
 * 验证 Agent Provider 配置是否正确加载
 */

import { AgentRegistry } from '../../src/core/agent/AgentRegistry';
import { logger } from '../../src/core/logger';

const log = logger.child({ module: 'VerifyProviderConfig' });

async function main() {
  log.info('=== 验证 Agent Provider 配置 ===\n');

  // 1. 初始化 AgentRegistry
  const registry = new AgentRegistry();
  await registry.init();

  // 2. 检查关键 Agent 的 provider 配置
  const agentsToCheck = ['coder', 'plan', 'explore', 'doc-writer', 'general-purpose'];

  for (const agentId of agentsToCheck) {
    const config = registry.get(agentId);

    if (!config) {
      log.error(`❌ Agent 未找到: ${agentId}`);
      continue;
    }

    log.info(`\n📋 Agent: ${config.name} (${config.id})`);
    log.info(`   Source: ${config.metadata?.source}`);
    log.info(`   Model: ${config.model.primary}`);

    // 检查 provider 字段
    const provider = (config as any).provider;
    if (provider) {
      log.info(`   ✅ Provider 配置存在:`);
      log.info(`      - adapter: ${provider.adapter || 'N/A'}`);
      log.info(`      - apiKey: ${provider.apiKey ? '***' + provider.apiKey.slice(-8) : 'N/A'}`);
      log.info(`      - baseURL: ${provider.baseURL || 'N/A'}`);
    } else {
      log.warn(`   ⚠️  Provider 配置缺失（将使用父 Provider）`);
    }
  }

  log.info('\n=== 验证完成 ===');
}

main().catch((err) => {
  log.error('验证失败:', err);
  process.exit(1);
});
