#!/usr/bin/env node

/**
 * 测试 Todo 任务管理增强功能
 */

import { getTodoManager } from '../dist/TodoManager-XXXXXXXX.js'; // 需要找到实际的 chunk 名称

async function test() {
  console.log('=== 测试 Todo 任务管理增强 ===\n');

  const todoManager = getTodoManager();

  // 1. 创建测试任务
  console.log('1. 创建测试任务...');
  await todoManager.create({ title: '任务 1', description: '测试任务 1' });
  await todoManager.create({ title: '任务 2', description: '测试任务 2' });
  await todoManager.create({ title: '任务 3', description: '测试任务 3' });

  let todos = await todoManager.list();
  console.log(`   创建了 ${todos.length} 个任务\n`);

  // 2. 完成部分任务
  console.log('2. 完成部分任务...');
  await todoManager.update(todos[0].id, { status: 'completed' });
  await todoManager.update(todos[1].id, { status: 'completed' });

  todos = await todoManager.list();
  const completed = todos.filter(t => t.status === 'completed').length;
  console.log(`   已完成 ${completed} 个任务\n`);

  // 3. 测试归档功能
  console.log('3. 测试归档功能...');
  const archivedCount = await todoManager.archiveCompleted();
  console.log(`   归档了 ${archivedCount} 个任务`);

  const archivedTotal = await todoManager.getArchivedCount();
  console.log(`   归档总数：${archivedTotal}\n`);

  // 4. 查看剩余任务
  todos = await todoManager.list();
  console.log(`4. 剩余任务：${todos.length} 个`);
  todos.forEach(t => {
    console.log(`   - ${t.title} (${t.status})`);
  });

  console.log('\n✅ 测试完成！');
}

test().catch(console.error);
