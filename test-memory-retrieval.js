#!/usr/bin/env node
/**
 * 测试记忆检索 - 验证启动查询能否匹配到用户称呼记忆
 */

import { MemoryManager } from './dist/memory/MemoryManager.js';

async function testMemoryRetrieval() {
  console.log('🧪 测试记忆检索...\n');

  const memoryManager = new MemoryManager();
  await memoryManager.init();

  // 等待向量系统初始化
  await new Promise(resolve => setTimeout(resolve, 2000));

  const queries = [
    '用户信息 个人偏好 朋友 家人 关系 习惯 爱好',  // 旧查询
    '用户称呼 助手名字 昵称 如何称呼 个人偏好 关系 习惯',  // 新查询
  ];

  for (const query of queries) {
    console.log(`\n📝 查询: "${query}"`);
    console.log('─'.repeat(60));

    const memories = await memoryManager.retrieve(query, {
      maxResults: 5,
      memoryScope: 'profile',
      minConfidence: 0.3,
    });

    if (memories.length === 0) {
      console.log('❌ 未找到任何记忆');
    } else {
      console.log(`✅ 找到 ${memories.length} 条记忆:\n`);
      memories.forEach((m, idx) => {
        console.log(`${idx + 1}. [${m.type}] ${m.content}`);
        console.log(`   置信度: ${m.confidence}, 权重: ${m.weight?.toFixed(3) || 'N/A'}`);
      });
    }
  }

  await memoryManager.shutdown();
  console.log('\n✅ 测试完成');
}

testMemoryRetrieval().catch(console.error);
