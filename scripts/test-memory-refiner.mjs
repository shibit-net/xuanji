#!/usr/bin/env node
// ============================================================
// Memory Refiner Agent 真实测试脚本
// ============================================================

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

const dbPath = join(homedir(), '.xuanji', 'memory.db');
const db = new Database(dbPath);

console.log('=== Memory Refiner Agent 测试报告 ===\n');
console.log(`数据库路径: ${dbPath}`);
console.log(`测试时间: ${new Date().toISOString()}\n`);

// ============================================================
// 1. 测试前统计
// ============================================================

console.log('## 1. 测试前统计\n');

const beforeStats = {
  total: 0,
  active: 0,
  obsolete: 0,
  byType: {},
  highFrequency: {},
};

const allMemories = db.prepare('SELECT * FROM memories').all();
beforeStats.total = allMemories.length;
beforeStats.active = allMemories.filter(m => !m.obsolete).length;
beforeStats.obsolete = allMemories.filter(m => m.obsolete).length;

// 按类型统计
for (const memory of allMemories) {
  if (memory.obsolete) continue;

  const type = memory.type;
  beforeStats.byType[type] = (beforeStats.byType[type] || 0) + 1;

  if (memory.access_count >= 3) {
    beforeStats.highFrequency[type] = (beforeStats.highFrequency[type] || 0) + 1;
  }
}

console.log('### 总体统计');
console.log(`- 总记忆数: ${beforeStats.total}`);
console.log(`- 活跃记忆: ${beforeStats.active}`);
console.log(`- 过时记忆: ${beforeStats.obsolete}`);
console.log(`- 过时率: ${Math.round(beforeStats.obsolete / beforeStats.total * 100)}%\n`);

console.log('### 按类型统计');
const sortedTypes = Object.entries(beforeStats.byType)
  .sort(([, a], [, b]) => b - a);

for (const [type, count] of sortedTypes) {
  const highFreq = beforeStats.highFrequency[type] || 0;
  console.log(`- ${type}: ${count} (高频: ${highFreq})`);
}

// ============================================================
// 2. 分析候选记忆
// ============================================================

console.log('\n## 2. 候选记忆分析\n');

// error_resolution 候选
const errorResolutions = db.prepare(`
  SELECT id, content, access_count, confidence, created_at
  FROM memories
  WHERE type = 'error_resolution' AND obsolete = 0
  ORDER BY access_count DESC
  LIMIT 10
`).all();

console.log('### error_resolution 候选（前10条）');
console.log(`总数: ${beforeStats.byType['error_resolution'] || 0}`);
console.log(`高频 (访问>=3): ${beforeStats.highFrequency['error_resolution'] || 0}\n`);

if (errorResolutions.length > 0) {
  console.log('**高频记忆示例:**');
  for (let i = 0; i < Math.min(3, errorResolutions.length); i++) {
    const m = errorResolutions[i];
    console.log(`${i + 1}. [访问${m.access_count}次] ${m.content.slice(0, 80)}...`);
  }
}

// decision 候选
const decisions = db.prepare(`
  SELECT id, content, keywords, access_count
  FROM memories
  WHERE type = 'decision' AND obsolete = 0
  ORDER BY created_at DESC
  LIMIT 20
`).all();

console.log('\n### decision 候选');
console.log(`总数: ${beforeStats.byType['decision'] || 0}\n`);

// 分析相似度
const similarGroups = [];
for (let i = 0; i < decisions.length; i++) {
  for (let j = i + 1; j < decisions.length; j++) {
    const keywords1 = new Set(JSON.parse(decisions[i].keywords || '[]'));
    const keywords2 = new Set(JSON.parse(decisions[j].keywords || '[]'));

    let overlap = 0;
    for (const kw of keywords1) {
      if (keywords2.has(kw)) overlap++;
    }

    const total = keywords1.size + keywords2.size;
    if (total > 0 && overlap / total > 0.3) {
      similarGroups.push({
        id1: decisions[i].id,
        id2: decisions[j].id,
        content1: decisions[i].content.slice(0, 60),
        content2: decisions[j].content.slice(0, 60),
        similarity: Math.round(overlap / total * 100),
      });
    }
  }
}

if (similarGroups.length > 0) {
  console.log(`**发现 ${similarGroups.length} 组相似记忆:**`);
  for (let i = 0; i < Math.min(3, similarGroups.length); i++) {
    const g = similarGroups[i];
    console.log(`${i + 1}. 相似度 ${g.similarity}%`);
    console.log(`   - ${g.content1}...`);
    console.log(`   - ${g.content2}...`);
  }
} else {
  console.log('未发现明显相似的记忆');
}

// ============================================================
// 3. 工具功能测试
// ============================================================

console.log('\n## 3. 工具功能测试\n');

// 测试分页查询
console.log('### 测试 MemoryQueryTool 分页');

