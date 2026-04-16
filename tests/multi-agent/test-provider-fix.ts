#!/usr/bin/env tsx
/**
 * 测试 Provider 配置修复后的 agent_team 执行
 *
 * 这个脚本验证 AgentRegistry 是否正确加载了 provider 配置
 */

import { AgentRegistry } from '../../src/core/agent/AgentRegistry';
import { SubAgentFactory } from '../../src/core/agent/SubAgentFactory';
import { ProviderManager } from '../../src/core/providers/ProviderManager';
import { ToolRegistry } from '../../src/core/tools/ToolRegistry';
import { ConfigLoader } from '../../src/core/config';
import { logger } from '../../src/core/logger';

const log = logger.child({ module: 'TestProviderFix' });

async function main() {
  log.info('=== 测试 Provider 配置修复 ===\n');

  // 1. 加载全局配置
  const configLoader = new ConfigLoader();
  const globalConfig = await configLoader.load();

  // 2. 初始化依赖
  const agentRegistry = new AgentRegistry();
  await agentRegistry.init();

  const providerManager = new ProviderManager(globalConfig);
  const toolRegistry = new ToolRegistry();

  // 3. 创建 SubAgentFactory
  const mainProvider = providerManager.getProvider();
  const subAgentFactory = new SubAgentFactory(
    agentRegistry,
    providerManager,
    toolRegistry,
    null, // hookRegistry
    null, // memoryStore
    mainProvider,
  );

  // 4. 测试创建子 agent（验证 provider 配置是否正确使用）
  log.info('测试创建子 agent: coder\n');

  try {
    const instance = await subAgentFactory.createSubAgent('coder', {
      task: '请简单介绍一下你自己的角色和能力（一句话即可）',
      timeout: 30000,
      maxIterations: 3,
    });

    log.info('✅ 子 agent 创建成功');
    log.info(`   Agent ID: ${instance.config.id}`);
    log.info(`   Agent Name: ${instance.config.name}`);
    log.info(`   Model: ${instance.config.model.primary}`);

    // 检查 provider 配置
    const providerConfig = (instance.config as any).provider;
    if (providerConfig) {
      log.info(`   ✅ Provider 配置存在:`);
      log.info(`      - adapter: ${providerConfig.adapter}`);
      log.info(`      - apiKey: ***${providerConfig.apiKey?.slice(-8)}`);
      log.info(`      - baseURL: ${providerConfig.baseURL}`);
    } else {
      log.warn(`   ⚠️  Provider 配置缺失`);
    }

    log.info('\n执行子 agent 任务...\n');

    const result = await subAgentFactory.createAndRun('coder', {
      task: '请简单介绍一下你自己的角色和能力（一句话即可）',
      timeout: 30000,
      maxIterations: 3,
    });

    log.info('=== 执行结果 ===');
    log.info(`成功: ${!result.timedOut}`);
    log.info(`耗时: ${(result.duration / 1000).toFixed(1)}s`);
    log.info(`迭代次数: ${result.iterations}`);
    log.info(`Token 使用: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`);
    log.info(`超时: ${result.timedOut}`);
    log.info('');
    log.info('输出:');
    log.info(result.result);

    // 验证结果
    log.info('\n=== 验证 ===');

    const hasTokens = result.tokensUsed.input > 0 || result.tokensUsed.output > 0;
    const noApiKeyError = !result.result.includes('未配置 API Key') && !result.result.includes('API Key');

    if (hasTokens && noApiKeyError) {
      log.info('✅ 测试通过：子 agent 成功使用了独立的 Provider 配置');
    } else {
      log.error('❌ 测试失败：子 agent 未能正确使用 Provider 配置');
      if (!hasTokens) {
        log.error('   - Token 使用量为 0');
      }
      if (!noApiKeyError) {
        log.error('   - 检测到 API Key 相关错误');
      }
      process.exit(1);
    }

  } catch (error: any) {
    log.error('执行失败:', error.message);
    log.error(error.stack);
    process.exit(1);
  }
}

main().catch((err) => {
  log.error('测试失败:', err);
  process.exit(1);
});
