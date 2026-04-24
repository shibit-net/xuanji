#!/usr/bin/env node
/**
 * 将所有 JSON5 配置文件转换为 YAML 格式
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const yaml = require('yaml');
const glob = require('glob');

// 使用 vm 执行 JSON5 文件（支持模板字符串）
function loadJSON5WithVM(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    const script = new vm.Script(`(${content})`);
    const context = vm.createContext({});
    return script.runInContext(context);
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error.message);
    return null;
  }
}

// 转换为 YAML
function convertToYAML(config) {
  return yaml.stringify(config, {
    lineWidth: 0, // 不自动换行
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
  });
}

// 处理单个文件
function convertFile(json5Path) {
  console.log(`Converting: ${json5Path}`);

  const config = loadJSON5WithVM(json5Path);
  if (!config) {
    console.error(`  ❌ Failed to load`);
    return false;
  }

  const yamlContent = convertToYAML(config);
  const yamlPath = json5Path.replace(/\.json5$/, '.yaml');

  fs.writeFileSync(yamlPath, yamlContent, 'utf-8');
  console.log(`  ✅ Created: ${yamlPath}`);

  return true;
}

// 主函数
function main() {
  const rootDir = path.join(__dirname, '..');

  // 查找所有 JSON5 文件
  const patterns = [
    'src/core/templates/agents/*.json5',
    'src/core/templates/prompts/*.json5',
  ];

  let totalFiles = 0;
  let successCount = 0;

  patterns.forEach(pattern => {
    const files = glob.sync(pattern, { cwd: rootDir, absolute: true });
    console.log(`\nFound ${files.length} files matching ${pattern}\n`);

    files.forEach(file => {
      totalFiles++;
      if (convertFile(file)) {
        successCount++;
      }
    });
  });

  console.log(`\n✅ Converted ${successCount}/${totalFiles} files`);
  console.log('\nNext steps:');
  console.log('1. Review the generated .yaml files');
  console.log('2. Delete the old .json5 files: rm src/core/templates/**/*.json5');
  console.log('3. Update PromptComponentRegistry and AgentRegistry to use .yaml');
}

main();
