#!/usr/bin/env node
// ============================================================
// 将项目 .xuanji/ 下的用户数据迁移到 ~/.xuanji/
// ============================================================
// 用法: node scripts/migrate-xuanji-data.mjs [project-dir]
// 默认 project-dir = 当前目录
//
// 已存在文件不会被覆盖

import { cp, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { constants } from 'node:fs';

const PROJECT_ROOT = process.argv[2] ?? process.cwd();
const HOME_ROOT = homedir();

const SOURCE_DIR = join(PROJECT_ROOT, '.xuanji');
const TARGET_DIR = join(HOME_ROOT, '.xuanji');

const SKIP_ITEMS = new Set([
  'config.json',
  'rules.md',
  'worktrees',
  'checkpoints',
  'cache',
  'scripts',
  'integration',
  'ignore.template',
]);

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function migrate() {
  console.log(`源目录: ${SOURCE_DIR}`);
  console.log(`目标目录: ${TARGET_DIR}\n`);

  if (!(await fileExists(SOURCE_DIR))) {
    console.log('项目 .xuanji/ 目录不存在，无需迁移。');
    return;
  }

  await mkdir(TARGET_DIR, { recursive: true });

  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });

  let copied = 0;
  let skipped = 0;

  for (const entry of entries) {
    const name = entry.name;
    if (SKIP_ITEMS.has(name)) {
      console.log(`  [跳过] ${name}`);
      skipped++;
      continue;
    }

    const src = join(SOURCE_DIR, name);
    const dest = join(TARGET_DIR, name);

    try {
      await cp(src, dest, { recursive: true, verbatimSymlinks: true });
      console.log(`  [迁移] ${name}`);
      copied++;
    } catch (err) {
      if (err.code === 'ERR_CP_EEXIST') {
        console.log(`  [跳过] ${name} (已存在)`);
        skipped++;
      } else {
        console.error(`  [失败] ${name}: ${err.message}`);
      }
    }
  }

  console.log(`\n迁移完成: 复制 ${copied} 项, 跳过 ${skipped} 项`);
}

migrate().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