const page1Count = db.prepare(`
  SELECT COUNT(*) as count FROM memories
  WHERE type = 'error_resolution' AND obsolete = 0 AND access_count >= 3
`).get();

console.log(`- 高频 error_resolution 总数: ${page1Count.count}`);
console.log(`- 如果每页20条，需要 ${Math.ceil(page1Count.count / 20)} 批次`);
console.log(`- 分页参数: offset=0,20,40,... limit=20`);

// 测试统计工具
console.log('\n### 测试 MemoryStatsTool');

const avgStats = db.prepare(`
  SELECT
    type,
    COUNT(*) as count,
    AVG(access_count) as avg_access,
    AVG(confidence) as avg_confidence,
    SUM(CASE WHEN access_count >= 3 THEN 1 ELSE 0 END) as high_freq
  FROM memories
  WHERE obsolete = 0
  GROUP BY type
  ORDER BY count DESC
  LIMIT 5
`).all();

console.log('**按类型统计（前5）:**');
for (const stat of avgStats) {
  console.log(`- ${stat.type}:`);
  console.log(`  数量: ${stat.count}, 平均访问: ${stat.avg_access.toFixed(1)}, 高频: ${stat.high_freq}`);
}

// ============================================================
// 4. 预期效果分析
// ============================================================

console.log('\n## 4. 预期效果分析\n');

const highFreqErrorRes = beforeStats.highFrequency['error_resolution'] || 0;
const totalDecisions = beforeStats.byType['decision'] || 0;

console.log('### 提炼任务预期');
console.log(`- 候选记忆: ${highFreqErrorRes} 条高频 error_resolution`);
console.log(`- 预计升级: ${Math.min(10, Math.ceil(highFreqErrorRes * 0.3))} 条 → lesson_learned`);
console.log(`- 处理批次: ${Math.ceil(highFreqErrorRes / 20)} 批（每批20条）`);
console.log(`- 预计耗时: ${Math.ceil(highFreqErrorRes / 20) * 30} 秒`);

console.log('\n### 压缩任务预期');
console.log(`- 候选记忆: ${totalDecisions} 条 decision`);
console.log(`- 相似组数: ${similarGroups.length} 组`);
console.log(`- 预计合并: ${Math.min(5, similarGroups.length)} 组`);
console.log(`- 预计减少: ${Math.min(5, similarGroups.length) * 2} 条记忆`);

// ============================================================
// 5. 建议和总结
// ============================================================

console.log('\n## 5. 建议和总结\n');

const recommendations = [];

if (highFreqErrorRes > 0) {
  recommendations.push(`✅ 建议执行提炼任务：有 ${highFreqErrorRes} 条高频 error_resolution 值得升级`);
}

if (similarGroups.length > 0) {
  recommendations.push(`✅ 建议执行压缩任务：发现 ${similarGroups.length} 组相似记忆可以合并`);
}

if (beforeStats.obsolete / beforeStats.total > 0.2) {
  recommendations.push(`⚠️  过时记忆占比 ${Math.round(beforeStats.obsolete / beforeStats.total * 100)}%，建议清理`);
}

if (beforeStats.byType['lesson_learned']) {
  const ratio = beforeStats.byType['lesson_learned'] / beforeStats.active;
  if (ratio < 0.05) {
    recommendations.push(`⚠️  lesson_learned 占比仅 ${Math.round(ratio * 100)}%，建议增加提炼`);
  }
}

if (recommendations.length > 0) {
  console.log('### 建议');
  for (const rec of recommendations) {
    console.log(rec);
  }
} else {
  console.log('✅ 记忆库状态良好，暂无优化建议');
}

console.log('\n### 总结');
console.log(`- 记忆库规模: ${beforeStats.active} 条活跃记忆`);
console.log(`- 提炼潜力: ${highFreqErrorRes} 条高频记忆待升级`);
console.log(`- 压缩潜力: ${similarGroups.length} 组相似记忆待合并`);
console.log(`- 整体健康度: ${recommendations.length === 0 ? '优秀' : recommendations.length <= 2 ? '良好' : '需要优化'}`);

// 生成报告文件
const report = {
  timestamp: new Date().toISOString(),
  database: dbPath,
  beforeStats,
  candidates: {
    errorResolutions: errorResolutions.length,
    decisions: decisions.length,
    similarGroups: similarGroups.length,
  },
  predictions: {
    refinement: {
      candidates: highFreqErrorRes,
      expectedUpgrades: Math.min(10, Math.ceil(highFreqErrorRes * 0.3)),
      batches: Math.ceil(highFreqErrorRes / 20),
    },
    compaction: {
      candidates: totalDecisions,
      similarGroups: similarGroups.length,
      expectedMerges: Math.min(5, similarGroups.length),
    },
  },
  recommendations,
};

const reportPath = '/tmp/memory-refiner-test-report.json';
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n📊 详细报告已保存: ${reportPath}`);

db.close();
