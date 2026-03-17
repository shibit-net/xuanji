#!/usr/bin/env tsx
/**
 * 诊断 max_tokens 配置问题
 */

import { DEFAULT_CONFIG } from '../src/core/config/defaults.js';
import { ConfigLoader } from '../src/core/config/ConfigLoader.js';
import path from 'path';
import os from 'os';

async function main() {
  console.log('=== Max Tokens 配置诊断 ===\n');

  // 1. 检查默认配置
  console.log('1️⃣ 默认配置:');
  console.log(`   provider.maxTokens: ${DEFAULT_CONFIG.provider.maxTokens}`);
  console.log(`   provider.model: ${DEFAULT_CONFIG.provider.model}\n`);

  // 2. 检查用户配置
  const globalConfigPath = path.join(os.homedir(), '.xuanji', 'config.json');
  console.log('2️⃣ 用户配置路径:', globalConfigPath);

  try {
    const userConfig = await import(globalConfigPath, { assert: { type: 'json' } });
    console.log(`   provider.maxTokens: ${userConfig.default?.config?.provider?.maxTokens || '未设置（使用默认值）'}\n`);
  } catch (err) {
    console.log('   未找到用户配置\n');
  }

  // 3. 检查项目配置
  const projectConfigPath = path.join(process.cwd(), '.xuanji', 'config.json');
  console.log('3️⃣ 项目配置路径:', projectConfigPath);

  try {
    const projectConfig = await import(projectConfigPath, { assert: { type: 'json' } });
    console.log(`   provider.maxTokens: ${projectConfig.default?.provider?.maxTokens || '未设置（使用默认值）'}\n`);
  } catch (err) {
    console.log('   未找到项目配置\n');
  }

  // 4. 加载合并后的配置
  console.log('4️⃣ 合并后的最终配置:');
  const loader = new ConfigLoader();
  const finalConfig = await loader.load();
  console.log(`   provider.maxTokens: ${finalConfig.provider.maxTokens}`);
  console.log(`   provider.model: ${finalConfig.provider.model}\n`);

  // 5. 检查 Agent 配置
  console.log('5️⃣ Agent 配置:');
  const agentConfigDir = path.join(process.cwd(), 'src/core/agent/builtin');
  const fs = await import('fs/promises');
  try {
    const files = await fs.readdir(agentConfigDir);
    for (const file of files) {
      if (file.endsWith('.json5')) {
        const content = await fs.readFile(path.join(agentConfigDir, file), 'utf-8');
        const match = content.match(/maxTokens:\s*(\d+)/);
        if (match) {
          console.log(`   ${file}: maxTokens = ${match[1]}`);
        }
      }
    }
  } catch (err) {
    console.log('   无法读取 Agent 配置目录');
  }

  console.log('\n✅ 诊断完成');
  console.log('\n💡 如果看到 maxTokens > 64000，说明配置有问题');
  console.log('   Claude Sonnet 4.5 的最大允许值是 64000');
}

main().catch(console.error);
