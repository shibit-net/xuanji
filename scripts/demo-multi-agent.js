#!/usr/bin/env node
/**
 * Multi-Agent 工具演示
 * 
 * 展示 delegate、orchestrate、quick_team 三个工具的使用方式
 */

console.log('🚀 Xuanji Multi-Agent 工具演示\n');
console.log('═'.repeat(70));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 测试 1: delegate（任务委托）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n📋 测试 1: delegate（任务委托）');
console.log('─'.repeat(70));
console.log('\n💬 用户输入:');
console.log('   "用 explore agent 分析 src/core/tools 目录的结构"\n');

console.log('🔧 工具调用:');
const delegateCall = {
  tool: 'delegate',
  parameters: {
    description: '分析 src/core/tools 目录的结构，列出主要工具文件和它们的功能',
    subagent_type: 'explore',
    include_parent_context: false,
  },
};
console.log(JSON.stringify(delegateCall, null, 2));

console.log('\n✨ 特点:');
console.log('   • 单个专业 Agent 执行任务');
console.log('   • 隔离环境，不影响主会话');
console.log('   • 支持 explore/plan/coder/general-purpose');
console.log('   • 最多 3 个并发，最大嵌套 3 层');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 测试 2: quick_team（快速团队模板）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n📋 测试 2: quick_team（快速团队模板）');
console.log('─'.repeat(70));
console.log('\n💬 用户输入:');
console.log('   "用 code-review team 审查 src/core/tools/DelegateTool.ts"\n');

console.log('🔧 工具调用:');
const quickTeamCall = {
  tool: 'quick_team',
  parameters: {
    template: 'code-review',
    goal: '审查 src/core/tools/DelegateTool.ts 的代码质量、安全性和性能',
    target: 'src/core/tools/DelegateTool.ts',
  },
};
console.log(JSON.stringify(quickTeamCall, null, 2));

console.log('\n✨ 特点:');
console.log('   • 使用预定义模板，无需配置成员');
console.log('   • 5 种模板：code-review、research、architecture-debate、');
console.log('     data-pipeline、feature-development');
console.log('   • 自动选择最佳协作策略');

console.log('\n🏗️  自动创建的团队:');
console.log('   1. Architecture Reviewer（架构审查）');
console.log('   2. Security Analyst（安全分析）');
console.log('   3. Performance Expert（性能优化）');
console.log('   协作策略: sequential（顺序执行）');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 测试 3: orchestrate（自定义团队协作）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n📋 测试 3: orchestrate（自定义团队协作）');
console.log('─'.repeat(70));
console.log('\n💬 用户输入:');
console.log('   "创建一个团队来调研 TypeScript 5.7 的新特性"\n');

