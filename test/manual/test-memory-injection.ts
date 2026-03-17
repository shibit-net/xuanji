/**
 * 手动测试：记忆融入 AgentLoop
 *
 * 测试 Phase 1 实现：
 * 1. 创建一些测试记忆条目
 * 2. 运行 AgentLoop 并检查是否正确注入记忆
 * 3. 验证 System Prompt 包含相关记忆
 */

import { ChatSession } from '@/core/chat/ChatSession';
import { MemoryManager } from '@/memory/MemoryManager';

async function testMemoryInjection() {
  console.log('🧪 测试记忆融入 AgentLoop\n');

  try {
    // 1. 初始化 ChatSession
    console.log('📦 初始化 ChatSession...');
    const session = new ChatSession();
    await session.init();
    console.log('✅ ChatSession 初始化完成\n');

    // 2. 准备测试记忆（模拟之前的对话）
    console.log('💾 准备测试记忆...');
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // 保存几条测试记忆
    await memoryManager.save({
      sessionId: 'test-session-1',
      startTime: new Date(Date.now() - 86400000).toISOString(), // 1天前
      endTime: new Date(Date.now() - 86400000 + 60000).toISOString(),
      userMessages: ['帮我用 Python 写个快速排序'],
      assistantHighlights: ['已为你实现了 Python 快速排序算法，使用递归方式'],
      toolCalls: [
        {
          name: 'write_file',
          input: { file_path: 'quicksort.py' },
          isError: false,
          resultSummary: 'File created successfully',
        },
      ],
      durationMs: 60000,
      model: 'sonnet-4.6',
    });

    await memoryManager.save({
      sessionId: 'test-session-2',
      startTime: new Date(Date.now() - 3600000).toISOString(), // 1小时前
      endTime: new Date(Date.now() - 3600000 + 30000).toISOString(),
      userMessages: ['我喜欢使用 TypeScript 而不是 JavaScript'],
      assistantHighlights: ['好的，我会优先使用 TypeScript 来编写代码'],
      toolCalls: [],
      durationMs: 30000,
      model: 'sonnet-4.6',
    });

    console.log('✅ 测试记忆已保存\n');

    // 3. 运行对话，触发记忆检索
    console.log('💬 运行对话（应该加载相关记忆）...\n');

    let memoryContextInjected = false;
    let injectedMemoryCount = 0;

    await session.run('帮我写个归并排序算法', {
      onInfo: (message: string) => {
        console.log(`ℹ️  ${message}`);
        if (message.includes('已加载') && message.includes('条相关记忆')) {
          memoryContextInjected = true;
          const match = message.match(/(\d+)\s*条/);
          if (match) {
            injectedMemoryCount = parseInt(match[1]);
          }
        }
      },
      onText: (text: string) => {
        process.stdout.write(text);
      },
      onEnd: () => {
        console.log('\n\n✅ 对话完成\n');
      },
    });

    // 4. 验证结果
    console.log('🔍 验证结果:');
    console.log(`  记忆是否注入: ${memoryContextInjected ? '✅ 是' : '❌ 否'}`);
    console.log(`  注入记忆数量: ${injectedMemoryCount}`);

    if (memoryContextInjected && injectedMemoryCount > 0) {
      console.log('\n🎉 测试成功！记忆系统已正确融入 AgentLoop');
    } else {
      console.log('\n⚠️  测试可能未完全成功，请检查日志');
    }
  } catch (error) {
    console.error('❌ 测试失败:', error);
    throw error;
  }
}

// 运行测试
if (require.main === module) {
  testMemoryInjection().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
