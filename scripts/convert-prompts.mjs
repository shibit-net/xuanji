#!/usr/bin/env node
/**
 * 将 TypeScript prompt 组件转换为 JSON5 模板文件
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const componentsDir = path.join(__dirname, '../src/core/prompt/components');
const templatesDir = path.join(__dirname, '../src/core/templates/prompts');

// 确保模板目录存在
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

// 需要转换的组件列表（排除 base-* 和 index.ts）
const componentsToConvert = [
  'l0-identity.ts',
  'l0-safety.ts',
  'l1-coding.ts',
  'l1-life.ts',
  'l2-planning.ts',
  'l2-agent-rules.ts',
  'l2-safety.ts',
  'l2-team-coordination.ts',
  'l3-project.ts',
];

console.log('开始转换 prompt 组件...\n');

for (const filename of componentsToConvert) {
  const sourcePath = path.join(componentsDir, filename);

  if (!fs.existsSync(sourcePath)) {
    console.log(`⚠️  跳过: ${filename} (文件不存在)`);
    continue;
  }

  try {
    // 读取源文件
    const content = fs.readFileSync(sourcePath, 'utf-8');

    // 提取组件信息
    const component = extractComponentInfo(content, filename);

    if (!component) {
      console.log(`⚠️  跳过: ${filename} (无法解析)`);
      continue;
    }

    // 生成 JSON5 配置
    const json5Content = generateJSON5(component);

    // 写入模板文件
    const targetPath = path.join(templatesDir, filename.replace('.ts', '.json5'));
    fs.writeFileSync(targetPath, json5Content, 'utf-8');

    console.log(`✅ 转换: ${filename} → ${path.basename(targetPath)}`);
  } catch (error) {
    console.error(`❌ 错误: ${filename}`, error.message);
  }
}

console.log('\n转换完成！');

/**
 * 从 TypeScript 文件中提取组件信息
 */
function extractComponentInfo(content, filename) {
  const component = {};

  // 提取 id
  const idMatch = content.match(/id:\s*['"]([^'"]+)['"]/);
  if (idMatch) component.id = idMatch[1];

  // 提取 name
  const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
  if (nameMatch) component.name = nameMatch[1];

  // 提取 layer
  const layerMatch = content.match(/layer:\s*['"]([^'"]+)['"]/);
  if (layerMatch) component.layer = layerMatch[1];

  // 提取 scenes
  const scenesMatch = content.match(/scenes:\s*\[([^\]]+)\]/);
  if (scenesMatch) {
    component.scenes = scenesMatch[1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
  }

  // 提取 priority
  const priorityMatch = content.match(/priority:\s*(\d+)/);
  if (priorityMatch) component.priority = parseInt(priorityMatch[1]);

  // 提取 estimatedTokens
  const tokensMatch = content.match(/estimatedTokens:\s*(\d+)/);
  if (tokensMatch) component.estimatedTokens = parseInt(tokensMatch[1]);

  // 提取 requiredTools
  const toolsMatch = content.match(/requiredTools:\s*\[([^\]]+)\]/);
  if (toolsMatch) {
    component.requiredTools = toolsMatch[1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
  }

  // 提取 thinking
  const thinkingMatch = content.match(/thinking:\s*\{([^}]+)\}/);
  if (thinkingMatch) {
    const thinkingContent = thinkingMatch[1];
    component.thinking = {};

    const typeMatch = thinkingContent.match(/type:\s*['"]([^'"]+)['"]/);
    if (typeMatch) component.thinking.type = typeMatch[1];

    const effortMatch = thinkingContent.match(/effort:\s*['"]([^'"]+)['"]/);
    if (effortMatch) component.thinking.effort = effortMatch[1];
  }

  // 提取 match (keywords 和 description)
  const keywordsMatch = content.match(/keywords:\s*\/(.+?)\/([igm]*)/);
  if (keywordsMatch) {
    component.match = component.match || {};
    component.match.keywords = keywordsMatch[1];
  }

  const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/);
  if (descMatch) {
    component.match = component.match || {};
    component.match.description = descMatch[1];
  }

  // 提取 prompt 内容
  const promptMatch = content.match(/const\s+\w+_PROMPT\s*=\s*`([^`]+)`/s);
  if (promptMatch) {
    component.content = promptMatch[1].trim();
  } else {
    // 尝试其他模式
    const altMatch = content.match(/return\s+`([^`]+)`/s);
    if (altMatch) {
      component.content = altMatch[1].trim();
    }
  }

  // 验证必填字段
  if (!component.id || !component.layer || !component.content) {
    return null;
  }

  return component;
}

/**
 * 生成 JSON5 配置内容
 */
function generateJSON5(component) {
  const lines = ['{'];

  // 添加注释（从文件头提取）
  lines.push(`  // ${component.name || component.id}`);
  lines.push('');

  // 基本字段
  lines.push(`  id: '${component.id}',`);
  lines.push(`  name: '${component.name || component.id}',`);
  lines.push(`  layer: '${component.layer}',`);

  // scenes
  if (component.scenes) {
    lines.push(`  scenes: [${component.scenes.map(s => `'${s}'`).join(', ')}],`);
  }

  // priority
  lines.push(`  priority: ${component.priority || 50},`);

  // estimatedTokens
  lines.push(`  estimatedTokens: ${component.estimatedTokens || 500},`);

  // enabled
  lines.push(`  enabled: true,`);
  lines.push('');

  // requiredTools
  if (component.requiredTools && component.requiredTools.length > 0) {
    lines.push(`  requiredTools: [${component.requiredTools.map(t => `'${t}'`).join(', ')}],`);
    lines.push('');
  }

  // thinking
  if (component.thinking) {
    lines.push('  thinking: {');
    lines.push(`    type: '${component.thinking.type}',`);
    if (component.thinking.effort) {
      lines.push(`    effort: '${component.thinking.effort}',`);
    }
    lines.push('  },');
    lines.push('');
  }

  // match
  if (component.match) {
    lines.push('  match: {');
    if (component.match.keywords) {
      lines.push(`    keywords: '${component.match.keywords}',`);
    }
    if (component.match.description) {
      lines.push(`    description: '${component.match.description}',`);
    }
    lines.push('  },');
    lines.push('');
  }

  // content (使用模板字符串)
  lines.push('  content: `' + component.content + '`');

  lines.push('}');

  return lines.join('\n');
}
