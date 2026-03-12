#!/usr/bin/env tsx
// ============================================================
// 测试 TODO CREATE 批量合并功能
// ============================================================

import { ToolRegistry } from '../src/core/tools/ToolRegistry';
import { TodoStorageTool } from '../src/core/tools/TodoStorageTool';
import { TodoUpdateTool } from '../src/core/tools/TodoUpdateTool';
import { TodoListTool } from '../src/core/tools/TodoListTool';

async function testToolReadonly() {
  console.log('🧪 测试 TODO 工具的 readonly 属性\n');

  const registry = new ToolRegistry();

  // 注册 TODO 工具
  registry.register(new TodoStorageTool());
  registry.register(new TodoUpdateTool());
  registry.register(new TodoListTool());

  // 检查 readonly 属性
  const todoCreate = registry.get('todo_create');
  const todoUpdate = registry.get('todo_update');
  const todoList = registry.get('todo_list');

  console.log('工具 readonly 属性:');
  console.log(`  todo_create: ${todoCreate?.readonly === true ? '✅ readonly' : '❌ writable'}`);
  console.log(`  todo_update: ${todoUpdate?.readonly === true ? '✅ readonly' : '❌ writable'}`);
  console.log(`  todo_list:   ${todoList?.readonly === true ? '✅ readonly' : '❌ writable'}`);

  const allReadonly =
    todoCreate?.readonly === true &&
    todoUpdate?.readonly === true &&
    todoList?.readonly === true;

  if (allReadonly) {
    console.log('\n✅ 所有 TODO 工具都已标记为 readonly，可以并行执行');
    console.log('   这意味着多个 todo_create 调用会在短时间内完成，');
    console.log('   触发批量合并逻辑，显示 "✅ 已创建 N 个任务"');
  } else {
    console.log('\n❌ 部分 TODO 工具仍为 writable，会串行执行');
    console.log('   这会导致每个工具调用单独触发合并，');
    console.log('   无法实现批量合并效果');
    process.exit(1);
  }
}

testToolReadonly().catch(console.error);
