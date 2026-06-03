/**
 * 贾维斯架构测试
 *
 * 测试 MainAgent + 8种编程场景
 */

import { SessionFactory } from '../src/session/SessionFactory';

async function testJarvisArchitecture() {
  console.log('🚀 Testing Jarvis Architecture...\n');

  // 创建会话（默认贾维斯模式）
  const factory = new SessionFactory('test-user');
  const session = await factory.create({
    callbacks: {
      onText: (text) => console.log('📝 Output:', text),
      onThinking: (thinking) => console.log('💭 Thinking:', thinking),
      onToolStart: (id, name, input) => console.log(`🔧 Tool Start: ${name}`),
      onToolEnd: (id, name, result, isError) => {
        if (isError) {
          console.log(`❌ Tool Error: ${name}`);
        } else {
          console.log(`✅ Tool End: ${name}`);
        }
      },
      onError: (error) => console.error('❌ Error:', error.message),
    }
  });

  console.log(`✅ Session created (Jarvis Mode)\n`);

  // 测试场景1: 写代码
  console.log('📌 Test 1: write_code scene');
  console.log('Input: "写一个用户登录接口"\n');
  await session.run('写一个用户登录接口');
  console.log('\n---\n');

  // 测试场景2: 调试
  console.log('📌 Test 2: debug scene');
  console.log('Input: "修复登录接口的bug"\n');
  await session.run('修复登录接口的bug');
  console.log('\n---\n');

  // 测试场景3: 代码审查
  console.log('📌 Test 3: review scene');
  console.log('Input: "审查这段代码的质量"\n');
  await session.run('审查这段代码的质量');
  console.log('\n---\n');

  // 测试场景4: 复杂任务
  console.log('📌 Test 4: complex task');
  console.log('Input: "实现一个完整的用户系统，包括注册、登录、权限管理"\n');
  await session.run('实现一个完整的用户系统，包括注册、登录、权限管理');
  console.log('\n---\n');

  console.log('✅ All tests completed!');
}

// 运行测试
if (require.main === module) {
  testJarvisArchitecture().catch(console.error);
}

export { testJarvisArchitecture };
