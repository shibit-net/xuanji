#!/usr/bin/env tsx
/**
 * Multi-Agent 工具测试脚本
 * 
 * 演示 delegate、orchestrate、quick_team 三个工具的使用
 */

import { ChatSession } from '@/core/chat/ChatSession';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { AgentConfig } from '@/core/types';

async function main() {
  console.log('🚀 Multi-Agent 工具测试\n');

  // 初始化配置
  const config: AgentConfig = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxIterations: 50,
    maxTokens: 8000,
    temperature: 0.7,
  };

  // 创建 ChatSession
  const providerManager = new ProviderManager();
  const agentRegistry = new AgentRegistry();
  const session = new ChatSession(
    'test-session',
    providerManager,
    agentRegistry,
    config
  );

  await session.init();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 测试 1: delegate（任务委托）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📋 测试 1: delegate（任务委托）');
  console.log('─'.repeat(60));

  const delegateTest = {
    userMessage: '用 explore agent 分析 src/core/tools 目录的结构',
    expectedTool: 'delegate',
    expectedParams: {
      description: '分析 src/core/tools 目录的结构，列出主要工具文件和它们的功能',
      subagent_type: 'explore',
      include_parent_context: false,
    },
  };

  console.log(`用户消息: ${delegateTest.userMessage}`);
  console.log(`期望工具: ${delegateTest.expectedTool}`);
  console.log(`期望参数:`, delegateTest.expectedParams);
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 测试 2: quick_team（快速团队模板）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📋 测试 2: quick_team（快速团队模板）');
  console.log('─'.repeat(60));

  const quickTeamTest = {
    userMessage: '用 code-review team 审查 src/core/tools/DelegateTool.ts',
    expectedTool: 'quick_team',
    expectedParams: {
      template: 'code-review',
      goal: '审查 src/core/tools/DelegateTool.ts 的代码质量、安全性和性能',
      target: 'src/core/tools/DelegateTool.ts',
    },
  };

  console.log(`用户消息: ${quickTeamTest.userMessage}`);
  console.log(`期望工具: ${quickTeamTest.expectedTool}`);
  console.log(`期望参数:`, quickTeamTest.expectedParams);
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 测试 3: orchestrate（自定义团队协作）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📋 测试 3: orchestrate（自定义团队协作）');
  console.log('─'.repeat(60));

  const orchestrateTest = {
    userMessage: '创建一个团队来调研 TypeScript 5.7 的新特性',
    expectedTool: 'orchestrate',
    expectedParams: {
      team_name: 'TypeScript Research Team',
      goal: '调研 TypeScript 5.7 的新特性、改进和最佳实践',
      strategy: 'parallel',
      members: [
        {
          id: 'docs-researcher',
          role: 'explore',
          name: 'Documentation Researcher',
          capabilities: ['official docs', 'changelog analysis', 'API research'],
          system_prompt: 'Search TypeScript official documentation and changelog for version 5.7 features.',
        },
        {
          id: 'code-researcher',
          role: 'explore',
          name: 'Code Example Researcher',
          capabilities: ['code search', 'GitHub exploration', 'usage patterns'],
          system_prompt: 'Find real-world code examples using TypeScript 5.7 features.',
        },
        {
          id: 'migration-expert',
          role: 'plan',
          name: 'Migration Advisor',
          capabilities: ['migration planning', 'breaking changes', 'upgrade path'],
          system_prompt: 'Analyze breaking changes and provide migration guidance from older versions.',
        },
      ],
    },
  };

  console.log(`用户消息: ${orchestrateTest.userMessage}`);
  console.log(`期望工具: ${orchestrateTest.expectedTool}`);
  console.log(`期望参数:`, JSON.stringify(orchestrateTest.expectedParams, null, 2));
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 测试总结
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('✅ 测试用例展示完成！');
  console.log();
  console.log('💡 说明:');
  console.log('   这些工具需要在完整的 ChatSession 环境中运行。');
  console.log('   要实际测试，请使用 CLI:');
  console.log();
  console.log('   $ npm run dev');
  console.log('   > 用 explore agent 分析 src/core 的架构');
  console.log('   > 用 code-review team 审查 src/auth.ts');
  console.log('   > 用 research team 调研 React Server Components');
  console.log();
  console.log('📖 详细文档: docs/multi-agent-tools-demo.md');
  console.log();

  await session.dispose();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 工具对比表
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function printComparisonTable() {
  console.log('\n📊 工具对比:');
  console.log('┌─────────────────┬──────────┬─────────────┬────────────┐');
  console.log('│ 特性            │ delegate │ orchestrate │ quick_team │');
  console.log('├─────────────────┼──────────┼─────────────┼────────────┤');
  console.log('│ 复杂度          │ 简单     │ 复杂        │ 简单       │');
  console.log('│ 适用场景        │ 单子任务 │ 自定义团队  │ 常见模式   │');
  console.log('│ 配置难度        │ 低       │ 高          │ 低         │');
  console.log('│ 灵活性          │ 低       │ 高          │ 中         │');
  console.log('│ 成员数量        │ 1        │ 1-10        │ 3-4 固定   │');
  console.log('│ 协作策略        │ 无       │ 5 种可选    │ 预定义     │');
  console.log('└─────────────────┴──────────┴─────────────┴────────────┘');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 使用场景示例
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function printUseCases() {
  console.log('\n💡 使用场景:');
  console.log();
  console.log('【delegate】- 单任务委托');
  console.log('  ✓ "用 explore agent 分析项目结构"');
  console.log('  ✓ "用 plan agent 设计数据库 schema"');
  console.log('  ✓ "用 coder agent 修复这个 bug"');
  console.log();
  console.log('【quick_team】- 快速团队模板');
  console.log('  ✓ "用 code-review team 审查 PR"');
  console.log('  ✓ "用 research team 调研最佳实践"');
  console.log('  ✓ "用 architecture-debate team 讨论缓存策略"');
  console.log();
  console.log('【orchestrate】- 自定义团队');
  console.log('  ✓ 需要特殊的成员配置');
  console.log('  ✓ 需要自定义协作策略');
  console.log('  ✓ 需要 5+ 个不同角色');
}

// 执行主函数
main()
  .then(() => {
    printComparisonTable();
    printUseCases();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  });
