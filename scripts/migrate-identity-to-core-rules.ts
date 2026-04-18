#!/usr/bin/env tsx
// ============================================================
// 迁移脚本：将身份记忆从 memory.db 迁移到 core-rules.json
// ============================================================

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { CoreRuleStore } from '../src/memory/CoreRuleStore';

const MEMORY_DB_PATH = join(homedir(), '.xuanji', 'memory.db');
const CORE_RULES_PATH = join(homedir(), '.xuanji', 'core-rules.json');

async function migrate() {
  console.log('🔄 开始迁移身份记忆...\n');

  // 检查 memory.db 是否存在
  if (!existsSync(MEMORY_DB_PATH)) {
    console.log('❌ memory.db 不存在，跳过迁移');
    return;
  }

  // 打开数据库
  const db = Database(MEMORY_DB_PATH, { readonly: true });

  // 查询身份相关记忆
  const sql = `
    SELECT content, created_at
    FROM memories
    WHERE (type = 'user_fact' OR type = 'user_preference')
      AND deleted_at IS NULL
      AND (
        content LIKE '%称呼%'
        OR content LIKE '%名字%'
        OR content LIKE '%贾维斯%'
        OR content LIKE '%Boss%'
        OR content LIKE '%先生%'
      )
    ORDER BY created_at DESC
  `;

  const rows = db.prepare(sql).all() as Array<{ content: string; created_at: string }>;
  db.close();

  if (rows.length === 0) {
    console.log('✅ 没有找到需要迁移的身份记忆');
    return;
  }

  console.log(`📋 找到 ${rows.length} 条身份记忆：`);
  rows.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.content}`);
  });
  console.log();

  // 初始化 CoreRuleStore
  const coreRuleStore = new CoreRuleStore(CORE_RULES_PATH);

  // 解析并迁移
  let assistantName: string | undefined;
  let userTitle: string | undefined;

  for (const row of rows) {
    const content = row.content;

    // 解析助手名字
    const nameMatch = content.match(/称呼助手为\s*["']([^"']+?)["']/);
    if (nameMatch && !assistantName) {
      assistantName = nameMatch[1];
    }

    // 解析用户称呼
    const titleMatch = content.match(/被称呼为\s*["']([^"']+?)["']/);
    if (titleMatch) {
      userTitle = titleMatch[1];
    }
  }

  // 迁移到 CoreRuleStore
  if (assistantName) {
    coreRuleStore.setAssistantName(assistantName);
    console.log(`✅ 已迁移助手名字: ${assistantName}`);
  }

  if (userTitle) {
    coreRuleStore.setUserTitle(userTitle);
    console.log(`✅ 已迁移用户称呼: ${userTitle}`);
  }

  console.log('\n🎉 迁移完成！');
  console.log(`📁 核心规则文件: ${CORE_RULES_PATH}`);
}

migrate().catch(err => {
  console.error('❌ 迁移失败:', err);
  process.exit(1);
});
