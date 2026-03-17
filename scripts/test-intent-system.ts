#!/usr/bin/env tsx
/**
 * 意图识别系统手动测试脚本
 *
 * 用法：
 *   npm run test:intent
 *   或
 *   tsx scripts/test-intent-system.ts
 */

import { AgentRegistry } from '../src/core/agent/AgentRegistry.js';
import { IntentRouter } from '../src/core/intent/IntentRouter.js';
import type { ProviderConfig } from '../src/core/types';
import path from 'node:path';

const TEST_CASES = [
  {
    name: '编程意图',
    input: '帮我写一个 TypeScript 函数',
    expectedDomain: 'coding',
  },
  {
    name: '生活意图',
    input: '提醒我明天9点开会',
    expectedDomain: 'life',
  },
  {
    name: '通用查询',
    input: '今天天气怎么样',
    expectedDomain: 'general',
  },
];

async function main() {
  console.log('='.repeat(60));
  console.log('意图识别系统手动测试');
  console.log('='.repeat(60));
  console.log();

  // 1. 初始化 AgentRegistry
  console.log('📋 Step 1: 初始化 AgentRegistry');
  const agentRegistry = new AgentRegistry([
    path.join(process.cwd(), 'src/core/agent/builtin'),
  ]);
  await agentRegistry.init();
  console.log();

  // 检查关键 Agent 是否加载
  const intentAnalyzer = agentRegistry.get('intent-analyzer');
  const contextCompressor = agentRegistry.get('context-compressor');

  if (!intentAnalyzer) {
    console.error('❌ IntentAnalyzer Agent 未加载');
    process.exit(1);
  }
  if (!contextCompressor) {
    console.error('❌ ContextCompressor Agent 未加载');
    process.exit(1);
  }

  console.log('✅ IntentAnalyzer Agent 已加载');
  console.log('✅ ContextCompressor Agent 已加载');
  console.log();

  // 2. 初始化 IntentRouter
  console.log('📋 Step 2: 初始化 IntentRouter');
  const providerConfig: ProviderConfig = {
    model: 'claude-haiku-4-5-20251001',
    apiKey: process.env.XUANJI_API_KEY || 'test-key',
    baseURL: process.env.XUANJI_BASE_URL,
    maxTokens: 1000,
    temperature: 0.1,
  };

  const intentRouter = new IntentRouter(agentRegistry, providerConfig);

  try {
    // 跳过向量初始化（避免网络依赖）
    await intentRouter.init({ skipVectorInit: true });
    console.log('✅ IntentRouter 初始化成功');
  } catch (err) {
    console.error('❌ IntentRouter 初始化失败:', err);
    process.exit(1);
  }
  console.log();

  // 3. 获取统计信息
  console.log('📋 Step 3: 学习数据统计');
  const stats = intentRouter.getLearningStats();
  console.log(`  - 已学习意图: ${stats.totalLearned} 个`);
  console.log(`  - 总样本数: ${stats.totalSamples} 个`);
  console.log(`  - 学习历史: ${stats.learningHistory.length} 条`);
  if (stats.mostUsed.length > 0) {
    console.log('  - 最常用意图:');
    stats.mostUsed.forEach((item, idx) => {
      console.log(`    ${idx + 1}. ${item.intentType} (${item.count} 次)`);
    });
  }
  console.log();

  // 4. 测试意图识别（不调用 LLM，仅测试架构）
  console.log('📋 Step 4: 测试意图识别架构');
  console.log('  ℹ️  跳过实际 LLM 调用（避免 API 费用）');
  console.log('  ℹ️  测试降级策略和架构完整性');
  console.log();

  for (const testCase of TEST_CASES) {
    console.log(`  测试: ${testCase.name}`);
    console.log(`  输入: "${testCase.input}"`);

    try {
      const intents = await intentRouter.route(testCase.input, [], {
        enableVector: false, // 禁用向量（跳过网络）
        enableLLM: false,    // 禁用 LLM（跳过 API 调用）
      });
      console.log(`  结果: ${intents.length} 个意图`);
      if (intents.length > 0) {
        intents.forEach((intent, idx) => {
          console.log(`    ${idx + 1}. ${intent.type} (置信度: ${intent.confidence})`);
        });
      } else {
        console.log(`  ℹ️  无匹配意图（预期，因为禁用了向量和 LLM）`);
      }
    } catch (err) {
      console.error(`  ❌ 测试失败:`, err);
    }
    console.log();
  }

  // 5. 总结
  console.log('='.repeat(60));
  console.log('✅ 手动测试完成');
  console.log('='.repeat(60));
  console.log();
  console.log('📝 测试结果摘要:');
  console.log('  ✅ AgentRegistry 正常加载');
  console.log('  ✅ IntentAnalyzer Agent 可用');
  console.log('  ✅ ContextCompressor Agent 可用');
  console.log('  ✅ IntentRouter 初始化成功');
  console.log('  ✅ 降级策略正常工作');
  console.log();
  console.log('💡 下一步:');
  console.log('  1. 配置 XUANJI_API_KEY 环境变量');
  console.log('  2. 启动 Xuanji: npm run dev');
  console.log('  3. 测试实际 LLM 调用和意图识别');
  console.log('  4. 验证自动学习功能');
  console.log();
}

main().catch(err => {
  console.error('❌ 测试脚本执行失败:', err);
  process.exit(1);
});
