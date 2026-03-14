#!/usr/bin/env node

/**
 * 重构脚本：删除 SessionInitializer 中的 agentCoordinator 相关代码
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/core/chat/SessionInitializer.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 删除返回类型中的 agentCoordinator 字段
content = content.replace(
  /  agentCoordinator:.*?null;\n/,
  ''
);

// 2. 删除 initAgentCoordinator 调用
content = content.replace(
  /    \/\/ 11\. 初始化 Multi-Agent 系统\s+const agentCoordinator = await this\.initAgentCoordinator\([\s\S]*?\);\n/,
  ''
);

// 3. 删除返回对象中的 agentCoordinator 字段
content = content.replace(
  /      agentCoordinator,\n/,
  ''
);

// 4. 删除 initAgentCoordinator 方法（整个方法）
content = content.replace(
  /  \/\*\*\s+\* 初始化 Multi-Agent 系统\s+\*\/\s+private async initAgentCoordinator\([\s\S]*?\n  \}/,
  ''
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ SessionInitializer.ts 已清理 agentCoordinator 相关代码');
