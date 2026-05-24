// ============================================================
// M9 配置管理 — 项目配置写入
// ============================================================

import { join } from 'node:path';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { PROJECT_CONFIG_DIR_NAME, ProjectConfig } from './ProjectConfig';

/**
 * 初始化选项
 */
export interface InitOptions {
  /** 语言 (中文/英文) */
  language: 'zh' | 'en';
  /** 是否覆盖已存在的文件 */
  overwrite?: boolean;
  /** 是否生成完整配置（包含所有默认值和注释） */
  generateFullConfig?: boolean;
}

/**
 * 中文 rules.md 模板
 */
const RULES_TEMPLATE_ZH = `# 项目规则

这个文件用于向 AI 助手描述项目的特定规则和约定。

## 代码风格
- 使用 TypeScript 严格模式
- 优先使用函数式编程风格

## 项目约定
- 所有 API 调用必须有错误处理
- 新增功能需要添加单元测试

## 禁止操作
- 不要修改 package.json 的 dependencies 版本
`;

/**
 * 英文 rules.md 模板
 */
const RULES_TEMPLATE_EN = `# Project Rules

This file describes project-specific rules and conventions for the AI assistant.

## Code Style
- Use TypeScript strict mode
- Prefer functional programming style

## Project Conventions
- All API calls must have error handling
- New features require unit tests

## Prohibited Operations
- Do not modify package.json dependency versions
`;

/**
 * ProjectConfigWriter — 项目配置文件写入
 *
 * 负责初始化 .xuanji/ 目录和配置文件
 */
export class ProjectConfigWriter {
  /**
   * 初始化项目配置
   * @param options 初始化选项
   * @param cwd 项目根目录 (默认: process.cwd())
   */
  async initProjectConfig(options: InitOptions, cwd?: string): Promise<void> {
    const base = cwd ?? process.cwd();
    const configDir = join(base, PROJECT_CONFIG_DIR_NAME);
    const configPath = ProjectConfig.getProjectConfigPath(cwd);
    const rulesPath = ProjectConfig.getProjectRulesPath(cwd);

    // 创建 .xuanji/ 目录
    await mkdir(configDir, { recursive: true });

    // 检查文件是否已存在
    const configExists = await this.fileExists(configPath);
    const rulesExists = await this.fileExists(rulesPath);

    if ((configExists || rulesExists) && !options.overwrite) {
      throw new Error('Files already exist. Use overwrite option to replace them.');
    }

    // 创建 config.json
    const configContent = options.generateFullConfig
      ? this.generateFullConfigTemplate(options.language)
      : '{}';
    await writeFile(configPath, configContent, 'utf-8');

    // 创建 rules.md (根据语言选择模板)
    const rulesTemplate = options.language === 'zh' ? RULES_TEMPLATE_ZH : RULES_TEMPLATE_EN;
    await writeFile(rulesPath, rulesTemplate, 'utf-8');
  }

