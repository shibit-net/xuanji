#!/usr/bin/env node
// ============================================================
// 测试 lesson_learned 提取功能
// ============================================================

import { MemoryManager } from '../src/memory/MemoryManager.js';
import { MemoryFlushAgent } from '../src/memory/MemoryFlushAgent.js';
import { SubAgentFactory } from '../src/core/agent/SubAgentFactory.js';
import { ToolRegistry } from '../src/core/tools/ToolRegistry.js';
import { ProviderManager } from '../src/core/providers/ProviderManager.js';
import { ConfigManager } from '../src/core/config/ConfigManager.js';

console.log('=== 测试 lesson_learned 提取功能 ===\n');

// 1. 初始化依赖
const configManager = new ConfigManager();
await configManager.init();

const providerManager = new ProviderManager(configManager);
const toolRegistry = new ToolRegistry();
const subAgentFactory = new SubAgentFactory({
  providerManager,
  toolRegistry,
  configManager,
});

const memoryManager = new MemoryManager();
await memoryManager.init();

const flushAgent = new MemoryFlushAgent({
  subAgentFactory,
  memoryManager,
});

// 2. 构造测试对话（包含明确的经验教训）
const testMessages = [
  {
    role: 'user',
    content: '帮我优化这段代码的性能',
  },
  {
    role: 'assistant',
    content: '我先用了全局状态管理，但发现性能很差。后来改用局部状态，性能提升了 10 倍。',
  },
  {
    role: 'user',
    content: '为什么全局状态会慢？',
  },
  {
    role: 'assistant',
    content: '因为全局状态会触发所有组件重新渲染。经验教训：不要用全局状态管理 UI 临时状态，应该用局部状态。这是一个典型的过早优化陷阱。',
  },
];

console.log('测试对话:');
for (const msg of testMessages) {
  console.log(`${msg.role}: ${msg.content.slice(0, 80)}...`);
}

// 3. 执行提取
console.log('\n开始提取记忆...');
const result = await flushAgent.flushOnExit(testMessages, 'test-session-001');

console.log('\n=== 提取结果 ===');
console.log(`处理消息数: ${result.processedMessages}`);
console.log(`提取记忆数: ${result.extractedMemories}`);
console.log(`提取经验教训数: ${result.extractedLessons}`);
console.log(`耗时: ${result.duration}ms`);
console.log(`摘要: ${result.summary}`);
console.log(`关键点: ${result.keyPoints.join(', ')}`);

// 4. 查询数据库验证
console.log('\n=== 数据库验证 ===');
const lessons = memoryManager.getAllEntries().filter(e => e.type === 'lesson_learned');
console.log(`数据库中 lesson_learned 数量: ${lessons.length}`);

if (lessons.length > 0) {
  console.log('\n最新的经验教训:');
  for (const lesson of lessons.slice(-3)) {
    console.log(`- [${lesson.lessonType}] ${lesson.content}`);
    if (lesson.problemDescription) {
      console.log(`  问题: ${lesson.problemDescription}`);
    }
    if (lesson.solution) {
      console.log(`  解决: ${lesson.solution}`);
    }
  }
}

await memoryManager.shutdown();
console.log('\n✓ 测试完成');
