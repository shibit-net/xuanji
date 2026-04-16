#!/usr/bin/env node
/**
 * 测试脚本：验证多 Agent 并行执行的 UI 展示
 * 
 * 使用方式:
 *   node scripts/test-parallel-ui.mjs
 */

import { HookRegistry } from '../dist/hooks/HookRegistry.js';

// 模拟 SubAgent 执行
function simulateSubAgent(id, role, task, duration = 5000) {
  console.log(`\n[Simulator] 启动 SubAgent: ${id} (${role})`);
  
  // 发送 start 事件
  HookRegistry.emit('agent:subagent_start', {
    subAgentId: id,
    task,
    depth: 1,
    role,
  });

  let toolIndex = 0;
  const tools = ['glob', 'read_file', 'grep', 'edit_file', 'write_file'];
  
  // 模拟工具调用
  const toolInterval = setInterval(() => {
    const toolName = tools[toolIndex % tools.length];
    console.log(`[Simulator] ${id} 使用工具: ${toolName}`);
    
    HookRegistry.emit('agent:subagent_tool_use', {
      subAgentId: id,
      toolName,
    });
    
    toolIndex++;
  }, 1000);

  // 完成后发送 end 事件
  setTimeout(() => {
    clearInterval(toolInterval);
    console.log(`[Simulator] ${id} 完成`);
    
    HookRegistry.emit('agent:subagent_end', {
      subAgentId: id,
      result: 'Task completed successfully',
    });
  }, duration);
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('测试: 多 Agent 并行执行 UI 展示');
  console.log('='.repeat(60));

  console.log('\n📝 注意: 请先启动 xuanji，然后观察终端 UI 变化');
  console.log('   如果需要查看事件日志，设置环境变量: DEBUG=xuanji:hooks\n');

  // 等待用户准备
  await new Promise(resolve => {
    console.log('按 Enter 开始测试...');
    process.stdin.once('data', resolve);
  });

  // 测试 1: 顺序执行
  console.log('\n' + '─'.repeat(60));
  console.log('测试 1: 顺序执行 2 个 SubAgent');
  console.log('─'.repeat(60));
  
  simulateSubAgent('explore-001', 'explore', '分析 src/core/agent 目录结构', 3000);
  
  setTimeout(() => {
    simulateSubAgent('plan-001', 'plan', '设计新功能实现方案', 4000);
  }, 3500);

  // 等待测试 1 完成
  await new Promise(resolve => setTimeout(resolve, 8000));

  // 测试 2: 并行执行
  console.log('\n' + '─'.repeat(60));
  console.log('测试 2: 并行执行 3 个 SubAgent');
  console.log('─'.repeat(60));
  
  simulateSubAgent('explore-002', 'explore', '分析 src/core 目录结构', 5000);
  simulateSubAgent('explore-003', 'explore', '分析 src/adapters 目录结构', 6000);
  simulateSubAgent('explore-004', 'explore', '分析 src/mcp 目录结构', 4000);

  // 等待测试 2 完成
  await new Promise(resolve => setTimeout(resolve, 7000));

  // 测试 3: 嵌套执行
  console.log('\n' + '─'.repeat(60));
  console.log('测试 3: 嵌套 SubAgent（模拟）');
  console.log('─'.repeat(60));
  
  console.log('[Simulator] 启动外层 coder Agent');
  HookRegistry.emit('agent:subagent_start', {
    subAgentId: 'coder-001',
    task: '创建新工具 CustomTool.ts',
    depth: 1,
    role: 'coder',
  });

  setTimeout(() => {
    HookRegistry.emit('agent:subagent_tool_use', {
      subAgentId: 'coder-001',
      toolName: 'read_file',
    });
  }, 1000);

  setTimeout(() => {
    console.log('[Simulator] coder 内部启动 explore (depth=2)');
    HookRegistry.emit('agent:subagent_start', {
      subAgentId: 'explore-nested-001',
      task: '分析现有工具结构',
      depth: 2,
      role: 'explore',
    });

    setTimeout(() => {
      HookRegistry.emit('agent:subagent_tool_use', {
        subAgentId: 'explore-nested-001',
        toolName: 'glob',
      });
    }, 500);

    setTimeout(() => {
      HookRegistry.emit('agent:subagent_end', {
        subAgentId: 'explore-nested-001',
        result: 'Analysis complete',
      });
    }, 2000);
  }, 2000);

  setTimeout(() => {
    HookRegistry.emit('agent:subagent_tool_use', {
      subAgentId: 'coder-001',
      toolName: 'write_file',
    });
  }, 4500);

  setTimeout(() => {
    HookRegistry.emit('agent:subagent_end', {
      subAgentId: 'coder-001',
      result: 'File created successfully',
    });
  }, 6000);

  await new Promise(resolve => setTimeout(resolve, 7000));

  console.log('\n' + '='.repeat(60));
  console.log('✅ 所有测试完成！');
  console.log('='.repeat(60));
  console.log('\n请检查 xuanji 终端 UI 是否正确展示了：');
  console.log('  1. 顺序执行 - Agent 依次出现和消失');
  console.log('  2. 并行执行 - 多个 Agent 同时显示');
  console.log('  3. 嵌套执行 - 内层 Agent 有缩进');
  console.log('  4. 实时更新 - 工具名、次数、时间正确更新');
  console.log('  5. 完成移除 - Agent 完成后自动消失\n');

  process.exit(0);
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