  /**
   * 保存项目配置
   * @param config 配置对象
   * @param cwd 项目根目录 (默认: process.cwd())
   */
  async saveProjectConfig(config: Record<string, unknown>, cwd?: string): Promise<void> {
    const base = cwd ?? process.cwd();
    const configDir = join(base, PROJECT_CONFIG_DIR_NAME);
    const configPath = ProjectConfig.getProjectConfigPath(cwd);

    // 确保目录存在
    await mkdir(configDir, { recursive: true });

    // 写入配置文件 (格式化 JSON)
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 生成完整配置模板（包含所有默认值和伪注释）
   */
  private generateFullConfigTemplate(language: 'zh' | 'en'): string {
    const config = language === 'zh'
      ? this.getConfigTemplateZH()
      : this.getConfigTemplateEN();
    return JSON.stringify(config, null, 2);
  }

  /** 中文配置模板 */
  private getConfigTemplateZH(): Record<string, unknown> {
    return {
      '// 说明': '这是 Xuanji 项目配置文件，所有字段都是可选的',
      '// 配置优先级': '项目配置 > 全局配置(.xuanji/config.json) > 默认配置',

      provider: {
        '// model': '使用的 LLM 模型，如: claude-sonnet-4, gpt-4o',
        model: 'claude-sonnet-4',
        '// apiKey': 'API 密钥（建议通过环境变量 XUANJI_API_KEY 设置）',
        '// baseURL': '自定义 API 地址（可选）',
        '// maxTokens': '最大输出 token 数（默认: 65536）',
        maxTokens: 65536,
        '// temperature': '采样温度 0-1（默认: undefined 使用模型默认值）',
      },

      ui: {
        '// theme': '主题: light | dark | auto',
        theme: 'auto',
        '// language': '界面语言: zh | en',
        language: 'zh',
        '// showTokenUsage': '是否显示 Token 用量',
        showTokenUsage: true,
        '// showCost': '是否显示费用',
        showCost: false,
        '// showThinking': '是否显示思考过程',
        showThinking: true,
      },

      tools: {
        permissions: {
          '// 权限级别': 'always=自动允许 | ask=询问用户 | never=禁止',
          '// fileRead': '读取文件权限',
          fileRead: 'always',
          '// fileWrite': '写入文件权限',
          fileWrite: 'ask',
          '// bashExec': '执行命令权限',
          bashExec: 'ask',
          '// warnLevel': 'warn 级别操作处理: ask=询问 | auto-allow=自动放行',
          warnLevel: 'ask',
          '// confirmWrite': '写入确认策略: ask=每次确认 | plan-only=LLM决定 | auto=自动放行',
          confirmWrite: 'plan-only',
          '// allowedCommands': '命令白名单（正则表达式）',
          allowedCommands: ['^git ', '^npm ', '^ls ', '^cat '],
          '// deniedCommands': '命令黑名单（正则表达式）',
          deniedCommands: ['rm -rf /', 'dd if='],
          '// allowedPaths': '路径白名单（glob 模式）',
          allowedPaths: [],
          '// deniedPaths': '路径黑名单（glob 模式）',
          deniedPaths: ['/etc/**', '/sys/**', '/proc/**'],
        },
      },
    };
  }

  /** 英文配置模板 */
  private getConfigTemplateEN(): Record<string, unknown> {
    return {
      '// Note': 'This is Xuanji project config. All fields are optional',
      '// Priority': 'Project config > Global config(.xuanji/config.json) > Defaults',

      provider: {
        '// model': 'LLM model to use, e.g.: claude-sonnet-4, gpt-4o',
        model: 'claude-sonnet-4',
        '// apiKey': 'API key (recommended to set via XUANJI_API_KEY env var)',
        '// baseURL': 'Custom API endpoint (optional)',
        '// maxTokens': 'Max output tokens (default: 65536)',
        maxTokens: 65536,
        '// temperature': 'Sampling temperature 0-1 (default: undefined uses model default)',
      },

      ui: {
        '// theme': 'Theme: light | dark | auto',
        theme: 'auto',
        '// language': 'UI language: zh | en',
        language: 'en',
        '// showTokenUsage': 'Show token usage',
        showTokenUsage: true,
        '// showCost': 'Show cost',
        showCost: false,
        '// showThinking': 'Show thinking process',
        showThinking: true,
      },

      tools: {
        permissions: {
          '// Permission levels': 'always=auto allow | ask=prompt user | never=deny',
          '// fileRead': 'File read permission',
          fileRead: 'always',
          '// fileWrite': 'File write permission',
          fileWrite: 'ask',
          '// bashExec': 'Command execution permission',
          bashExec: 'ask',
          '// warnLevel': 'Warn level handling: ask=prompt | auto-allow=auto',
          warnLevel: 'ask',
          '// confirmWrite': 'Write confirm strategy: ask=always | plan-only=LLM decides | auto=auto',
          confirmWrite: 'plan-only',
          '// allowedCommands': 'Command whitelist (regex patterns)',
          allowedCommands: ['^git ', '^npm ', '^ls ', '^cat '],
          '// deniedCommands': 'Command blacklist (regex patterns)',
          deniedCommands: ['rm -rf /', 'dd if='],
          '// allowedPaths': 'Path whitelist (glob patterns)',
          allowedPaths: [],
          '// deniedPaths': 'Path blacklist (glob patterns)',
          deniedPaths: ['/etc/**', '/sys/**', '/proc/**'],
        },
      },
    };
  }
}
