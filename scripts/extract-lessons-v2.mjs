#!/usr/bin/env node
// ============================================================
// 从现有记忆中提取经验教训（优化版）
// ============================================================

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const dbPath = join(homedir(), '.xuanji', 'memory.db');
const db = new Database(dbPath);

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.XUANJI_API_KEY;
if (!apiKey) {
  console.error('错误: 需要设置 ANTHROPIC_API_KEY 或 XUANJI_API_KEY 环境变量');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

console.log('=== 从现有记忆中提取经验教训（优化版）===\n');

// 1. 查询候选记忆（更精准的筛选）
const candidates = db.prepare(`
  SELECT id, type, content, metadata, created_at
  FROM memories
  WHERE type IN ('error_resolution', 'decision')
  AND length(content) > 50
  ORDER BY created_at DESC
  LIMIT 30
`).all();

console.log(`找到 ${candidates.length} 条候选记忆\n`);

// 显示前 5 条
console.log('候选记忆示例:');
for (const c of candidates.slice(0, 5)) {
  console.log(`- [${c.type}] ${c.content.slice(0, 80)}...`);
}

// 2. 逐条分析（更精准）
const extractedLessons = [];

for (let i = 0; i < Math.min(candidates.length, 15); i++) {
  const memory = candidates[i];
  console.log(`\n[${i + 1}/${Math.min(candidates.length, 15)}] 分析: ${memory.content.slice(0, 60)}...`);

  const prompt = `分析以下记忆，判断是否包含值得记录的经验教训。

## 记忆内容
类型: ${memory.type}
内容: ${memory.content}

## 判断标准
经验教训应该满足：
1. 具有普遍指导意义（不是特定项目的细节）
2. 可以帮助避免未来的错误
3. 揭示了某种规律或最佳实践
4. 比原始记忆更抽象、更有价值

## 示例
✓ 好的经验教训：
- "过早优化导致复杂度急剧上升，应先完成功能再优化"
- "全局状态会触发所有组件重新渲染，UI 临时状态应该用局部状态"
- "配置文件路径错误时，应该先检查 include 配置是否覆盖目标目录"

✗ 不是经验教训：
- "修复了 agent_team 工具的注册问题"（太具体）
- "设置了 API Key"（操作步骤，不是教训）

## 输出格式（JSON）
如果值得提取，返回：
\`\`\`json
{
  "worthExtracting": true,
  "lessonType": "mistake|improvement|best_practice",
  "content": "经验教训的简洁描述（一句话，50-100字）",
  "problemDescription": "遇到的问题",
  "solution": "解决方案或改进方法",
  "applicableScenarios": ["适用场景1", "适用场景2"],
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "reasoning": "为什么这是值得记录的经验教训（20字以内）"
}
\`\`\`

如果不值得提取，返回：
\`\`\`json
{
  "worthExtracting": false,
  "reasoning": "原因"
}
\`\`\``;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);

      if (parsed.worthExtracting) {
        extractedLessons.push({
          ...parsed,
          sourceId: memory.id,
          sourceType: memory.type,
          sourceContent: memory.content,
          sourceCreatedAt: memory.created_at,
        });
        console.log(`  ✓ [${parsed.lessonType}] ${parsed.content.slice(0, 60)}...`);
        console.log(`    理由: ${parsed.reasoning}`);
      } else {
        console.log(`  ✗ 跳过: ${parsed.reasoning}`);
      }
    } else {
      console.log(`  ✗ 解析失败`);
    }
  } catch (err) {
    console.error(`  ✗ 处理失败:`, err.message);
  }

  // 避免 API 限流
  await new Promise(resolve => setTimeout(resolve, 1500));
}

console.log(`\n=== 提取完成 ===`);
console.log(`共提取 ${extractedLessons.length} 条经验教训\n`);

// 3. 保存到数据库
if (extractedLessons.length > 0) {
  console.log('保存到数据库...');

  const insertStmt = db.prepare(`
    INSERT INTO memories (
      id, type, content, keywords, source, confidence,
      created_at, updated_at, last_accessed_at, access_count,
      category, metadata, scope, volatility, significance, category_label
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  const now = new Date().toISOString();
  let savedCount = 0;

  for (const lesson of extractedLessons) {
    const id = `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const keywords = JSON.stringify(lesson.keywords || []);
    const metadata = JSON.stringify({
      lessonType: lesson.lessonType,
      problemDescription: lesson.problemDescription,
      solution: lesson.solution,
      applicableScenarios: lesson.applicableScenarios,
      extractedFrom: lesson.sourceId,
      extractionReasoning: lesson.reasoning,
      sourceContent: lesson.sourceContent,
    });

    try {
      insertStmt.run(
        id,
        'lesson_learned',
        lesson.content,
        keywords,
        'lesson-extractor',
        0.85,
        lesson.sourceCreatedAt || now,
        now,
        now,
        0,
        'lesson',
        metadata,
        'knowledge',
        'normal',
        0.75,
        '经验/知识库'
      );
      savedCount++;
    } catch (err) {
      console.error(`  ✗ 保存失败:`, err.message);
    }
  }

  console.log(`✓ 成功保存 ${savedCount} 条经验教训`);
}

// 4. 统计
console.log('\n=== 统计信息 ===');
const stats = db.prepare(`
  SELECT type, COUNT(*) as count
  FROM memories
  WHERE type IN ('error_resolution', 'lesson_learned', 'reusable_pattern')
  GROUP BY type
`).all();

for (const stat of stats) {
  console.log(`${stat.type}: ${stat.count}`);
}

// 5. 展示提取的经验教训
if (extractedLessons.length > 0) {
  console.log('\n=== 提取的经验教训 ===');
  for (const lesson of extractedLessons) {
    console.log(`\n[${lesson.lessonType}] ${lesson.content}`);
    console.log(`  问题: ${lesson.problemDescription}`);
    console.log(`  解决: ${lesson.solution}`);
    console.log(`  场景: ${lesson.applicableScenarios.join(', ')}`);
    console.log(`  来源: ${lesson.sourceContent.slice(0, 80)}...`);
  }
}

db.close();
console.log('\n✓ 完成');
