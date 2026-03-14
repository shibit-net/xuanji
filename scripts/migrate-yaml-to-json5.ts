#!/usr/bin/env tsx
/**
 * YAML → JSON5 迁移工具
 *
 * 将 Agent 配置从 YAML 格式转换为 JSON5 格式
 *
 * 用法：
 *   tsx scripts/migrate-yaml-to-json5.ts [--dry-run] [--delete-yaml]
 *
 * 选项：
 *   --dry-run      仅预览，不实际转换
 *   --delete-yaml  转换成功后删除原 YAML 文件
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYAML } from 'yaml';
import JSON5 from 'json5';
import { promisify } from 'node:util';
import globCb from 'glob';

const glob = promisify(globCb);

interface MigrationOptions {
  dryRun: boolean;
  deleteYaml: boolean;
}

interface MigrationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  files: {
    source: string;
    target: string;
    status: 'success' | 'failed' | 'skipped';
    error?: string;
  }[];
}

async function migrateFile(
  yamlPath: string,
  options: MigrationOptions,
): Promise<'success' | 'failed' | 'skipped'> {
  try {
    // 检查目标 JSON5 文件是否已存在
    const json5Path = yamlPath.replace(/\.(yaml|yml)$/, '.json5');
    const json5Exists = await fs.stat(json5Path).then(() => true).catch(() => false);

    if (json5Exists) {
      console.log(`  ⚠️  已存在 JSON5 文件，跳过: ${json5Path}`);
      return 'skipped';
    }

    // 读取并解析 YAML
    const content = await fs.readFile(yamlPath, 'utf-8');
    const config = parseYAML(content);

    if (!options.dryRun) {
      // 转换为 JSON5
      const json5Content = JSON5.stringify(config, null, 2);

      // 写入 JSON5 文件
      await fs.writeFile(json5Path, json5Content, 'utf-8');

      // 删除原 YAML 文件（如果指定）
      if (options.deleteYaml) {
        await fs.unlink(yamlPath);
        console.log(`  ✓ ${yamlPath} → ${json5Path} (已删除 YAML)`);
      } else {
        console.log(`  ✓ ${yamlPath} → ${json5Path}`);
      }
    } else {
      console.log(`  [预览] ${yamlPath} → ${json5Path}`);
    }

    return 'success';
  } catch (error: any) {
    console.error(`  ✗ 转换失败: ${yamlPath}`, error.message);
    return 'failed';
  }
}

async function migrateDirectory(dirPath: string, options: MigrationOptions): Promise<MigrationResult> {
  const result: MigrationResult = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    files: [],
  };

  try {
    // 检查目录是否存在
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) {
      console.log(`  ⚠️  目录不存在，跳过: ${dirPath}`);
      return result;
    }

    // 扫描所有 YAML 文件
    const files = await glob(`${dirPath}/**/*.{yaml,yml}`);
    result.total = files.length;

    if (files.length === 0) {
      console.log(`  ✓ 无需迁移: ${dirPath}`);
      return result;
    }

    console.log(`\n📂 迁移目录: ${dirPath} (${files.length} 个文件)`);

    for (const file of files) {
      const status = await migrateFile(file, options);

      result.files.push({
        source: file,
        target: file.replace(/\.(yaml|yml)$/, '.json5'),
        status,
      });

      if (status === 'success') result.success++;
      else if (status === 'failed') result.failed++;
      else result.skipped++;
    }
  } catch (error: any) {
    console.error(`  ❌ 迁移目录失败: ${dirPath}`, error.message);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    dryRun: args.includes('--dry-run'),
    deleteYaml: args.includes('--delete-yaml'),
  };

  console.log('🔄 YAML → JSON5 迁移工具\n');

  if (options.dryRun) {
    console.log('⚠️  预览模式（--dry-run），不会实际修改文件\n');
  }

  if (options.deleteYaml && !options.dryRun) {
    console.log('⚠️  将在转换成功后删除原 YAML 文件（--delete-yaml）\n');
  }

  // 要迁移的目录
  const directories = [
    path.join(os.homedir(), '.xuanji/agents'),  // 全局配置
    path.join(process.cwd(), '.xuanji/agents'), // 项目配置
  ];

  const totalResult: MigrationResult = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    files: [],
  };

  for (const dir of directories) {
    const result = await migrateDirectory(dir, options);
    totalResult.total += result.total;
    totalResult.success += result.success;
    totalResult.failed += result.failed;
    totalResult.skipped += result.skipped;
    totalResult.files.push(...result.files);
  }

  // 打印总结
  console.log('\n' + '='.repeat(60));
  console.log('📊 迁移总结\n');
  console.log(`  总计: ${totalResult.total} 个文件`);
  console.log(`  ✓ 成功: ${totalResult.success}`);
  console.log(`  ⚠️  跳过: ${totalResult.skipped}`);
  console.log(`  ✗ 失败: ${totalResult.failed}`);

  if (totalResult.failed > 0) {
    console.log('\n失败的文件:');
    totalResult.files
      .filter(f => f.status === 'failed')
      .forEach(f => console.log(`  - ${f.source}`));
  }

  if (options.dryRun) {
    console.log('\n💡 执行实际迁移: tsx scripts/migrate-yaml-to-json5.ts');
    console.log('💡 迁移后删除 YAML: tsx scripts/migrate-yaml-to-json5.ts --delete-yaml');
  }

  console.log('='.repeat(60));

  process.exit(totalResult.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ 迁移失败:', err);
  process.exit(1);
});
