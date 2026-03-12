#!/usr/bin/env tsx

// 从最新日志中提取并分析消息序列
import fs from 'fs';
import path from 'path';

const logPath = path.join(process.env.HOME!, '.xuanji', 'logs', 'core.log');
const logContent = fs.readFileSync(logPath, 'utf-8');
const lines = logContent.split('\n');

// 找到最后一个 "Request structure" 日志
let lastRequestIndex = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('Request structure')) {
    lastRequestIndex = i;
    break;
  }
}

if (lastRequestIndex === -1) {
  console.log('No request structure found');
  process.exit(0);
}

// 提取 messages 数组
let messagesLine = '';
for (let i = lastRequestIndex; i < Math.min(lastRequestIndex + 10, lines.length); i++) {
  if (lines[i].includes('messages:')) {
    messagesLine = lines[i];
    break;
  }
}

if (!messagesLine) {
  console.log('No messages found');
  process.exit(0);
}

// 解析 messages
const match = messagesLine.match(/messages: (\[.*\])/);
if (!match) {
  console.log('Failed to parse messages');
  process.exit(0);
}

try {
  const messages = JSON.parse(match[1]);
  console.log(`\n📊 Message Sequence Analysis (Total: ${messages.length})`);
  console.log('='.repeat(70));

  // 检查连续相同角色
  let violations = 0;
  let prevRole = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const marker = prevRole === msg.role ? ' ⚠️  VIOLATION' : '';

    if (prevRole === msg.role) {
      violations++;
      // 打印违规上下文
      console.log('\n❌ Consecutive same-role messages:');
      if (i > 0) {
        console.log(`  [${i-1}] ${messages[i-1].role} | ${messages[i-1].contentType} | len=${messages[i-1].contentLength}`);
      }
      console.log(`  [${i}] ${msg.role} | ${msg.contentType} | len=${msg.contentLength} ⚠️`);
      if (i < messages.length - 1) {
        console.log(`  [${i+1}] ${messages[i+1].role} | ${messages[i+1].contentType} | len=${messages[i+1].contentLength}`);
      }
    }

    prevRole = msg.role;
  }

  console.log('\n' + '='.repeat(70));
  if (violations > 0) {
    console.log(`❌ Found ${violations} violation(s) - consecutive same-role messages`);
    console.log('\n💡 Solution:');
    console.log('   1. Restart xuanji to reload fixed session files');
    console.log('   2. Or use /sessions to list and /resume to load a different session');
  } else {
    console.log('✅ No violations found - message sequence is correct');
  }
  console.log('='.repeat(70));

} catch (err) {
  console.error('Error parsing messages:', err);
}
