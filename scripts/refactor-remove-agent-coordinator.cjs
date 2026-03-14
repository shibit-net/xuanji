#!/usr/bin/env node

/**
 * 重构脚本：删除 ChatSession 中的 agentCoordinator 相关代码
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/core/chat/ChatSession.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 删除私有成员定义
content = content.replace(
  /  private agentCoordinator:.*?\| null = null;\n/,
  ''
);

// 2. 删除初始化赋值
content = content.replace(
  /    this\.agentCoordinator = initResult\.agentCoordinator;\n/,
  ''
);

// 3. 删除 runMultiAgent 方法（整个方法）
content = content.replace(
  /  \/\*\*\s+\* Multi-Agent 模式执行\s+\*\/\s+private async runMultiAgent\(userMessage: string\): Promise<void> \{[\s\S]*?\n  \}/,
  ''
);

// 4. 删除 runWithAgentCoordinator 方法（整个方法）
content = content.replace(
  /  \/\*\*\s+\* 使用 AgentCoordinator 系统执行[\s\S]*?\n  \}/,
  ''
);

// 5. 修改 run() 方法
content = content.replace(
  /    \/\/ ✨ Multi-Agent 模式\s+if \(this\.config\.agents\?\.enabled && this\.agentCoordinator\) \{[\s\S]*?    \/\/ 降级：单 Agent 模式（原有逻辑）\s+await this\.runSingleAgent\(userMessage\);/,
  `    // ✨ Multi-Agent 模式
    if (this.config.agents?.enabled && this.orchestrator && this.agentRegistry) {
      await this.runWithOrchestrator(userMessage);
      return;
    }

    // 降级：单 Agent 模式（原有逻辑）
    await this.runSingleAgent(userMessage);`
);

// 6. 删除 stop() 方法中的调用
content = content.replace(
  /    \/\/ 同时停止 Multi-Agent 系统\s+this\.agentCoordinator\?\.stopAll\(\);\n/,
  ''
);

// 7. 删除 reset() 方法中的清理
content = content.replace(
  /    this\.agentCoordinator = null;\n/,
  ''
);

// 8. 删除 shutdown() 方法中的清理
content = content.replace(
  /    \/\/ 清理 Multi-Agent 系统\s+if \(this\.agentCoordinator\) \{[\s\S]*?    \}/,
  ''
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ ChatSession.ts 已清理 agentCoordinator 相关代码');
