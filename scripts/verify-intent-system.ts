#!/usr/bin/env tsx
/**
 * 意图识别系统验证脚本
 *
 * 测试流程：
 * 1. 初始化 IntentRouter
 * 2. 测试向量匹配（首次应该未命中）
 * 3. 测试 LLM 分类（使用 lightProvider）
 * 4. 测试自动学习（生成向量）
 * 5. 再次测试向量匹配（应该命中）
 */

import { IntentRouter } from '../src/core/intent/IntentRouter.js';
import { AnthropicProvider } from '../src/core/providers/AnthropicProvider.js';
import type { ProviderConfig } from '../src/core/types';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

async function main() {
  console.log('========================================');
  console.log('意图识别系统验证');
  console.log('========================================\n');

  // 1. 创建 Provider（模拟 lightProvider）
  const providerConfig: ProviderConfig = {
    model: 'claude-haiku-4-5-20251001',
    apiKey: process.env.XUANJI_API_KEY || '',
    baseURL: process.env.XUANJI_BASE_URL,
    maxTokens: 1000,
    temperature: 0.1,
  };

  if (!providerConfig.apiKey) {
    console.error('❌ 未设置 XUANJI_API_KEY 环境变量');
    process.exit(1);
  }

  const provider = new AnthropicProvider();

  // 2. 创建 IntentRouter
  const intentRouter = new IntentRouter(provider, providerConfig);

  // 3. 初始化
  console.log('⏳ 初始化 IntentRouter...\n');
  await intentRouter.init();

  // 4. 模拟可用模块列表
  const availableModules = [
    {
      id: 'code-assistant',
      type: 'skill' as const,
      name: '代码助手',
      description: '帮助编写、审查、重构代码，解决编程问题',
    },
    {
      id: 'life-secretary',
      type: 'skill' as const,
      name: '生活秘书',
      description: '管理日程、提醒事项、记录生活知识',
    },
    {
      id: 'finance-analyst',
      type: 'skill' as const,
      name: '金融分析师',
      description: '分析股票、基金、财务数据',
    },
  ];

  // 5. 测试用例 1: 编程相关（首次，应该走 LLM 分类）
  console.log('========================================');
  console.log('测试 1: 编程相关意图识别');
  console.log('========================================\n');

  const userInput1 = '帮我写一个 TypeScript 函数，计算斐波那契数列';
  console.log(`用户输入: "${userInput1}"\n`);

  const intents1 = await intentRouter.route(userInput1, availableModules);

  if (intents1.length > 0) {
    console.log(`✅ 识别成功:`);
    console.log(`   意图类型: ${intents1[0].type}`);
    console.log(`   置信度: ${intents1[0].confidence.toFixed(2)}`);
    console.log(`   来源: ${intents1[0].source}`);
    console.log(`   模块 ID: ${intents1[0].params?.moduleId}`);
  } else {
    console.log('❌ 未识别到任何意图');
  }

  // 6. 等待学习完成
  console.log('\n⏳ 等待自动学习完成（2秒）...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 7. 测试用例 2: 相同意图（应该走向量匹配）
  console.log('========================================');
  console.log('测试 2: 相同意图再次识别（应该走向量匹配）');
  console.log('========================================\n');

  const userInput2 = '用 JavaScript 写一个快速排序算法';
  console.log(`用户输入: "${userInput2}"\n`);

  const intents2 = await intentRouter.route(userInput2, availableModules);

  if (intents2.length > 0) {
    console.log(`✅ 识别成功:`);
    console.log(`   意图类型: ${intents2[0].type}`);
    console.log(`   置信度: ${intents2[0].confidence.toFixed(2)}`);
    console.log(`   来源: ${intents2[0].source} ${intents2[0].source === 'vector' ? '✓ (向量匹配命中)' : ''}`);
    console.log(`   模块 ID: ${intents2[0].params?.moduleId || intents2[0].type.split('.').slice(1).join('.')}`);
  } else {
    console.log('❌ 未识别到任何意图');
  }

  // 8. 测试用例 3: 生活相关（新意图，走 LLM 分类）
  console.log('\n========================================');
  console.log('测试 3: 生活相关意图识别');
  console.log('========================================\n');

  const userInput3 = '提醒我明天下午3点开会';
  console.log(`用户输入: "${userInput3}"\n`);

  const intents3 = await intentRouter.route(userInput3, availableModules);

  if (intents3.length > 0) {
    console.log(`✅ 识别成功:`);
    console.log(`   意图类型: ${intents3[0].type}`);
    console.log(`   置信度: ${intents3[0].confidence.toFixed(2)}`);
    console.log(`   来源: ${intents3[0].source}`);
    console.log(`   模块 ID: ${intents3[0].params?.moduleId}`);
  } else {
    console.log('❌ 未识别到任何意图');
  }

  // 9. 输出学习统计
  console.log('\n========================================');
  console.log('学习统计');
  console.log('========================================\n');

  const stats = intentRouter.getLearningStats();
  console.log(`总共学习的意图: ${stats.totalLearned}`);
  console.log(`总样本数: ${stats.totalSamples}`);
  console.log(`学习历史: LLM ${stats.learningHistory.fromLLM} 次, 向量 ${stats.learningHistory.fromVector} 次`);

  if (stats.mostUsed.length > 0) {
    console.log('\n最常使用的意图:');
    stats.mostUsed.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.type}: 使用 ${item.usageCount} 次, 样本 ${item.samplesCount} 个`);
    });
  }

  console.log('\n========================================');
  console.log('✅ 验证完成');
  console.log('========================================');
}

main().catch(err => {
  console.error('❌ 验证失败:', err);
  process.exit(1);
});
