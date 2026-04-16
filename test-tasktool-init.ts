#!/usr/bin/env tsx
/**
 * 测试 TaskTool 依赖注入是否正常
 */
import { ChatSession } from './src/core/chat/ChatSession';

async function test() {
  console.log('🧪 Testing TaskTool initialization...\n');

  const session = new ChatSession({});
  await session.init();

  const registry = session.getRegistry();
  const taskTool = registry?.getTool('task');

  if (!taskTool) {
    console.log('❌ TaskTool not found in registry');
    process.exit(1);
  }

  console.log('✅ TaskTool found in registry');
  console.log(`   - Name: ${taskTool.name}`);
  console.log(`   - Has setDependencies: ${typeof (taskTool as any).setDependencies === 'function'}`);

  // 尝试执行（会报错，但能看到是否是依赖问题）
  try {
    const result = await taskTool.execute({ description: 'Test task' });
    console.log('\n✅ TaskTool executed successfully!');
    console.log(`   Result: ${result.result?.substring(0, 100)}`);
  } catch (err: any) {
    console.log('\n❌ TaskTool execution failed:');
    console.log(`   Error: ${err.message}`);

    if (err.message.includes('dependencies not injected')) {
      console.log('\n🐛 CONFIRMED: Dependencies were NOT injected!');
      console.log('   This means initTaskTool() is not being called or not working.');
    } else {
      console.log('\n✅ Dependencies ARE injected (error is something else)');
    }
  }

  process.exit(0);
}

test().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
