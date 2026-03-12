#!/usr/bin/env tsx
// ============================================================
// 测试 TODO 显示问题
// ============================================================

import { TodoManager } from '../src/core/tools/TodoManager';
import { parseTodoProgress } from '../src/adapters/cli/TodoPanel';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function testTodoDisplay() {
  // 使用临时目录避免污染用户数据
  const tempDir = mkdtempSync(join(tmpdir(), 'xuanji-test-'));
  const storagePath = join(tempDir, 'todos.jsonl');

  console.log('🧪 测试 TODO 显示问题\n');
  console.log(`临时存储: ${storagePath}\n`);

  try {
    const manager = new TodoManager(storagePath);

    // 模拟 LLM 创建 3 个 TODO
    console.log('1️⃣ 创建第一个 TODO...');
    const todo1 = await manager.create({
      title: '修复登录 bug',
      description: '修复登录页面的 bug',
    });
    console.log(`   结果: ${todo1.id} - ${todo1.title}`);

    console.log('\n2️⃣ 创建第二个 TODO...');
    const todo2 = await manager.create({
      title: '添加单元测试',
      description: '为登录模块添加单元测试',
    });
    console.log(`   结果: ${todo2.id} - ${todo2.title}`);

    console.log('\n3️⃣ 创建第三个 TODO...');
    const todo3 = await manager.create({
      title: '更新文档',
      description: '更新 API 文档',
    });
    console.log(`   结果: ${todo3.id} - ${todo3.title}`);

    // 检查 formatProgress() 返回值
    console.log('\n4️⃣ 调用 formatProgress()...');
    const progressStr = manager.formatProgress();
    console.log('   原始输出:');
    console.log(`   ${progressStr}`);

    // 解析进度数据
    console.log('\n5️⃣ 解析 TODO 进度数据...');
    const progressData = parseTodoProgress(progressStr);
    if (progressData) {
      console.log(`   ✅ 解析成功!`);
      console.log(`   总任务数: ${progressData.total}`);
      console.log(`   已完成数: ${progressData.completed}`);
      console.log(`   任务列表 (${progressData.items.length} 项):`);
      progressData.items.forEach((item, i) => {
        console.log(`     ${i + 1}. [${item.status}] ${item.title}`);
      });
    } else {
      console.log('   ❌ 解析失败!');
    }

    // 检查内存中的任务数量
    console.log('\n6️⃣ 检查内存中的任务...');
    const allTodos = await manager.list({ status: 'all' });
    console.log(`   内存中共有 ${allTodos.length} 个任务`);
    allTodos.forEach((todo, i) => {
      console.log(`     ${i + 1}. ${todo.id} - ${todo.title}`);
    });

    console.log('\n✅ 测试完成');

    // 清理
    rmSync(tempDir, { recursive: true, force: true });

  } catch (err) {
    console.error('\n❌ 测试失败:', err);
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }
}

testTodoDisplay().catch(console.error);
