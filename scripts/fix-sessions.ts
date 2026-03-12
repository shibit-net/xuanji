#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const sessionsDir = path.join(process.env.HOME!, '.xuanji', 'sessions');

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: any;
}

async function checkAndFixSession(sessionFile: string): Promise<{ hasIssue: boolean; fixed: boolean; violations: number }> {
  const lines: Message[] = [];

  // 读取 JSONL 文件
  const fileStream = fs.createReadStream(sessionFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        lines.push(JSON.parse(line));
      } catch (err) {
        console.error(`  ⚠️  Invalid JSON in ${sessionFile}: ${line.slice(0, 50)}...`);
      }
    }
  }

  // 检查连续相同角色
  let violations = 0;
  let prevRole: string | null = null;
  const violationIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (prevRole === lines[i].role) {
      violations++;
      violationIndices.push(i);
    }
    prevRole = lines[i].role;
  }

  if (violations === 0) {
    return { hasIssue: false, fixed: false, violations: 0 };
  }

  console.log(`  ❌ Found ${violations} consecutive same-role message(s) at indices: ${violationIndices.join(', ')}`);

  // 修复：合并连续的 user 消息
  const fixed: Message[] = [];
  for (let i = 0; i < lines.length; i++) {
    const msg = lines[i];

    if (fixed.length === 0) {
      fixed.push(msg);
      continue;
    }

    const lastMsg = fixed[fixed.length - 1];

    if (lastMsg.role === msg.role && msg.role === 'user') {
      // 合并连续的 user 消息
      if (typeof lastMsg.content === 'string' && typeof msg.content === 'string') {
        lastMsg.content = `${lastMsg.content}\n\n${msg.content}`;
      } else if (Array.isArray(lastMsg.content) && Array.isArray(msg.content)) {
        lastMsg.content = [...lastMsg.content, ...msg.content];
      } else if (typeof lastMsg.content === 'string' && Array.isArray(msg.content)) {
        // 保留原样，不合并混合类型
        fixed.push(msg);
      } else {
        // 其他情况，保留第一条，跳过第二条
        console.log(`    ⚠️  Skipping duplicate message at index ${i}`);
      }
    } else if (lastMsg.role === msg.role && msg.role === 'assistant') {
      // 跳过连续的 assistant 消息
      console.log(`    ⚠️  Skipping consecutive assistant message at index ${i}`);
    } else {
      // 正常添加
      fixed.push(msg);
    }
  }

  // 备份原文件
  const backupFile = `${sessionFile}.bak`;
  fs.copyFileSync(sessionFile, backupFile);

  // 写入修复后的文件
  const fixedContent = fixed.map((msg) => JSON.stringify(msg)).join('\n') + '\n';
  fs.writeFileSync(sessionFile, fixedContent, 'utf-8');

  console.log(`    ✅ Fixed: ${lines.length} → ${fixed.length} messages, backup saved to ${path.basename(backupFile)}`);

  return { hasIssue: true, fixed: true, violations };
}

async function main() {
  console.log('🔍 Scanning session files...\n');

  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.messages.jsonl'));

  let totalIssues = 0;
  let totalFixed = 0;
  let totalViolations = 0;

  for (const file of files) {
    const sessionFile = path.join(sessionsDir, file);
    console.log(`Checking ${file}...`);

    const result = await checkAndFixSession(sessionFile);
    if (result.hasIssue) {
      totalIssues++;
      if (result.fixed) {
        totalFixed++;
      }
      totalViolations += result.violations;
    } else {
      console.log('  ✅ No issues');
    }
    console.log('');
  }

  console.log('=====================================');
  console.log(`📊 Summary:`);
  console.log(`   Total sessions: ${files.length}`);
  console.log(`   Sessions with issues: ${totalIssues}`);
  console.log(`   Sessions fixed: ${totalFixed}`);
  console.log(`   Total violations: ${totalViolations}`);
  console.log('=====================================');

  if (totalFixed > 0) {
    console.log('\n✅ All issues have been fixed!');
    console.log('   Backup files (.bak) have been created.');
    console.log('   You can now restart xuanji and the API errors should be resolved.');
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
