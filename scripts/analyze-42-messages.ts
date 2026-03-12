#!/usr/bin/env tsx

const messagesJson = '[{"role":"user","contentType":"string","contentLength":8},{"role":"assistant","contentType":"object","contentLength":2},{"role":"user","contentType":"object","contentLength":1},{"role":"assistant","contentType":"object","contentLength":7},{"role":"user","contentType":"object","contentLength":6},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":1},{"role":"user","contentType":"object","contentLength":1},{"role":"assistant","contentType":"object","contentLength":1},{"role":"user","contentType":"object","contentLength":1},{"role":"assistant","contentType":"object","contentLength":2},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":1},{"role":"user","contentType":"object","contentLength":1},{"role":"assistant","contentType":"object","contentLength":2},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":1},{"role":"user","contentType":"object","contentLength":1},{"role":"assistant","contentType":"object","contentLength":2},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":3},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":3},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":3},{"role":"assistant","contentType":"object","contentLength":3},{"role":"user","contentType":"object","contentLength":2},{"role":"user","contentType":"string","contentLength":10},{"role":"assistant","contentType":"object","contentLength":4},{"role":"user","contentType":"object","contentLength":2}]';

const messages = JSON.parse(messagesJson);

console.log('\n📊 Detailed Message Sequence Analysis');
console.log('='.repeat(70));
console.log(`Total messages: ${messages.length}\n`);

// 检查连续相同角色
let prevRole = null;
let violations = [];

for (let i = 0; i < messages.length; i++) {
  const msg = messages[i];
  if (prevRole === msg.role) {
    violations.push(i);
  }
  prevRole = msg.role;
}

if (violations.length === 0) {
  console.log('✅ No violations found');
} else {
  console.log(`❌ Found ${violations.length} violation(s) at indices: ${violations.join(', ')}\n`);

  for (const idx of violations) {
    console.log(`\nViolation at index ${idx}:`);
    const start = Math.max(0, idx - 2);
    const end = Math.min(messages.length, idx + 3);

    for (let i = start; i < end; i++) {
      const marker = i === idx || i === idx - 1 ? '❌' : '  ';
      const msg = messages[i];
      console.log(`  ${marker} [${i.toString().padStart(2)}] ${msg.role.padEnd(9)} | ${msg.contentType.padEnd(6)} | len=${msg.contentLength}`);
    }
  }
}

console.log('\n' + '='.repeat(70));
console.log('🔍 Analysis:');
console.log(`   - Index 38: user (tool_result)`);
console.log(`   - Index 39: user (追加内容，长度 10) ⚠️  VIOLATION`);
console.log('\n💡 This is the pattern we saw before:');
console.log('   assistant (tool_use) → user (tool_result) → user (append) ← WRONG');
console.log('\n📝 But surprisingly, this request succeeded (returned end_turn)');
console.log('   Maybe Claude API is more tolerant now, or the proxy server');
console.log('   handled it differently.');
console.log('='.repeat(70));