console.log('🔧 工具调用:');
const orchestrateCall = {
  tool: 'orchestrate',
  parameters: {
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
console.log(JSON.stringify(orchestrateCall, null, 2));

console.log('\n✨ 特点:');
console.log('   • 完全自定义成员配置');
console.log('   • 5 种协作策略：sequential、parallel、hierarchical、');
console.log('     debate、pipeline');
console.log('   • 灵活的成员角色和能力定义');
console.log('   • 支持 1-10 个成员');

console.log('\n🏗️  自定义团队:');
console.log('   1. Documentation Researcher（文档研究员）');
console.log('   2. Code Example Researcher（代码示例研究员）');
console.log('   3. Migration Advisor（迁移顾问）');
console.log('   协作策略: parallel（并行执行）');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 工具对比
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n📊 工具对比');
console.log('═'.repeat(70));
console.log('┌─────────────────┬──────────┬─────────────┬────────────┐');
console.log('│ 特性            │ delegate │ orchestrate │ quick_team │');
console.log('├─────────────────┼──────────┼─────────────┼────────────┤');
console.log('│ 复杂度          │ 简单     │ 复杂        │ 简单       │');
console.log('│ 适用场景        │ 单子任务 │ 自定义团队  │ 常见模式   │');
console.log('│ 配置难度        │ 低       │ 高          │ 低         │');
console.log('│ 灵活性          │ 低       │ 高          │ 中         │');
console.log('│ 成员数量        │ 1        │ 1-10        │ 3-4 固定   │');
console.log('│ 协作策略        │ 无       │ 5 种可选    │ 预定义     │');
console.log('│ 学习曲线        │ 平缓     │ 陡峭        │ 平缓       │');
console.log('└─────────────────┴──────────┴─────────────┴────────────┘');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 使用场景示例
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n💡 使用场景示例');
console.log('═'.repeat(70));

console.log('\n【delegate】— 单任务委托');
console.log('  ✓ "用 explore agent 分析项目结构"');
console.log('  ✓ "用 plan agent 设计数据库 schema"');
console.log('  ✓ "用 coder agent 修复登录逻辑的 bug"');
console.log('  ✓ "用 general-purpose agent 整理文档"');

console.log('\n【quick_team】— 快速团队模板');
console.log('  ✓ "用 code-review team 审查 PR #123"');
console.log('  ✓ "用 research team 调研 React Server Components"');
console.log('  ✓ "用 architecture-debate team 讨论缓存策略"');
console.log('  ✓ "用 data-pipeline team 处理日志文件"');
console.log('  ✓ "用 feature-development team 实现 OAuth 登录"');

console.log('\n【orchestrate】— 自定义团队');
console.log('  ✓ 需要特殊的成员配置');
console.log('  ✓ 需要自定义协作策略');
console.log('  ✓ 需要 5+ 个不同角色');
console.log('  ✓ 已有明确的团队结构设计');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 协作策略详解
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n🎯 协作策略详解');
console.log('═'.repeat(70));

console.log('\n1. sequential（顺序执行）');
console.log('   • 成员依次执行，各自独立');
console.log('   • 适用：代码审查（架构 → 安全 → 性能）');
console.log('   • 示例：code-review team');

console.log('\n2. parallel（并行执行）');
console.log('   • 成员同时执行，加速处理');
console.log('   • 适用：多源调研（文档 + 代码 + 社区）');
console.log('   • 示例：research team');

console.log('\n3. hierarchical（分层执行）');
console.log('   • 有主 Agent 协调其他 Agent（基于 priority）');
console.log('   • 适用：功能开发（技术负责人 → 前后端/QA）');
console.log('   • 示例：feature-development team');

console.log('\n4. debate（辩论模式）');
console.log('   • 多方辩论，多轮讨论达成共识');
console.log('   • 适用：架构设计（简洁派 vs 扩展派 vs 务实派）');
console.log('   • 示例：architecture-debate team');

console.log('\n5. pipeline（流水线）');
console.log('   • 前一个 Agent 的输出是下一个的输入');
console.log('   • 适用：数据处理（提取 → 清洗 → 分析 → 报告）');
console.log('   • 示例：data-pipeline team');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 实际测试方法
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n🧪 如何实际测试');
console.log('═'.repeat(70));

console.log('\n方法 1: 使用 CLI（推荐）');
console.log('   $ npm run dev');
console.log('   > 用 explore agent 分析 src/core 的架构');
console.log('   > 用 code-review team 审查 src/auth.ts');
console.log('   > 用 research team 调研 React Server Components');

console.log('\n方法 2: 查看单元测试');
console.log('   $ npm test -- team');
console.log('   查看 src/core/agent/team/__tests__/ 目录');

console.log('\n方法 3: 阅读文档');
console.log('   📖 docs/multi-agent-tools-demo.md');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 注意事项
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n⚠️  注意事项');
console.log('═'.repeat(70));

console.log('\n• 这些工具需要在完整的 ChatSession 环境中运行');
console.log('• 需要正确配置 LLM Provider（Anthropic API key）');
console.log('• 团队协作会消耗较多 Token，注意成本');
console.log('• Sub-agent 不能创建新的 sub-agent（最大嵌套 3 层）');
console.log('• 最多 3 个并发 sub-agent');
console.log('• 团队成员数量限制：1-10 人');

console.log('\n\n✅ 演示完成！');
console.log('═'.repeat(70));
console.log();
