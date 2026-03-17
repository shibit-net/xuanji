#!/usr/bin/env node
/**
 * 记忆系统迁移脚本
 *
 * 功能：
 * 1. 将 project_fact → knowledge
 * 2. 移除 projectPath 字段
 * 3. 合并项目级记忆到全局
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface MemoryEntry {
  id: string;
  type: string;
  content: string;
  keywords: string[];
  source: string;
  confidence: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  projectPath?: string;
  metadata?: Record<string, unknown>;
}

const globalDir = join(homedir(), '.xuanji', 'memory');

console.log('🔄 Xuanji 记忆系统迁移');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 1. 检查全局记忆目录
if (!existsSync(globalDir)) {
  console.log('✓ 未找到记忆数据，无需迁移\n');
  process.exit(0);
}

console.log(`📂 全局记忆目录: ${globalDir}\n`);

// 2. 迁移所有 JSONL 文件
const files = ['knowledge.jsonl', 'decisions.jsonl', 'sessions.jsonl', 'personal.jsonl'];
let totalMigrated = 0;

for (const fileName of files) {
  const filePath = join(globalDir, fileName);
  if (!existsSync(filePath)) continue;

  console.log(`处理: ${fileName}`);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    let changed = 0;
    const migratedLines = lines.map(line => {
      try {
        const entry: MemoryEntry = JSON.parse(line);
        let modified = false;

        // 重命名 project_fact → knowledge
        if (entry.type === 'project_fact') {
          entry.type = 'knowledge';
          modified = true;
          changed++;
        }

        // 移除 projectPath
        if (entry.projectPath !== undefined) {
          delete entry.projectPath;
          modified = true;
        }

        return JSON.stringify(entry);
      } catch (err) {
        console.warn(`  ⚠️ 跳过无效行: ${line.substring(0, 50)}...`);
        return line;
      }
    });

    if (changed > 0) {
      // 备份原文件
      writeFileSync(`${filePath}.backup`, content, 'utf-8');
      // 写入迁移后的数据
      writeFileSync(filePath, migratedLines.join('\n') + '\n', 'utf-8');
      console.log(`  ✓ 已迁移 ${changed} 条记录`);
      console.log(`  ✓ 备份: ${fileName}.backup\n`);
      totalMigrated += changed;
    } else {
      console.log(`  - 无需修改\n`);
    }
  } catch (err) {
    console.error(`  ✗ 处理失败: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// 3. 检查项目级记忆（提示用户手动合并）
const cwd = process.cwd();
const projectMemoryDir = join(cwd, '.xuanji', 'memory');

if (existsSync(projectMemoryDir)) {
  console.log('\n⚠️  检测到项目级记忆目录:');
  console.log(`   ${projectMemoryDir}\n`);
  console.log('   Xuanji 已改为全局共享记忆，不再支持项目级记忆。');
  console.log('   如需保留这些记忆，请手动将 JSONL 文件合并到全局目录：');
  console.log(`   ${globalDir}\n`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ 迁移完成！共处理 ${totalMigrated} 条记录\n`);

if (totalMigrated > 0) {
  console.log('💡 提示：');
  console.log('   - 原文件已备份为 .backup 后缀');
  console.log('   - 如有问题，可使用备份文件恢复\n');
}
