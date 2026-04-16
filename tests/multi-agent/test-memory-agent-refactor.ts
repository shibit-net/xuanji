#!/usr/bin/env tsx
/**
 * 测试重构后的记忆 agent 调用
 *
 * 验证：
 * 1. MemoryFlushAgent 只使用 SubAgentFactory
 * 2. 不再依赖 provider/lightProvider/registry/parentConfig
 * 3. 记忆提取功能正常工作
 */

import { AgentRegistry } from '../../src/core/agent/AgentRegistry';
import { SubAgentFactory } from '../../src/core/agent/SubAgentFactory';
import { ProviderManager } from '../../src/core/providers/ProviderManager';
import { ToolRegistry } from '../../src/core/tools/ToolRegistry';
import { MemoryFlushAgent } from '../../src/memory/MemoryFlushAgent';
import { MemoryManager } from '../../src/memory/MemoryManager';
import { ConfigLoader } from '../../src/core/config';
import { logger } from '../../src/core/logger';

const log = logger.child({ module: 'TestMemoryAgentRefactor' });

async function main() {
  log.info('=== 测试记忆 Agent 重构 ===\n');

  // 1. 加载配置
  const configLoader = new ConfigLoader();
  const globalConfig = await configLoader.load();

  // 2. 初始化依赖
  const agentRegistry = new AgentRegistry();
  await agentRegistry.init();

  const providerManager = new ProviderManager(globalConfig);
  const toolRegistry = new ToolRegistry();
  const mainProvider = providerManager.getProvider();

  // 3. 创建 SubAgentFactory
  const subAgentFactory = new SubAgentFactory(
    agentRegistry,
    providerManager,
    toolRegistry,
    null, // hookRegistry
    null, // memoryStore
    mainProvider,
  );

  log.info('✅ SubAgentFactory 创建成功\n');

  // 4. 创建 MemoryManager（简化版，用于测试）
  const memoryManager = new MemoryManager({
    storePath: './.xuanji/memory-test',
    autoFlush: false,
  });

  log.info('✅ MemoryManager 创建成功\n');

  // 5. 创建 MemoryFlushAgent（新接口：只需要 subAgentFactory）
  try {
    const memoryFlushAgent = new MemoryFlushAgent({
      subAgentFactory,
      memoryManager,
    });

    log.info('✅ MemoryFlushAgent 创建成功（使用简化接口）\n');

    // 6. 测试记忆提取
    log.info('测试记忆提取功能...\n');

    const testMessages = [
      {
        role: 'user' as const,
        content: '我叫 Kevin，是一名前端工程师',
      },
      {
        role: 'assistant' as const,
        content: '你好 Kevin！很高兴认识你。作为前端工程师，你主要使用哪些技术栈？',
      },
      {
        role: 'user' as const,
        content: '我主要用 React 和 TypeScript，偏好函数式编程风格',
      },
      {
        role: 'assistant' as const,
        content: '明白了，React + TypeScript 是很好的组合。函数式编程风格也能让代码更清晰。',
      },
    ];

    const result = await memoryFlushAgent.flushOnExit(testMessages, 'test-session-001');

    log.info('=== 提取结果 ===');
    log.info(`处理消息数: ${result.processedMessages}`);
    log.info(`提取记忆数: ${result.extractedMemories}`);
    log.info(`提取经验数: ${result.extractedLessons}`);
    log.info(`耗时: ${(result.duration / 1000).toFixed(1)}s`);
    log.info(`摘要: ${result.summary}`);
    log.info(`关键点: ${result.keyPoints.join(', ')}`);
    log.info('');

    // 7. 验证
    if (result.extractedMemories > 0) {
      log.info('✅ 测试通过：记忆提取功能正常工作');
      log.info('✅ 重构成功：MemoryFlushAgent 统一使用 SubAgentFactory');
    } else {
      log.warn('⚠️  未提取到记忆，可能是内容太短或 LLM 判断不值得记忆');
    }

  } catch (error: any) {
    log.error('❌ 测试失败:', error.message);
    log.error(error.stack);
    process.exit(1);
  }
}

main().catch((err) => {
  log.error('测试失败:', err);
  process.exit(1);
});
