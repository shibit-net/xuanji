#!/usr/bin/env node
// ============================================================
// 从现有记忆中提取经验教训
// ============================================================
// 分析现有的 error_resolution 和 decision 记忆，
// 使用 LLM 提取其中的经验教训，升级为 lesson_learned

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const dbPath = join(homedir(), '.xuanji', 'memory.db');
const db = new Database(dbPath);

// 初始化 Anthropic 客户端
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.XUANJI_API_KEY;
if (!apiKey) {
  console.error('错误: 需要设置 ANTHROPIC_API_KEY 或 XUANJI_API_KEY 环境变量');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

console.log('=== 从现有记忆中提取经验教训 ===\n');

// 1. 查询候选记忆
const candidates = db.prepare(`
  SELECT id, type, content, metadata, created_at
  FROM memories
  WHERE type IN ('error_resolution', 'decision')
  AND (
    content LIKE '%错误%' OR content LIKE '%问题%' OR content LIKE '%解决%'
    OR content LIKE '%陷阱%' OR content LIKE '%优化%' OR content LIKE '%改进%'
    OR content LIKE '%不该%' OR content LIKE '%应该%' OR content LIKE '%避免%'
  )
  ORDER BY created_at DESC
  LIMIT 50
`).all();

console.log(`找到 ${candidates.length} 条候选记忆\n`);

// 2. 批量分析提取
const BATCH_SIZE = 10;
const extractedLessons = [];

for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
  const batch = candidates.slice(i, i + BATCH_SIZE);
  console.log(`\n处理批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(candidates.length / BATCH_SIZE)}...`);

  const prompt = `你是一个经验教训提取专家。分析以下记忆，提取其中的经验教训。

## 记忆列表
${batch.map((m, idx) => `${idx + 1}. [${m.type}] ${m.content}`).join('\n')}

## 任务
从上述记忆中提取经验教训，分为三类：
- **mistake**: 错误方案或走弯路
- **improvement**: 发现了更好的做法
- **best_practice**: 值得复用的优秀实践

## 提取标准
- 只提取具有**普遍指导意义**的经验教训
- 跳过过于具体的技术细节（如具体的报错信息）
- 关注**为什么**和**如何避免**
- 每条经验教训应该独立可理解

## 输出格式（JSON）
\`\`\`json
{
  "lessons": [
    {
      "sourceId": "原记忆ID",
      "lessonType": "mistake|improvement|best_practice",
      "content": "经验教训的简洁描述（50-100字）",
      "problemDescription": "遇到的问题（mistake/improvement 填写）",
      "solution": "解决方案或改进方法",
      "applicableScenarios": ["适用场景1", "适用场景2"],
      "keywords": ["关键词1", "关键词2"],
      "reasoning": "为什么这是值得记录的经验教训"
    }
  ]
}
\`\`\`

如果某条记忆不值得提取为经验教训，跳过即可。`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.lessons && Array.isArray(parsed.lessons)) {
        for (const lesson of parsed.lessons) {
          // 找到原记忆
          const source = batch.find(m => m.id === lesson.sourceId);
          if (source) {
            extractedLessons.push({
              ...lesson,
              sourceType: source.type,
              sourceCreatedAt: source.created_at,
            });
            console.log(`  ✓ 提取: [${lesson.lessonType}] ${lesson.content.slice(0, 60)}...`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`  ✗ 批次处理失败:`, err.message);
  }

  // 避免 API 限流
  if (i + BATCH_SIZE < candidates.length) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
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
  SELECT
    type,
    COUNT(*) as count
  FROM memories
  WHERE type IN ('error_resolution', 'lesson_learned', 'reusable_pattern')
  GROUP BY type
`).all();

for (const stat of stats) {
  console.log(`${stat.type}: ${stat.count}`);
}

// 5. 展示示例
console.log('\n=== 提取的经验教训示例 ===');
const examples = db.prepare(`
  SELECT content, metadata
  FROM memories
  WHERE type = 'lesson_learned'
  AND source = 'lesson-extractor'
  ORDER BY created_at DESC
  LIMIT 5
`).all();

for (const ex of examples) {
  console.log(`\n- ${ex.content}`);
  try {
    const meta = JSON.parse(ex.metadata);
    if (meta.lessonType) console.log(`  类型: ${meta.lessonType}`);
    if (meta.solution) console.log(`  解决: ${meta.solution}`);
  } catch {}
}

db.close();
console.log('\n✓ 完成');
